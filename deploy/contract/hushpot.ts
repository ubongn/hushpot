// Wires the compiled Hushpot artifacts into a deployable CompiledContract.
// Mirrors the canonical bboard / hello-world contract wrapper pattern.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { Contract } from '../../managed/hushpot/contract/index.js';
import {
  hushpotWitnesses,
  createHushpotPrivateState,
  type HushpotPrivateState,
} from '../src/hushpot-witnesses.js';

export { Contract, hushpotWitnesses, createHushpotPrivateState };
export type { HushpotPrivateState };
export { ledger } from '../../managed/hushpot/contract/index.js';

/** Compiled artifacts (zkir + contract bundle) relative to deploy/ cwd. */
export const zkConfigPath = '../managed/hushpot';

export const CompiledHushpotContract = CompiledContract.make<
  Contract<HushpotPrivateState>
>('Hushpot', Contract<HushpotPrivateState>).pipe(
  CompiledContract.withWitnesses(hushpotWitnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
