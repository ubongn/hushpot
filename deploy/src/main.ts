// Sealed Vault deploy + interact script (no vitest, standalone).
//
//   tsx src/main.ts address   -> print wallet address for faucet, then exit
//   tsx src/main.ts run       -> full flow: sync, wait for funds, deploy,
//                                sealNote, openRevealing, revealNote, verify ledger
//
// Env:
//   MIDNIGHT_NETWORK       preprod | preview | local   (default preprod)
//   MIDNIGHT_PREPROD_SEED  64-char hex seed (created+persisted on first run)
//   VAULT_SCORE            score to seal, 1..5 (default 5)
//   VAULT_SK               64-char hex secret key for commitments (default: derived)

import { WebSocket } from 'ws';

// @ts-expect-error WebSocket global assignment for apollo GraphQL subscriptions
globalThis.WebSocket = WebSocket;

import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
import { buildProviders, type SealedVaultProviders } from './providers.js';
import {
  CompiledSealedVaultContract,
  Contract,
  ledger,
  type SealedVaultPrivateState,
} from '../contract/index.js';
import { createSealedVaultPrivateState } from './witnesses.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'preprod';
const mode = process.argv[2] ?? 'run';
const config = getConfig();
const envFile = `.env.${network}`;

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
  const fromFile = env['MIDNIGHT_PREPROD_SEED'] ?? env['MIDNIGHT_PREVIEW_SEED'];
  const direct = process.env['MIDNIGHT_PREPROD_SEED'] ?? process.env['MIDNIGHT_PREVIEW_SEED'];
  const seed = direct ?? fromFile;
  if (seed) return seed.trim();
  const fresh = randomBytes(32).toString('hex');
  writeFileSync(envFile, `MIDNIGHT_${network.toUpperCase()}_SEED=${fresh}\n`);
  console.log(`Generated fresh wallet seed, saved to ${envFile}`);
  return fresh;
}

function vaultSecretKey(): Uint8Array {
  const direct = process.env['VAULT_SK'];
  if (direct && /^[0-9a-fA-F]{64}$/.test(direct)) {
    return new Uint8Array(Buffer.from(direct, 'hex'));
  }
  // deterministic per-wallet, per-contract secret for commitments
  return new Uint8Array(
    createHash('sha256')
      .update(`${seedHex()}:sealed-vault:v1`)
      .digest(),
  );
}

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

  if (mode === 'address') {
    const addr = String(wallet.unshieldedKeystore.getBech32Address());
    console.log(`\nUnshielded address (${network}): ${addr}`);
    console.log(`Faucet: ${config.faucet}`);
    console.log('Fund it, then run: tsx src/main.ts run\n');
    await wallet.stop();
    return;
  }

  await wallet.start();
  await syncWallet(logger, wallet.wallet, 60 * 60_000);

  const nightBalance = await waitForFunds(
    wallet.wallet,
    envConfig,
    false,
    wallet.unshieldedKeystore,
  );
  logger.info(`Wallet NIGHT balance on '${network}': ${nightBalance}`);

  const providers: SealedVaultProviders = buildProviders(
    wallet,
    './contract/managed/sealed-vault',
    config,
  );
  logger.info(`Providers initialized on '${network}'. Deploying...`);

  const score = BigInt(process.env['VAULT_SCORE'] ?? '5');
  const initialPrivateState: SealedVaultPrivateState = createSealedVaultPrivateState(
    vaultSecretKey(),
    score,
  );
  const PRIVATE_STATE_ID = 'VaultOperator';

  const deployed: DeployedContract<Contract<SealedVaultPrivateState>> =
    await deployContract<Contract<SealedVaultPrivateState>>(providers, {
      compiledContract: CompiledSealedVaultContract as never,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });

  const contractAddress: ContractAddress =
    deployed.deployTxData.public.contractAddress;
  logger.info(`Contract deployed at: ${contractAddress}`);
  logger.info(`Deploy tx hash: ${deployed.deployTxData.public.txHash}`);

  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(
      contractAddress,
    );
    if (state === null) throw new Error('contract state not found');
    return ledger(state.data);
  }

  async function call(circuitId: 'sealNote' | 'openRevealing' | 'revealNote') {
    const result = await submitCallTx<Contract<SealedVaultPrivateState>, typeof circuitId>(
      providers,
      {
        compiledContract: CompiledSealedVaultContract as never,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId,
        args: [],
      },
    );
    logger.info(`${circuitId} tx: ${result.txHash}`);
    return result;
  }

  logger.info('Sealing private note (score hidden on-chain)...');
  await call('sealNote');
  let state = await queryLedger();
  logger.info(
    `After seal: sealedCount=${state.sealedCount}, commitments=${state.commitments.size()} (scores remain private)`,
  );

  logger.info('Opening reveal phase...');
  await call('openRevealing');

  logger.info('Revealing note (proof that score is unchanged)...');
  await call('revealNote');
  state = await queryLedger();
  logger.info(
    `After reveal: revealedCount=${state.revealedCount}, scoreTotal=${state.scoreTotal}`,
  );

  writeFileSync(
    'deploy-record.json',
    JSON.stringify(
      {
        network,
        contractAddress: String(contractAddress),
        deployedAt: new Date().toISOString(),
        operatorAddress: String(wallet.unshieldedKeystore.getBech32Address()),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('deploy-record.json written.');

  await wallet.stop();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
