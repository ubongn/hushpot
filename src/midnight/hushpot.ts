// HushPot contract wiring for the browser.
//
// Mirrors deploy/contract/hushpot.ts but for the web build: the managed tree
// (managed/hushpot) supplies the contract type; the witnesses are pure and
// browser-safe; the compiled-contract assets (zkir/prover/verifier keys) are
// bundled as URLs and fetched lazily by src/midnight/zkAssets.ts.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Contract, type Ledger } from '../../managed/hushpot/contract/index.js';

/** The deployed HushPot contract on Preprod (see README "Contract Address"). */
export const HUSHPOT_ADDRESS =
  'b14415c2f686ea1ab2dee103876cc3c2012830bc6a5e56a48d87f013c6f4abb4';

/** Target network for the dapp. */
export const TARGET_NETWORK_ID = 'preprod' as const;

export type CircuitId = 'join' | 'pledge' | 'provePledgeAtLeast' | 'closeEntries' | 'claim';

export type HushpotPrivateState = {
  /** Member secret key — identity, never crosses the circuit boundary. */
  readonly sk: Uint8Array;
  /** The pledge amount — crosses only as a salted commitment. */
  readonly amount: bigint;
};

export const createHushpotPrivateState = (
  sk: Uint8Array,
  amount: bigint,
): HushpotPrivateState => ({ sk, amount });

export const hushpotWitnesses = {
  localSk: ({
    privateState,
  }: WitnessContext<Ledger, HushpotPrivateState>): [HushpotPrivateState, Uint8Array] => [
    privateState,
    privateState.sk,
  ],
  localPledgeAmount: ({
    privateState,
  }: WitnessContext<Ledger, HushpotPrivateState>): [HushpotPrivateState, bigint] => [
    privateState,
    privateState.amount,
  ],
};

export { Contract };
export type { Ledger };

/** Compiled HushPot contract with witnesses attached (browser flavor). */
export const CompiledHushpotContract = CompiledContract.make<Contract<HushpotPrivateState>>(
  'Hushpot',
  Contract<HushpotPrivateState>,
).pipe(CompiledContract.withWitnesses(hushpotWitnesses));
