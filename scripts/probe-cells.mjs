// Probe 2: ledger cell shapes for test assertions.
import * as ocrt from '@midnightntwrk/onchain-runtime-v4';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../managed/hushpot/contract/index.js';

const seed = '0'.repeat(64);
const address = rt.dummyContractAddress();
const ps = { sk: new Uint8Array(32).fill(7), amount: 25n };
const sc = new Contract({
  localSk: (ctx) => [ctx.privateState, ps.sk],
  localPledgeAmount: (ctx) => [ctx.privateState, ps.amount],
});
const ctor = await sc.initialState(rt.createConstructorContext(ps, seed), 3n, 10n);
let state = ctor.currentContractState;
const call = async (id, privateState, ...args) => {
  const ctx = rt.createCircuitContext(id, address, seed, state, privateState);
  const res = await sc.circuits[id](ctx, ...args);
  state = res.context.queryContexts[address].state;
  return res;
};
await call('join', ps);
await call('pledge', ps);

const qc = { state };
for (const i of [0, 1, 2, 3, 7, 8]) {
  const cell = qc.state[i];
  console.log(`cell[${i}] type=${cell?.constructor?.name} keys=${Object.keys(cell ?? {}).join(',')} str=${String(cell).slice(0, 60)}`);
  if (cell && typeof cell.to-js === 'undefined') {
    // print all own props
    for (const k of Object.getOwnPropertyNames(cell)) {
      try {
        const v = cell[k];
        console.log(`   .${k} =`, typeof v === 'function' ? '[fn]' : String(v).slice(0, 80));
      } catch {}
    }
  }
}
