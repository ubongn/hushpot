import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type SealedVaultCircuits = 'sealNote' | 'openRevealing' | 'revealNote';

export type SealedVaultProviders = MidnightProviders<any>;

export function buildProviders<C extends string = SealedVaultCircuits>(
    wallet: MidnightWalletProvider,
    zkConfigPath: string,
    config: NetworkConfig,
    privateStateStoreName = `midnight-private-state-${Date.now()}`,
): MidnightProviders<any> {
    const zkConfigProvider = new NodeZkConfigProvider<C>(zkConfigPath);

    return {
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName,
            privateStoragePasswordProvider: () => 'midnight-deploy-password',
            accountId: wallet.getCoinPublicKey(),
        }),
        publicDataProvider: indexerPublicDataProvider(
            config.indexer,
            config.indexerWS,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(
            config.proofServer,
            zkConfigProvider,
        ),
        walletProvider: wallet,
        midnightProvider: wallet,
    };
}
