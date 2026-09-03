// Headless Hushpot simulator over @midnight-ntwrk/compact-runtime.
//
// Executes the REAL compiled circuits (managed/hushpot/contract/index.js)
// against an in-memory ledger - no network, no proof server. Each caller
// is modeled by its own private state ({sk, amount}), exactly like distinct
// wallets would supply distinct witnesses.
import * as ocrt from '@midnightntwrk/onchain-runtime-v4';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, Witnesses } from '../managed/hushpot/contract/index.js';

export type MemberPS = { sk: Uint8Array; amount: bigint };

export const SEED = '0'.repeat(64);

const witnesses: Witnesses<MemberPS> = {
  localSk: (ctx) => [ctx.privateState, ctx.privateState.sk],
  localPledgeAmount: (ctx) => [ctx.privateState, ctx.privateState.amount],
};

export const member = (byte: number, amount: bigint): MemberPS => ({
  sk: new Uint8Array(32).fill(byte),
  amount,
});

function stateValue(state: unknown): ocrt.StateValue {
  const s = state as { state?: unknown; data?: unknown };
  if (s?.state instanceof ocrt.StateValue) return s.state;
  if (s?.data instanceof ocrt.StateValue) return s.data;
  throw new Error('cannot extract StateValue from contract state');
}

export class HushpotSim {
  private readonly sc = new Contract<MemberPS, Witnesses<MemberPS>>(witnesses);
  private readonly address: string;
  private state: rt.CircuitContext<MemberPS>['queryContexts'][string] extends never ? never : any;

  private constructor(state: unknown, address: string) {
    this.state = state;
    this.address = address;
  }

  static async deploy(cap: bigint, minimum: bigint, host: MemberPS): Promise<HushpotSim> {
    const sc = new Contract<MemberPS, Witnesses<MemberPS>>(witnesses);
    const { currentContractState } = await sc.initialState(
      rt.createConstructorContext(host, SEED),
      cap,
      minimum,
    );
    return new HushpotSim(currentContractState, rt.dummyContractAddress());
  }

  /** Call a circuit as `actor`; chains the advanced ledger state. */
  async call(
    circuitId: 'join' | 'pledge' | 'provePledgeAtLeast' | 'closeEntries' | 'claim',
    actor: MemberPS,
    ...args: unknown[]
  ): Promise<rt.CircuitResults<MemberPS, unknown>> {
    const ctx = rt.createCircuitContext(circuitId, this.address, SEED, this.state, actor);
    const circuit = (this.sc.circuits as Record<string, (...a: unknown[]) => Promise<rt.CircuitResults<MemberPS, unknown>>>)[circuitId];
    const res = await circuit(ctx, ...args);
    this.state = res.context.queryContexts[this.address].state;
    return res;
  }

  /** Raw ledger cells (11 fields, declaration order). */
  cells(): ocrt.StateValue[] {
    return stateValue(this.state).asArray() as unknown as ocrt.StateValue[];
  }

  /** Decoded scalar cell (numbers, small ints, Bytes<32> as Uint8Array). */
  cell(i: number): number | bigint | Uint8Array {
    const c = (this.cells()[i] as unknown as { asCell: () => { value: number | bigint | Uint8Array } }).asCell();
    return c.value;
  }

  /** Cell rendered as hex (for commitment anchors). */
  cellHex(i: number): string {
    const v = this.cell(i);
    return Buffer.from(v as Uint8Array).toString('hex');
  }

  /** Size of a Set/Map ledger field. */
  mapSize(i: number): number {
    const m = (this.cells()[i] as unknown as { asMap: () => { keys: () => Iterable<unknown> } }).asMap();
    return [...m.keys()].length;
  }

  /** Keys of a Set/Map ledger field as hex strings (commitment anchors). */
  mapKeyHexes(i: number): string[] {
    const m = (this.cells()[i] as unknown as {
      asMap: () => { keys: () => Iterable<{ asCell: () => { value: Uint8Array } }> };
    }).asMap();
    return [...m.keys()].map((k) => Buffer.from(k.asCell().value).toString('hex'));
  }

  /** Canonical encoding of the whole ledger - proves (non-)mutation. */
  encoded(): Uint8Array {
    return stateValue(this.state).encode() as Uint8Array;
  }
}

// Ledger field indices (declaration order in hushpot.compact).
export const LEDGER = {
  host: 0,
  capacity: 1,
  minPledge: 2,
  state: 3,
  members: 4,
  pledges: 5,
  claims: 6,
  memberCount: 7,
  pledgeCount: 8,
  claimCount: 9,
  claimTotal: 10,
} as const;
