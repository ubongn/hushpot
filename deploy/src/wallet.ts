import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  type FacadeState,
  type UnshieldedKeystore,
  type WalletFacade,
  type DefaultConfiguration,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  createKeystore,
  mergeWalletEntries,
  DustWallet,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  type ShieldedWalletAPI,
  type UnshieldedWalletAPI,
  type DustWalletAPI,
} from '@midnight-ntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  WalletFactory,
  WalletSeeds,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';
import {
  type PersistedWalletState,
  loadPersistedWalletState,
  persistWalletState,
  sectionSnapshotMatches,
  walletStateEnabled,
  walletStatePath,
} from './wallet-state.js';

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private stopped = false;
  private flushInFlight: Promise<void> | null = null;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
    private readonly shieldedWallet: ShieldedWalletAPI,
    private readonly unshieldedWallet: UnshieldedWalletAPI,
    private readonly dustWallet: DustWalletAPI,
    private readonly txHistoryStorage: InMemoryTransactionHistoryStorage,
    private readonly networkId: string,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    return await this.wallet.finalizeRecipe(recipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  /**
   * Persist tx history + section snapshots (sync cursors included) to the
   * wallet state file. Safe to call at any time while the wallet is running
   * (also used as a periodic checkpoint during long syncs); failures are
   * logged and never propagate — persistence must not kill a deploy.
   */
  async flush(): Promise<void> {
    if (!walletStateEnabled()) return;
    if (this.flushInFlight) return this.flushInFlight;
    // Dedupe concurrent callers (periodic checkpoint racing stop()), but
    // ALWAYS clear the slot once settled — a resolved promise left here
    // would turn every later checkpoint into a no-op (exactly one write
    // per process, observed as run6's tx-history.json stuck at 11:21).
    const op = (async () => {
      try {
        const [shielded, unshielded, dust, txHistory] = await Promise.all([
          this.shieldedWallet.serializeState(),
          this.unshieldedWallet.serializeState(),
          this.dustWallet.serializeState(),
          this.txHistoryStorage.serialize(),
        ]);
        const path = persistWalletState({
          version: 1,
          networkId: this.networkId,
          savedAt: new Date().toISOString(),
          txHistory,
          sections: { shielded, unshielded, dust },
        });
        this.logger.info(`Wallet state persisted to ${path}`);
      } catch (err) {
        this.logger.warn(
          `Wallet state persistence failed (continuing): ${err instanceof Error ? err.message : err}`,
        );
      }
    })();
    this.flushInFlight = op;
    try {
      await op;
    } finally {
      if (this.flushInFlight === op) this.flushInFlight = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    // Flush BEFORE stopping the facade — section state observables must still
    // be live for serializeState() to read the sync cursors.
    await this.flush();
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    // Direct wallet construction mirroring testkit's FluentWalletBuilder.buildWithoutStarting(),
    // with one critical addition: `batchUpdates`. The SDK default (10 events / 1ms timeout /
    // 4ms spacing between batches) throttles the dust-ledger indexer scan to ~150 blocks/s,
    // i.e. ~2.5h to scan preprod from genesis (~1.48M blocks) — which is what killed the
    // previous deploy sessions. With turbo batching the indexer stream becomes the bottleneck
    // instead of an artificial sleep. Disable by setting MIDNIGHT_SYNC_TURBO=0. (Since the
    // file-backed wallet state below persists sync cursors across runs, a genesis scan only
    // ever happens once per machine.)
    const turbo = process.env['MIDNIGHT_SYNC_TURBO'] !== '0';

    // ---- Persistent wallet state (tx history + section sync cursors) ----
    // Hydrate from the previous run when WALLET_STATE_FILE is enabled (the
    // default); a restored wallet resumes indexer scans from its saved
    // appliedIndex/appliedId cursor instead of re-scanning from genesis.
    const persisted: PersistedWalletState | null = loadPersistedWalletState(
      env.walletNetworkId,
      logger,
    );
    const txHistoryStorage = persisted?.txHistory
      ? InMemoryTransactionHistoryStorage.restore(
          persisted.txHistory,
          WalletEntrySchema,
          mergeWalletEntries,
        )
      : new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    if (persisted?.txHistory) {
      logger.info(
        `Tx history hydrated: ${(await txHistoryStorage.getAll()).length} entries ` +
          `(state file ${walletStatePath()})`,
      );
    } else {
      logger.info(
        `Tx history starting empty${walletStateEnabled() ? ` (will persist to ${walletStatePath()})` : ' (WALLET_STATE_FILE disabled)'}`,
      );
    }

    const config = {
      indexerClientConnection: {
        indexerHttpUrl: env.indexer,
        indexerWsUrl: env.indexerWS,
        ...(turbo
          ? { bufferSize: 50_000, resumeThreshold: 1_000 }
          : {}),
      },
      provingServerUrl: new URL(env.proofServer),
      networkId: env.walletNetworkId,
      relayURL: new URL(env.nodeWS),
      txHistoryStorage,
      costParameters: { feeBlocksMargin: 5 },
      ...(turbo ? { batchUpdates: { size: 1_000, timeout: 100, spacing: 0 } } : {}),
    } as DefaultConfiguration;

    const seeds =
      secret.kind === 'mnemonic'
        ? WalletSeeds.fromMnemonic(secret.value)
        : WalletSeeds.fromMasterSeed(secret.value);
    const keystore = createKeystore(seeds.unshielded, env.walletNetworkId);
    const zswapKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
    const dustKeys = DustSecretKey.fromSeed(seeds.dust);

    // Section snapshots are only trusted when their embedded public keys match
    // the keys derived from THIS seed; otherwise fall back to a fresh wallet.
    const sections = persisted?.sections ?? {};
    const restoreSection = async <T>(
      name: string,
      snapshot: string | undefined,
      matches: boolean,
      restore: () => Promise<T> | T,
      fresh: () => T,
    ): Promise<T> => {
      if (!snapshot) return fresh();
      if (!matches) {
        logger.warn(`Ignoring persisted ${name} snapshot: key mismatch for this seed`);
        return fresh();
      }
      try {
        const wallet = await restore();
        logger.info(`${name} wallet restored from snapshot (resumes from saved cursor)`);
        return wallet;
      } catch (err) {
        logger.warn(
          `Failed to restore ${name} wallet from snapshot (${err instanceof Error ? err.message : err}); starting fresh`,
        );
        return fresh();
      }
    };

    const shieldedWallet = await restoreSection<ShieldedWalletAPI>(
      'shielded',
      sections.shielded,
      sectionSnapshotMatches(sections.shielded, {
        'publicKeys.coinPublicKey': zswapKeys.coinPublicKey,
      }),
      () => WalletFactory.restoreShieldedWallet(config, sections.shielded!),
      () => WalletFactory.createShieldedWallet(config, seeds.shielded),
    );

    // Note: built directly (mirroring WalletFactory.createUnshieldedWallet)
    // so the unshielded section shares the SAME tx history storage as
    // shielded/dust — the factory overwrites config.txHistoryStorage with a
    // private in-memory instance, which would split the persisted history.
    const unshieldedWallet = await restoreSection<UnshieldedWalletAPI>(
      'unshielded',
      sections.unshielded,
      sectionSnapshotMatches(sections.unshielded, {
        'publicKey.address': keystore.getBech32Address(),
      }),
      () => UnshieldedWallet(config).restore(sections.unshielded!),
      () =>
        UnshieldedWallet({ ...config, txHistoryStorage }).startWithPublicKey(
          PublicKey.fromKeyStore(keystore),
        ),
    );

    const dustWallet = await restoreSection<DustWalletAPI>(
      'dust',
      sections.dust,
      sectionSnapshotMatches(sections.dust, {
        'publicKey.publicKey': dustKeys.publicKey,
      }),
      () => DustWallet(config).restore(sections.dust!),
      () => WalletFactory.createDustWallet(config, seeds.dust, dustOptions),
    );

    const wallet = await WalletFactory.createWalletFacade(
      config,
      shieldedWallet,
      unshieldedWallet,
      dustWallet,
    );

    logger.info(
      `Wallet built from ${secret.kind}; master seed: ${seeds.masterSeed.slice(0, 8)}...`,
    );

    return new MidnightWalletProvider(
      logger,
      wallet,
      zswapKeys,
      dustKeys,
      keystore,
      shieldedWallet,
      unshieldedWallet,
      dustWallet,
      txHistoryStorage,
      env.walletNetworkId,
    );
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

function formatProgress(progress: unknown): string {
  const complete = isProgressStrictlyComplete(progress);
  if (!progress || typeof progress !== 'object') {
    return `${complete}`;
  }
  const p = progress as {
    appliedIndex?: bigint;
    highestRelevantWalletIndex?: bigint;
    appliedId?: bigint;
    highestTransactionId?: bigint;
  };
  const applied = p.appliedIndex ?? p.appliedId;
  const target = p.highestRelevantWalletIndex ?? p.highestTransactionId;
  if (applied === undefined || target === undefined) {
    return `${complete}`;
  }
  return `${complete} (${applied}/${target})`;
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  let lastLogged = 0;
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.state.progress);
        // Log at most every 2s (or on completion) — per-emission logging becomes a
        // bottleneck itself once the turbo batch settings speed the sync up.
        const now = Date.now();
        if (now - lastLogged < 2_000 && !(shielded && unshielded && dust)) return;
        lastLogged = now;
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${formatProgress(state.shielded.state.progress)}, ` +
            `unshielded=${formatProgress(state.unshielded.progress)}, dust=${formatProgress(state.dust.state.progress)}`,
        );
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received)`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
}
