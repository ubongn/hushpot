// File-backed wallet persistence (deploy/src/wallet-state.ts) — unit tests.
//
// Covers the WALLET_STATE_FILE guard matrix, load/persist round-trips, the
// corrupt/wrong-network fallbacks, section-snapshot seed validation, and —
// most importantly — the actual tx-history HYDRATE path used at boot:
// InMemoryTransactionHistoryStorage.restore(serialize(...)) with the real
// WalletEntrySchema, including BigInt entry fields and post-restore merge
// semantics. Also proves a dust wallet section snapshot round-trips through
// DustWallet.restore() (the SDK path that resumes sync from appliedIndex).

import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WALLET_STATE_FILE,
  PersistedWalletState,
  loadPersistedWalletState,
  persistWalletState,
  sectionSnapshotMatches,
  walletStateEnabled,
  walletStatePath,
} from '../deploy/src/wallet-state.js';
import {
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';
import { LedgerParameters } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk';

let stateDir: string;
let stateFile: string;
const savedEnv = process.env['WALLET_STATE_FILE'];

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'wallet-state-test-'));
  stateFile = join(stateDir, 'tx-history.json');
  process.env['WALLET_STATE_FILE'] = stateFile;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env['WALLET_STATE_FILE'];
  else process.env['WALLET_STATE_FILE'] = savedEnv;
  rmSync(stateDir, { recursive: true, force: true });
});

describe('WALLET_STATE_FILE guard', () => {
  it('defaults to enabled with <deploy>/midnight-level-db/tx-history.json', () => {
    delete process.env['WALLET_STATE_FILE'];
    expect(walletStateEnabled()).toBe(true);
    expect(walletStatePath()).toBe(DEFAULT_WALLET_STATE_FILE);
    expect(DEFAULT_WALLET_STATE_FILE).toMatch(/midnight-level-db[\\/]tx-history\.json$/);
  });

  it.each(['0', 'off', 'false', 'no', 'disabled', 'OFF', ' False '])(
    'WALLET_STATE_FILE=%j disables persistence',
    (value) => {
      process.env['WALLET_STATE_FILE'] = value;
      expect(walletStateEnabled()).toBe(false);
      expect(loadPersistedWalletState('preprod')).toBeNull();
    },
  );

  it('accepts a custom path (resolved against cwd)', () => {
    process.env['WALLET_STATE_FILE'] = 'custom/dir/state.json';
    expect(walletStateEnabled()).toBe(true);
    expect(walletStatePath()).toBe(join(process.cwd(), 'custom', 'dir', 'state.json'));
  });
});

describe('loadPersistedWalletState / persistWalletState', () => {
  const state: PersistedWalletState = {
    version: 1,
    networkId: 'preprod',
    savedAt: '2026-09-04T06:00:00.000Z',
    txHistory: '[{"hash":"abc","protocolVersion":1,"status":"SUCCESS"}]',
    sections: { shielded: '{"publicKeys":{}}', dust: '{"publicKey":{}}' },
  };

  it('round-trips a persisted state file', () => {
    const written = persistWalletState(state);
    expect(written).toBe(stateFile);
    expect(loadPersistedWalletState('preprod')).toEqual(state);
  });

  it('writes atomically (no .tmp leftover)', () => {
    persistWalletState(state);
    expect(existsSync(`${stateFile}.tmp`)).toBe(false);
    expect(existsSync(stateFile)).toBe(true);
  });

  it('returns null for a missing file', () => {
    expect(loadPersistedWalletState('preprod')).toBeNull();
  });

  it('returns null (not throws) for a corrupt file', () => {
    writeFileSync(stateFile, '{ this is not json');
    expect(loadPersistedWalletState('preprod')).toBeNull();
  });

  it('returns null for an unknown version', () => {
    persistWalletState(state);
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    writeFileSync(stateFile, JSON.stringify({ ...parsed, version: 99 }));
    expect(loadPersistedWalletState('preprod')).toBeNull();
  });

  it('ignores state saved for a different network (wrong-chain cursor danger)', () => {
    persistWalletState(state);
    expect(loadPersistedWalletState('preview')).toBeNull();
  });
});

