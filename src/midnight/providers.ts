// Browser providers for midnight-js 4.1.1 over the dapp-connector API (Lace).
//
// Node-side deploys use a local wallet + http proof server (deploy/src/*).
// In the browser there is no proof server and no seed: Lace injects
// `window.midnight.lace` (InitialAPI), and after `connect(networkId)` gives a
// ConnectedAPI that (a) proves transactions itself via getProvingProvider,
// (b) balances unsealed transactions, and (c) submits them as a relayer.
// This module adapts that API to the midnight-js provider interfaces.

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  createProofProvider,
  type ImportPrivateStatesOptions,
  type ImportPrivateStatesResult,
  type ImportSigningKeysOptions,
  type ImportSigningKeysResult,
  type MidnightProvider,
  type PrivateStateExport,
  type PrivateStateId,
  type PrivateStateProvider,
  type PublicDataProvider,
  type SigningKeyExport,
  type ExportPrivateStatesOptions,
  type ExportSigningKeysOptions,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  parseCoinPublicKeyToHex,
  parseEncPublicKeyToHex,
} from '@midnight-ntwrk/midnight-js-utils';
import type { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  Binding,
  type FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { provingProvider as zkirProvingProvider, jsonIrToBinary } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';

import { HushpotZkConfigProvider, fetchZkirJson } from './zkAssets';
import { TARGET_NETWORK_ID, type HushpotPrivateState } from './hushpot';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  if (hex.startsWith('midnight:')) hex = hex.slice(9);
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/** Midnight's dapp-connector expects 'midnight:' tagged hex strings. */
const tagHex = (bytes: Uint8Array): string => 'midnight:' + toHex(bytes);

/** Adapter: midnight-js WalletProvider -> dapp-connector ConnectedAPI. */
class ConnectorWalletProvider implements WalletProvider {
  private readonly coinPublicKey: Promise<string>;
  private readonly encryptionPublicKey: Promise<string>;

  constructor(private readonly api: ConnectedAPI) {
    // Lace reports keys in Bech32m; midnight-js wants hex.
    const netId = TARGET_NETWORK_ID as NetworkId;
    this.coinPublicKey = api.getShieldedAddresses().then(({ shieldedCoinPublicKey }) =>
      parseCoinPublicKeyToHex(shieldedCoinPublicKey, netId),
    );
    this.encryptionPublicKey = api.getShieldedAddresses().then(({ shieldedEncryptionPublicKey }) =>
      parseEncPublicKeyToHex(shieldedEncryptionPublicKey, netId),
    );
  }

  async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
    // UnboundTransaction = proofs + preimage binding, no signatures -> the
    // connector calls this an "unsealed" transaction.
    console.log('[HushPot] balanceTx: sending to wallet, tx bytes =', tx.serialize().length);
    const attempt = async (): Promise<FinalizedTransaction> => {
      const { tx: balanced } = await this.api.balanceUnsealedTransaction(tagHex(tx.serialize()), {
        payFees: true,
      });
      console.log('[HushPot] balanceTx: wallet returned', typeof balanced, 'len =', balanced?.length ?? 0);
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature' as SignatureEnabled['instance'],
        'proof' as Proof['instance'],
        'binding' as Binding['instance'],
        fromHex(balanced),
      ) as FinalizedTransaction;
    };
    try {
      return await attempt();
    } catch (first) {
      // Chrome MV3 service workers die after ~30s idle; a long in-browser ZK
      // proof (60-90s) outlives them. The first call after the gap fails
      // ("Error forwarding message" / "Request failed") but wakes the worker —
      // wait briefly and retry once.
      console.warn('[HushPot] balanceTx first attempt failed (wallet worker wake-up?), retrying in 3s…', first);
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const result = await attempt();
        console.log('[HushPot] balanceTx: retry SUCCEEDED');
        return result;
      } catch (e) {
        console.error('[HushPot] balanceTx FAILED after retry:', e);
        throw e;
      }
    }
  }

  getCoinPublicKey(): string {
    // Synchronous by interface; resolve upfront in the constructor and keep
    // the settled value here.
    return this.coinPk;
  }

  getEncryptionPublicKey(): string {
    return this.encPk;
  }

  private coinPk = '';
  private encPk = '';

  /** Wait for key resolution (called once during connect). */
  async ready(): Promise<void> {
    this.coinPk = await this.coinPublicKey;
    this.encPk = await this.encryptionPublicKey;
  }
}

/** Adapter: midnight-js MidnightProvider -> wallet as tx relayer. */
class ConnectorMidnightProvider implements MidnightProvider {
  constructor(private readonly api: ConnectedAPI) {}

  async submitTx(tx: FinalizedTransaction): Promise<string> {
    console.log('[HushPot] submitTx: sending to wallet');
    try {
      await this.api.submitTransaction(tagHex(tx.serialize()));
      const hash = tx.transactionHash();
      console.log('[HushPot] submitTx: OK, hash =', hash);
      return hash;
    } catch (e) {
      console.error('[HushPot] submitTx FAILED:', e);
      throw e;
    }
  }
}

/**
 * Session-scoped private state. The member secret + pledge amount live only
 * in this browser tab's memory â€” nothing is persisted, nothing is logged.
 */
