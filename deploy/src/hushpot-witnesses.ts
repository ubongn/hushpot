// Private state + witness implementations for the Hushpot contract.
//
// Hushpot's only hidden data per member: a secret key `sk` (identity,
// never crosses the circuit boundary) and the pledge `amount` (crosses
// only as a salted commitment; predicates like `amount >= threshold`
// run in-circuit).

import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Ledger } from '../../managed/hushpot/contract/index.js';

export type HushpotPrivateState = {
  readonly sk: Uint8Array;
  readonly amount: bigint;
};

export const createHushpotPrivateState = (
  sk: Uint8Array,
  amount: bigint,
): HushpotPrivateState => ({ sk, amount });

export const hushpotWitnesses = {
  localSk: ({
    privateState,
  }: WitnessContext<Ledger, HushpotPrivateState>): [
    HushpotPrivateState,
    Uint8Array,
  ] => [privateState, privateState.sk],

  localPledgeAmount: ({
    privateState,
  }: WitnessContext<Ledger, HushpotPrivateState>): [
    HushpotPrivateState,
    bigint,
  ] => [privateState, privateState.amount],
};