describe('sectionSnapshotMatches (seed-mismatch guard)', () => {
  const snapshot = JSON.stringify({
    publicKeys: { coinPublicKey: 'deadbeef' },
    publicKey: { publicKey: '12345', address: 'mid:abc' },
  });

  it('accepts a snapshot whose keys match', () => {
    expect(
      sectionSnapshotMatches(snapshot, { 'publicKeys.coinPublicKey': 'deadbeef' }),
    ).toBe(true);
    expect(
      sectionSnapshotMatches(snapshot, { 'publicKey.publicKey': 12345n }),
    ).toBe(true); // bigint vs string compares via String()
  });

  it('rejects a snapshot from a different seed', () => {
    expect(
      sectionSnapshotMatches(snapshot, { 'publicKeys.coinPublicKey': 'cafebabe' }),
    ).toBe(false);
    expect(sectionSnapshotMatches(snapshot, { 'publicKey.address': 'mid:zzz' })).toBe(false);
  });

  it('is lenient about checks it cannot perform (absent fields)', () => {
    expect(sectionSnapshotMatches(snapshot, { 'unknown.path': 'x' })).toBe(true);
  });

  it('rejects garbage input instead of throwing', () => {
    expect(sectionSnapshotMatches('not json', { 'publicKey.address': 'mid:abc' })).toBe(false);
    expect(sectionSnapshotMatches(undefined, {})).toBe(false);
  });
});

describe('tx-history hydrate path (boot-time restore)', () => {
  // The exact calls wallet.ts makes at build() time when a state file exists.
  const entry = {
    hash: 'deadbeefcafe',
    protocolVersion: 1,
    status: 'SUCCESS' as const,
    fees: 12_345n,
    identifiers: ['a'],
    timestamp: new Date('2026-09-04T06:00:00.000Z'),
    dust: {
      receivedUtxos: [
        { initialValue: 100n, nonce: 7n, seq: 1, backingNight: '0xabc', mtIndex: 42n },
      ],
      spentUtxos: [],
    },
  };

  it('restores the full entry map, BigInt fields included', async () => {
    const storage = new InMemoryTransactionHistoryStorage(
      WalletEntrySchema,
      mergeWalletEntries,
    );
    await storage.upsert(entry);

    const serialized = await storage.serialize(); // what flush() writes to disk
    const restored = InMemoryTransactionHistoryStorage.restore(
      serialized,
      WalletEntrySchema,
      mergeWalletEntries,
    );

    const all = await restored.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.hash).toBe(entry.hash);
    expect(all[0]?.fees).toBe(12_345n); // real bigint, not a string
    expect(all[0]?.dust?.receivedUtxos[0]?.mtIndex).toBe(42n);
    expect(await restored.get('deadbeefcafe')).toBeDefined();
    expect(await restored.get('unknown')).toBeUndefined();
  });

  it('keeps merge semantics after restore (upsert unions sections)', async () => {
    const storage = new InMemoryTransactionHistoryStorage(
      WalletEntrySchema,
      mergeWalletEntries,
    );
    await storage.upsert(entry);
    const restored = InMemoryTransactionHistoryStorage.restore(
      await storage.serialize(),
      WalletEntrySchema,
      mergeWalletEntries,
    );
    await restored.upsert({
      ...entry,
      status: 'PARTIAL_SUCCESS',
      shielded: {
        receivedCoins: [{ type: 't', nonce: '1' }],
        spentCoins: [],
      } as never,
    });
    const merged = await restored.get('deadbeefcafe');
    expect(merged?.status).toBe('PARTIAL_SUCCESS');
    expect(merged?.dust).toBeDefined(); // earlier section survived the merge
  });
});

describe('dust section snapshot round-trip (sync-cursor persistence)', () => {
  // Section snapshots embed `offset: appliedIndex`; the SDK resumes the
  // indexer scan from it (wallet-sdk-dust-wallet/dist/v1/Sync.js). This test
  // proves DustWallet.restore(serializeState()) is a lossless round-trip
  // without touching the network (sync only starts on facade .start()).
  const dummyConfig = {
    indexerClientConnection: {
      indexerHttpUrl: 'http://127.0.0.1:9/',
      indexerWsUrl: 'ws://127.0.0.1:9/',
    },
    provingServerUrl: new URL('http://127.0.0.1:9/'),
    networkId: 'preprod',
    relayURL: new URL('ws://127.0.0.1:9/'),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      WalletEntrySchema,
      mergeWalletEntries,
    ),
    costParameters: { feeBlocksMargin: 5 },
  } as unknown as DefaultConfiguration;

  it('serializeState -> restore -> serializeState is stable', async () => {
    const seed = new Uint8Array(32).fill(7);
    const dust = DustWallet(dummyConfig).startWithSeed(
      seed,
      LedgerParameters.initialParameters().dust,
    );

    const snapshot = await dust.serializeState();
    expect(() => JSON.parse(snapshot)).not.toThrow();

    const restored = DustWallet(dummyConfig).restore(snapshot);
    const snapshot2 = await restored.serializeState();

    const parse = (s: string) => {
      const parsed = JSON.parse(s);
      delete parsed.networkId; // restore() stamps the current config networkId
      return parsed;
    };
    expect(parse(snapshot2)).toEqual(parse(snapshot));
  });
});
