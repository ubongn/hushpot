// File-backed wallet persistence for the deploy runner.
//
// The Midnight wallet SDK ships no persistent TransactionHistoryStorage — only
// InMemory and NoOp variants exist in @midnight-ntwrk/wallet-sdk-* (checked:
// wallet-sdk-abstractions exports exactly those two). testkit-js has
// WalletSaveStateProvider, but it persists a single wallet section to its own
// gzip file under ./.states and does not cover the tx-history storage or the
// multi-section facade this runner builds.
//
// This module therefore persists ONE JSON state file per wallet that combines:
//
//   txHistory — the serialized InMemoryTransactionHistoryStorage map
//               (serialize()/restore() are first-class SDK APIs; verified that
//               BigInt entry fields round-trip through the JSON encoding).
//   sections  — shielded/unshielded/dust wallet snapshots. Each snapshot
//               embeds the sync cursor (shielded/dust: `offset` = appliedIndex,
//               unshielded: `appliedId`), and the SDK resumes indexer scanning
//               from that cursor instead of genesis
//               (wallet-sdk-*/dist/v1/Sync.js: "A restored wallet has
//               appliedIndex >= 1, so resumeFrom is appliedIndex - 1").
//
// Controlled by WALLET_STATE_FILE:
//   unset / empty   -> default ON:  <deploy>/midnight-level-db/tx-history.json
//   0|off|false|no  -> disabled (fresh genesis sync every run, old behaviour)
//   anything else   -> custom file path (relative paths resolve against cwd)
//
// Corrupt files, unknown versions, or a networkId mismatch fall back to a
// fresh start — persistence must never brick a deploy run.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';

export interface PersistedWalletSections {
  shielded?: string;
  unshielded?: string;
  dust?: string;
}

export interface PersistedWalletState {
  version: 1;
  networkId: string;
  savedAt: string;
  /** JSON string produced by InMemoryTransactionHistoryStorage.serialize(). */
  txHistory?: string;
  /** Section wallet snapshots (WalletFacade section serializeState() output). */
  sections?: PersistedWalletSections;
}

/** Default: <deploy>/midnight-level-db/tx-history.json (deploy root = ../ from this file). */
export const DEFAULT_WALLET_STATE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'midnight-level-db',
  'tx-history.json',
);

const DISABLED_VALUES = new Set(['0', 'off', 'false', 'no', 'disabled']);

/** WALLET_STATE_FILE unset/empty -> enabled with default path; 0/off/false/no -> disabled. */
export function walletStateEnabled(): boolean {
  const raw = (process.env['WALLET_STATE_FILE'] ?? '').trim().toLowerCase();
  return !DISABLED_VALUES.has(raw);
}

export function walletStatePath(): string {
  const raw = (process.env['WALLET_STATE_FILE'] ?? '').trim();
  return raw.length > 0 ? resolve(raw) : DEFAULT_WALLET_STATE_FILE;
}

/**
 * Load a persisted state file. Returns null when persistence is disabled, the
 * file is missing, the state was saved for a different network, or the file is
 * corrupt — callers then start fresh.
 */
export function loadPersistedWalletState(
  networkId: string,
  logger?: Logger,
): PersistedWalletState | null {
  if (!walletStateEnabled()) return null;
  const path = walletStatePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedWalletState;
    if (parsed?.version !== 1 || typeof parsed.networkId !== 'string') {
      throw new Error(`unrecognized state file format (version=${String(parsed?.version)})`);
    }
    if (parsed.networkId !== networkId) {
      logger?.warn(
        `Ignoring wallet state ${path}: saved for network '${parsed.networkId}', current '${networkId}'`,
      );
      return null;
    }
    logger?.info(`Wallet state file found: ${path} (saved ${parsed.savedAt})`);
    return parsed;
  } catch (err) {
    // A corrupt or partially-written file must never block a deploy.
    logger?.warn(`Ignoring unreadable wallet state ${path}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Atomically persist state (write to <path>.tmp then rename over <path>).
 * Returns the written path.
 */
export function persistWalletState(state: PersistedWalletState): string {
  const path = walletStatePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const json = JSON.stringify(state, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  writeFileSync(tmp, json);
  renameSync(tmp, path);
  return path;
}

/**
 * Cheap pre-flight check that a section snapshot belongs to the wallet being
 * built: compares dotted key paths (e.g. 'publicKeys.coinPublicKey') against
 * the derived key material. Any mismatch (wrong seed) -> false, so the caller
 * falls back to a fresh wallet instead of restoring someone else's state.
 */
export function sectionSnapshotMatches(
  serialized: string | undefined,
  expected: Record<string, unknown>,
): boolean {
  if (!serialized) return false;
  try {
    const snapshot = JSON.parse(serialized) as Record<string, any>;
    for (const [path, want] of Object.entries(expected)) {
      if (want === undefined) continue;
      let have: unknown = snapshot;
      for (const part of path.split('.')) {
        have = (have as Record<string, unknown> | undefined)?.[part];
      }
      if (have !== undefined && String(have) !== String(want)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
