// Wires the compiled sealed-vault artifacts into a deployable CompiledContract.
// Mirrors the canonical example-bboard contract/src/index.ts pattern.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

export * from './managed/sealed-vault/contract/index.js';
export * from '../src/witnesses.js';

import { Contract } from './managed/sealed-vault/contract/index.js';
import {
  witnesses,
  type SealedVaultPrivateState,
} from '../src/witnesses.js';

export const CompiledSealedVaultContract = CompiledContract.make<
  Contract<SealedVaultPrivateState>
>('SealedVault', Contract<SealedVaultPrivateState>).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('./contract/managed/sealed-vault'),
);
