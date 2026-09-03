// Probe 3: ChargedState introspection.
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
const ctx1 = rt.createCircuitContext('join', address, seed, state, ps);
const r1 = await sc.circuits.join(ctx1);
const charged = r1.context.queryContexts[address].state;
console.log('proto chain:', Object.getPrototypeOf(charged)?.constructor?.name, '->', Object.getPrototypeOf(Object.getPrototypeOf(charged))?.constructor?.name);
console.log('own props:', Object.getOwnPropertyNames(charged));
console.log('proto props:', Object.getOwnPropertyNames(Object.getPrototypeOf(charged)));
try {
  const sv = charged.state;
  console.log('charged.state ctor:', sv?.constructor?.name);
  const cell = sv[1];
  console.log('cell:', String(cell).slice(0, 80));
  console.log('cell props:', Object.getOwnPropertyNames(cell ?? {}));
  console.log('cell proto props:', Object.getOwnPropertyNames(Object.getPrototypeOf(cell ?? {})));
  for (const k of Object.getOwnPropertyNames(cell ?? {})) {
    try { console.log(`  .${k} =`, String(cell[k]).slice(0, 60)); } catch {}
  }
  console.log('counters[7]:', String(sv[7]).slice(0, 60), ' props:', Object.getOwnPropertyNames(sv[7] ?? {}));
  console.log('members map[4] ctor:', sv[4]?.constructor?.name, 'size:', sv[4]?.size);
} catch (e) {
  console.log('state access failed:', e.message);
}
