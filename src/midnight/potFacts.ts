// PotFacts — read HushPot's public committed state straight from the indexer.
//
// Public state is public: no wallet needed. One GraphQL call
// (contractAction -> state) gives the serialized ContractState; the managed
// contract's `ledger()` decodes the fields. Everything shown here is exactly
// what any chain observer can see — pledge amounts are NOT in it.

import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { PotState, ledger } from '../../managed/hushpot/contract/index.js';
import { HUSHPOT_ADDRESS } from './hushpot';

export const POTFACTS_GRAPHQL =
  'https://indexer.preprod.midnight.network/api/v4/graphql';

export interface PotFactsData {
  capacity: bigint;
  minPledge: bigint;
  state: PotState;
  memberCount: bigint;
  pledgeCount: bigint;
  claimCount: bigint;
  claimTotal: bigint;
  /** Block-independent fetch timestamp. */
  fetchedAt: number;
}

const QUERY = /* GraphQL */ `
  query PotFacts($addr: HexEncoded!) {
    contractAction(address: $addr) {
      state
    }
  }
`;

const fromHex = (hex: string): Uint8Array => {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export async function fetchPotFacts(): Promise<PotFactsData> {
  const res = await fetch(POTFACTS_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { addr: HUSHPOT_ADDRESS } }),
  });
  if (!res.ok) {
    throw new Error(`Indexer HTTP ${res.status}`);
  }
  const json: { errors?: unknown[]; data?: { contractAction?: { state?: string } } } =
    await res.json();
  if (json.errors?.length) {
    throw new Error(`Indexer GraphQL error: ${JSON.stringify(json.errors[0])}`);
  }
  const hex = json.data?.contractAction?.state;
  if (!hex) {
    throw new Error('Indexer has no state for the HushPot contract address.');
  }

  const contractState = ContractState.deserialize(fromHex(hex));
  const L = ledger(contractState.data);
  return {
    capacity: L.capacity,
    minPledge: L.minPledge,
    state: L.state,
    memberCount: L.memberCount,
    pledgeCount: L.pledgeCount,
    claimCount: L.claimCount,
    claimTotal: L.claimTotal,
    fetchedAt: Date.now(),
  };
}

export { PotState };
