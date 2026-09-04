// HushPot circuit calls from the browser — mirrors deploy/src/hushpot-main.ts
// lifecycle but per-member: the member's secret key + pledge amount are
// generated in this tab, held in the in-memory private state provider, and
// only ever cross the circuit boundary as commitments/proofs.

import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract } from '../../managed/hushpot/contract/index.js';
import { HUSHPOT_ADDRESS, type CircuitId } from './hushpot';
import {
  CompiledHushpotContract,
  createHushpotPrivateState,
  type HushpotPrivateState,
} from './hushpot';
import type { HushpotProviders } from './providers';

export const MEMBER_PRIVATE_STATE_ID = 'member';

export interface CircuitCallResult {
  txId: string;
}

/** Per-session member identity: 32 random bytes, never persisted. */
export function freshMemberSecret(): Uint8Array {
  const sk = new Uint8Array(32);
  crypto.getRandomValues(sk);
  return sk;
}

async function seedPrivateState(
  providers: HushpotProviders,
  state: HushpotPrivateState,
): Promise<void> {
  providers.privateStateProvider.setContractAddress(HUSHPOT_ADDRESS);
  await providers.privateStateProvider.set(MEMBER_PRIVATE_STATE_ID, state);
}

async function callCircuit(
  providers: HushpotProviders,
  circuitId: CircuitId,
  args: unknown[],
): Promise<CircuitCallResult> {
  // Same variance cast as deploy/src/hushpot-main.ts: the zk config provider is
  // keyed by circuit-id strings, midnight-js wants the contract-typed union.
  const result = await submitCallTx<Contract<HushpotPrivateState>, CircuitId>(
    providers as never,
    {
      compiledContract: CompiledHushpotContract as never,
      contractAddress: HUSHPOT_ADDRESS,
      privateStateId: MEMBER_PRIVATE_STATE_ID,
      circuitId,
      args: args as never,
    },
  );
  return { txId: result.public.txId };
}

/** Join the pot with a hidden pledge amount (NIGHT, whole units). */
export async function joinPot(
  providers: HushpotProviders,
  sk: Uint8Array,
  pledgeAmount: bigint,
): Promise<CircuitCallResult> {
  await seedPrivateState(providers, createHushpotPrivateState(sk, pledgeAmount));
  return callCircuit(providers, 'join', []);
}

/** Pledge: moves the (already-hidden) amount into its on-chain commitment. */
export async function pledgePot(
  providers: HushpotProviders,
  sk: Uint8Array,
  pledgeAmount: bigint,
): Promise<CircuitCallResult> {
  await seedPrivateState(providers, createHushpotPrivateState(sk, pledgeAmount));
  return callCircuit(providers, 'pledge', []);
}

/** ZK proof: "my pledge is at least `threshold`" — amount never revealed. */
export async function provePledgeAtLeast(
  providers: HushpotProviders,
  sk: Uint8Array,
  pledgeAmount: bigint,
  threshold: bigint,
): Promise<CircuitCallResult> {
  await seedPrivateState(providers, createHushpotPrivateState(sk, pledgeAmount));
  return callCircuit(providers, 'provePledgeAtLeast', [threshold]);
}

