// Hushpot deploy + lifecycle driver (standalone, no vitest).
//
//   tsx src/hushpot-main.ts address            print unshielded address for the faucet
//   tsx src/hushpot-main.ts deploy             sync, wait for funds, deploy Hushpot to Preprod
//   tsx src/hushpot-main.ts lifecycle [addr]   drive the full group-pot story on-chain
//   tsx src/hushpot-main.ts demo               deploy + lifecycle in one run
//
// Env:
//   MIDNIGHT_NETWORK       preprod | preview | local   (default preprod)
//   MIDNIGHT_PREPROD_SEED  64-char hex seed (deploy/.env.preprod)

import { WebSocket } from 'ws';

// @ts-expect-error WebSocket global assignment for apollo GraphQL subscriptions
globalThis.WebSocket = WebSocket;

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type EnvironmentConfiguration,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { walletStateEnabled } from './wallet-state.js';
import { buildProviders } from './providers.js';
import {
  CompiledHushpotContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../contract/hushpot.js';
import {
  createHushpotPrivateState,
  type HushpotPrivateState,
} from './hushpot-witnesses.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'preprod';
const mode = process.argv[2] ?? 'deploy';
const config = getConfig();
const envFile = `.env.${network}`;

// ---------------------------------------------------------------------
// Pot parameters (the demo story: 3 seats, min pledge 10, Alice 25 / Bob 40)
// ---------------------------------------------------------------------
const CAPACITY = 3n;
const MIN_PLEDGE = 10n;
const ALICE_AMOUNT = 25n;
const BOB_AMOUNT = 40n;

function loadEnvFile(): Record<string, string> {
  if (!existsSync(envFile)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function seedHex(): string {
  const env = loadEnvFile();
  const direct =
    process.env['MIDNIGHT_PREPROD_SEED'] ?? process.env['MIDNIGHT_PREVIEW_SEED'];
  const seed = direct ?? env['MIDNIGHT_PREPROD_SEED'] ?? env['MIDNIGHT_PREVIEW_SEED'];
  if (!seed) throw new Error(`No wallet seed: set MIDNIGHT_${network.toUpperCase()}_SEED in ${envFile}`);
  return seed.trim();
}

/** Deterministic per-actor secret keys (identities stay private on-chain). */
function actorSk(actor: 'host' | 'alice' | 'bob'): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`${seedHex()}:hushpot:${actor}`).digest(),
  );
}

const ADDRESS_FILE = 'deployed-address.txt';
const STATE_FILE = 'hushpot-state.json';

function saveDeploy(address: ContractAddress, txHash: string) {
  writeFileSync(ADDRESS_FILE, `${address}\n`);
  const existing = existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    : {};
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { ...existing, [network]: { address: String(address), deployTx: txHash } },
      null,
      2,
    ),
  );
}

function loadDeployAddress(): ContractAddress {
  const arg = process.argv[3];
  if (arg) return arg as ContractAddress;
  if (existsSync(ADDRESS_FILE)) {
    return readFileSync(ADDRESS_FILE, 'utf8').trim() as ContractAddress;
  }
  throw new Error('No contract address: run `deploy` first or pass one as arg');
}

const formatNight = (raw: bigint) =>
  `${raw / 1_000_000n}.${(raw % 1_000_000n).toString().padStart(6, '0')}`;

