// Headless Hushpot simulator over @midnight-ntwrk/compact-runtime.
//
// Executes the REAL compiled circuits (managed/hushpot/contract/index.js)
// against an in-memory state - no network, no proof server. Each caller
// is modeled by its own private state ({sk, amount}), exactly like distinct
// wallets would supply distinct witnesses.
import * as rt from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  Witnesses,
  ledger as ledgerView,
  type Ledger,
} from '../managed/hushpot/contract/index.js';

export type MemberPS = { sk: Uint8Array; amount: bigint };

/** Dummy zswap coin public key (hex string) for headless runs. */
const COIN_PUB_KEY = '1f'.repeat(32);

const witnesses: Witnesses<MemberPS> = {
  localSk: (ctx) => [ctx.privateState, ctx.privateState.sk],
  localPledgeAmount: (ctx) => [ctx.privateState, ctx.privateState.amount],
};

export const member = (byte: number, amount: bigint): MemberPS => ({
  sk: new Uint8Array(32).fill(byte),
  amount,
});

export const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export type CircuitId =
  | 'join'
  | 'pledge'
  | 'provePledgeAtLeast'
  | 'closeEntries'
  | 'claim';

export class HushpotSim {
  private state: rt.ChargedState;

  private constructor(
    private readonly sc: Contract<MemberPS, Witnesses<MemberPS>>,
    private readonly address: rt.ContractAddress,
    state: rt.ChargedState,
  ) {
    this.state = state;
  }

  static async deploy(
    cap: bigint,
    minimum: bigint,
    host: MemberPS,
  ): Promise<HushpotSim> {
    const sc = new Contract<MemberPS, Witnesses<MemberPS>>(witnesses);
    const res = await sc.initialState(
      rt.createConstructorContext(host, COIN_PUB_KEY),
      cap,
      minimum,
    );
    return new HushpotSim(
      sc,
      rt.dummyContractAddress(),
      res.currentContractState.data,
    );
  }

  /** Call a circuit as `actor`; chains the advanced ledger state. */
  async call(
    circuit: CircuitId,
    actor: MemberPS,
    ...args: unknown[]
  ): Promise<rt.CircuitResults<MemberPS, unknown>> {
    const ctx = rt.createCircuitContext(
      this.address,
      COIN_PUB_KEY,
      this.state,
      actor,
    );
    const fn = this.sc.circuits[circuit] as (
      ...a: unknown[]
    ) => rt.CircuitResults<MemberPS, unknown>;
    const res = await fn(ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    return res;
  }

  /** Typed view of the entire public ledger state. */
  ledger(): Ledger {
    return ledgerView(this.state);
  }

  /** Deterministic encoding of the whole public state (privacy snapshots). */
  encoded(): string {
    return this.state.toString();
  }

  /** Hex of the Bytes<32> commitment anchors stored in `members`. */
  memberAnchors(): string[] {
    return [...this.ledger().members].map(hex);
  }

  /** Hex pairs (anchor -> commitment) stored in `pledges`. */
  pledgeAnchors(): [string, string][] {
    return [...this.ledger().pledges].map(
      ([k, v]) => [hex(k), hex(v)] as [string, string],
    );
  }

  /** Hex of the claim nullifier anchors stored in `claims`. */
  claimAnchors(): string[] {
    return [...this.ledger().claims].map(hex);
  }
}