export class InMemoryPrivateStateProvider
  implements PrivateStateProvider<PrivateStateId, HushpotPrivateState>
{
  private contractAddress: ContractAddress | null = null;
  private readonly states = new Map<string, HushpotPrivateState>();
  private readonly signingKeys = new Map<string, SigningKey>();

  setContractAddress(address: ContractAddress): void {
    this.contractAddress = address;
  }

  async set(id: PrivateStateId, state: HushpotPrivateState): Promise<void> {
    this.states.set(this.key(id), state);
  }

  async get(id: PrivateStateId): Promise<HushpotPrivateState | null> {
    return this.states.get(this.key(id)) ?? null;
  }

  async remove(id: PrivateStateId): Promise<void> {
    this.states.delete(this.key(id));
  }

  async clear(): Promise<void> {
    this.states.clear();
  }

  async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
    this.signingKeys.set(address, signingKey);
  }

  async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
    return this.signingKeys.get(address) ?? null;
  }

  async removeSigningKey(address: ContractAddress): Promise<void> {
    this.signingKeys.delete(address);
  }

  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
  }

  /**
   * Export/import is refused by design: HushPot private state (the member
   * secret + pledge amount) lives only in this tab's memory for the session
   * and is never serialized out of it.
   */
  async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
    throw new Error('HushPot private state is session-scoped and cannot be exported.');
  }

  async importPrivateStates(
    _exportData: PrivateStateExport,
    _options?: ImportPrivateStatesOptions,
  ): Promise<ImportPrivateStatesResult> {
    throw new Error('HushPot private state is session-scoped; import is not supported.');
  }

  async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
    throw new Error('HushPot signing keys are session-scoped and cannot be exported.');
  }

  async importSigningKeys(
    _exportData: SigningKeyExport,
    _options?: ImportSigningKeysOptions,
  ): Promise<ImportSigningKeysResult> {
    throw new Error('HushPot signing keys are session-scoped; import is not supported.');
  }

  private key(id: PrivateStateId): string {
    return this.contractAddress ? `${this.contractAddress}:${id}` : id;
  }
}

/**
 * Adapts HushpotZkConfigProvider to the zkir-v2 KeyMaterialProvider interface,
 * enabling fully in-browser proving via the zkir WASM — no wallet prover needed.
 */
const paramsCache = new Map<number, Uint8Array>();

function asZkirKeyMaterialProvider(zkConfig: HushpotZkConfigProvider): KeyMaterialProvider {
  return {
    async lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
      try {
        const [proverKey, verifierKey, irJson] = await Promise.all([
          zkConfig.getProverKey(keyLocation),
          zkConfig.getVerifierKey(keyLocation),
          fetchZkirJson(keyLocation),
        ]);
        // .zkir files are JSON; the zkir-v2 WASM expects binary IR prefixed
        // with 'midnight:ir-source[v2]:' — jsonIrToBinary does the conversion.
        const ir = jsonIrToBinary(irJson);
        return { proverKey, verifierKey, ir };
      } catch {
        return undefined;
      }
    },
    async getParams(k: number): Promise<Uint8Array> {
      // BLS proving parameters for the circuit's security level k.
      // Served from our own origin (public/bls-midnight-2p13.bin) because
      // Midnight's S3 fileshare has no CORS headers for browser fetches.
      const cached = paramsCache.get(k);
      if (cached) return cached;
      const res = await fetch(`./bls-midnight-2p${k}.bin`);
      if (!res.ok) {
        throw new Error(`Failed to load BLS params for k=${k}: HTTP ${res.status}`);
      }
      const params = new Uint8Array(await res.arrayBuffer());
      paramsCache.set(k, params);
      return params;
    },
  };
}

export interface HushpotProviders {
  privateStateProvider: InMemoryPrivateStateProvider;
  publicDataProvider: PublicDataProvider;
  zkConfigProvider: HushpotZkConfigProvider;
  proofProvider: ReturnType<typeof createProofProvider>;
  walletProvider: ConnectorWalletProvider;
  midnightProvider: ConnectorMidnightProvider;
  /** Indexer endpoints the wallet told us to use. */
  indexerUri: string;
  indexerWsUri: string;
}

/** Build the full browser provider set from a connected wallet API. */
export async function buildHushpotProviders(api: ConnectedAPI): Promise<HushpotProviders> {
  const config = await api.getConfiguration();

  const zkConfigProvider = new HushpotZkConfigProvider();
  const privateStateProvider = new InMemoryPrivateStateProvider();

  // Use the zkir WASM prover (runs entirely in-browser) instead of the
  // wallet's prover. This avoids 1AM's "tagged data does not begin with
  // 'midnight:'" bug where the wallet's ProvingProvider.check() passes
  // raw bytes to the WASM without the required midnight: prefix.
  const kmProvider = asZkirKeyMaterialProvider(zkConfigProvider);
  const provingProvider = zkirProvingProvider(kmProvider);
  const baseProver = createProofProvider(provingProvider);
  // Wrap with timing logs + wallet keep-alive: Chrome MV3 service workers die
  // after ~30s idle, but in-browser ZK proofs run 60-90s. Ping a cheap wallet
  // call every 20s while proving so the wallet worker survives to balance the
  // proven transaction.
  const proofProvider = {
    async proveTx(unprovenTx: never) {
      console.log('[HushPot] proveTx: starting ZK proof in-browser…');
      const keepAlive = setInterval(() => {
        api.getConfiguration().catch(() => {});
      }, 20_000);
      const t0 = performance.now();
      try {
        const result = await baseProver.proveTx(unprovenTx);
        console.log(`[HushPot] proveTx: DONE in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        return result;
      } finally {
        clearInterval(keepAlive);
      }
    },
  };

  const walletProvider = new ConnectorWalletProvider(api);
  await walletProvider.ready();

  return {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider: new ConnectorMidnightProvider(api),
    indexerUri: config.indexerUri,
    indexerWsUri: config.indexerWsUri,
  };
}
