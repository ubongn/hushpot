// Private state + witness implementations for the sealed-vault contract.
// Mirrors the bboard pattern: the only hidden data is the user's secret key
// plus the score they intend to seal/reveal.

import { Ledger } from '../contract/managed/sealed-vault/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export type SealedVaultPrivateState = {
  readonly secretKey: Uint8Array;
  readonly score: bigint;
};

export const createSealedVaultPrivateState = (
  secretKey: Uint8Array,
  score: bigint,
): SealedVaultPrivateState => ({ secretKey, score });

export const witnesses = {
  localSk: ({
    privateState,
  }: WitnessContext<Ledger, SealedVaultPrivateState>): [
    SealedVaultPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],

  localScore: ({
    privateState,
  }: WitnessContext<Ledger, SealedVaultPrivateState>): [
    SealedVaultPrivateState,
    bigint,
  ] => [privateState, privateState.score],
};