async function main() {
  setNetworkId(config.networkId);

  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  const secret = { kind: 'seed' as const, value: seedHex() };
  const wallet = await MidnightWalletProvider.build(logger, envConfig, secret);

  // File-backed wallet state (WALLET_STATE_FILE, default ON): checkpoint the
  // tx history + sync cursors periodically during long syncs and on
  // SIGINT/SIGTERM so a restart resumes instead of re-scanning from genesis.
  if (walletStateEnabled()) {
    const checkpoint = setInterval(() => void wallet.flush(), 10 * 60_000);
    checkpoint.unref?.();
    const onSignal = (signal: NodeJS.Signals) => {
      void (async () => {
        logger.info(`${signal} received — flushing wallet state, then exiting...`);
        try {
          await wallet.stop();
        } finally {
          process.exit(signal === 'SIGINT' ? 130 : 143);
        }
      })();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  if (mode === 'address') {
    const addr = String(wallet.unshieldedKeystore.getBech32Address());
    console.log(`\nUnshielded address (${network}): ${addr}`);
    console.log(`Faucet: ${config.faucet}\n`);
    await wallet.stop();
    return;
  }

  if (mode !== 'deploy' && mode !== 'lifecycle' && mode !== 'demo') {
    throw new Error(`Unknown mode '${mode}' (address|deploy|lifecycle|demo)`);
  }

  try {
  await wallet.start();
  // Preprod dust-ledger scan from genesis takes >1h even with turbo batch settings,
  // so allow a generous ceiling (dust ~285 blocks/s observed; ~1.48M blocks).
  await syncWallet(logger, wallet.wallet, 4 * 60 * 60_000);

  const nightBalance = await waitForFunds(
    wallet.wallet,
    envConfig,
    true,
    wallet.unshieldedKeystore,
  );
  logger.info(`Wallet NIGHT balance on '${network}': ${formatNight(nightBalance)}`);

  const providers = buildProviders<'join' | 'pledge' | 'provePledgeAtLeast' | 'closeEntries' | 'claim'>(
    wallet,
    zkConfigPath,
    config,
    `hushpot-${Date.now()}`,
  );

  let contractAddress: ContractAddress;

  if (mode === 'deploy' || mode === 'demo') {
    logger.info(
      `Deploying Hushpot (capacity=${CAPACITY}, minPledge=${MIN_PLEDGE}) to '${network}'...`,
    );
    const host = createHushpotPrivateState(actorSk('host'), 50n);
    const deployed: DeployedContract<Contract<HushpotPrivateState>> =
      await deployContract<Contract<HushpotPrivateState>>(providers, {
        compiledContract: CompiledHushpotContract as never,
        privateStateId: 'Host',
        initialPrivateState: host,
        args: [CAPACITY, MIN_PLEDGE],
      });
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`=== HUSHPOT DEPLOYED ===`);
    logger.info(`Contract address: ${contractAddress}`);
    logger.info(`Deploy tx id:     ${deployed.deployTxData.public.txId}`);
    saveDeploy(contractAddress, deployed.deployTxData.public.txId);
  } else {
    contractAddress = loadDeployAddress();
    logger.info(`Using existing Hushpot at ${contractAddress}`);
  }

  if (mode === 'deploy') {
    await wallet.stop();
    return;
  }

  // -----------------------------------------------------------------
  // Lifecycle: the private group-pot story, all on-chain
  // -----------------------------------------------------------------
  type CircuitId = 'join' | 'pledge' | 'provePledgeAtLeast' | 'closeEntries' | 'claim';

  async function call(
    privateStateId: string,
    circuitId: CircuitId,
    args: unknown[] = [],
    note: string,
  ) {
    const result = await submitCallTx<Contract<HushpotPrivateState>, CircuitId>(
      providers,
      {
        compiledContract: CompiledHushpotContract as never,
        contractAddress,
        privateStateId,
        circuitId,
        args: args as never,
      },
    );
    logger.info(`${note} -> tx ${result.public.txId}`);
    return result;
  }

  async function queryLedger(retries = 20, delayMs = 3_000) {
    for (let i = 0; ; i++) {
      try {
        const state = await providers.publicDataProvider.queryContractState(
          contractAddress,
        );
        if (state !== null) return ledger(state.data);
      } catch (e) {
        logger.warn(`ledger query failed (${String(e)})`);
      }
      if (i >= retries) throw new Error('ledger query exhausted retries');
      await sleep(delayMs);
    }
  }

  // Seed Alice's and Bob's private states (distinct wallets-in-one for the demo;
  // real dApps: each member's own wallet holds their own sk).
  const psp = providers.privateStateProvider as unknown as {
    setContractAddress(a: ContractAddress): void;
    set(id: string, s: HushpotPrivateState): Promise<void>;
  };
  psp.setContractAddress(contractAddress);
  await psp.set('Alice', createHushpotPrivateState(actorSk('alice'), ALICE_AMOUNT));
  await psp.set('Bob', createHushpotPrivateState(actorSk('bob'), BOB_AMOUNT));

  logger.info('--- members join (identities stay private: only anchors on-chain) ---');
  await call('Alice', 'join', [], 'Alice joins the pot');
  await call('Bob', 'join', [], 'Bob joins the pot');
  let l = await queryLedger();
  logger.info(
    `ledger: members=${l.memberCount}/${l.capacity} (names never crossed the boundary)`,
  );

  logger.info('--- members pledge (amounts stay private: only commitments on-chain) ---');
  await call('Alice', 'pledge', [], 'Alice pledges (amount hidden)');
  await call('Bob', 'pledge', [], 'Bob pledges (amount hidden)');
  l = await queryLedger();
  logger.info(`ledger: pledges=${l.pledgeCount} (amounts never crossed the boundary)`);

  logger.info('--- ZK proofs: "my pledge is at least T" without revealing amounts ---');
  await call('Alice', 'provePledgeAtLeast', [20n], 'Alice proves pledge >= 20');
  await call('Bob', 'provePledgeAtLeast', [35n], 'Bob proves pledge >= 35');
  l = await queryLedger();
  logger.info(
    `ledger unchanged (pure predicate): members=${l.memberCount} pledges=${l.pledgeCount}`,
  );

  logger.info('--- host closes entries (public fact: no more pledges) ---');
  await call('Host', 'closeEntries', [], 'Host closes entries');

  logger.info('--- claims settle (the one deliberate amount disclosure) ---');
  await call('Alice', 'claim', [], 'Alice claims');
  await call('Bob', 'claim', [], 'Bob claims');

  l = await queryLedger(30, 4_000);
  logger.info(`final ledger: state=${l.state} memberCount=${l.memberCount} pledgeCount=${l.pledgeCount} claimCount=${l.claimCount} claimTotal=${l.claimTotal}`);

  if (
    l.state !== 1 ||
    l.memberCount !== 2n ||
    l.pledgeCount !== 2n ||
    l.claimCount !== 2n ||
    l.claimTotal !== ALICE_AMOUNT + BOB_AMOUNT
  ) {
    throw new Error(
      `final ledger mismatch: state=${l.state} memberCount=${l.memberCount} pledgeCount=${l.pledgeCount} claimCount=${l.claimCount} claimTotal=${l.claimTotal}`,
    );
  }
  logger.info('=== HUSHPOT LIFECYCLE VERIFIED ON-CHAIN ===');
  } finally {
    // Covers every exit path (deploy return above included — stop() is
    // idempotent) so the wallet state file is written even when the run
    // fails partway through the sync/deploy.
    await wallet.stop();
  }
}

main().catch(async (err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  process.exit(1);
});
