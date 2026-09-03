// Probe 4: StateValue decode API.
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

const sv = state.state; // StateValue (array of 11)
console.log('sv.type:', sv.type);
const arr = sv.asArray();
console.log('asArray ->', arr?.constructor?.name, Array.isArray(arr) ? arr.length : '');
const describe = (v, depth = 0) => {
  if (v == null) return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => describe(x, depth + 1)).join(', ')}]`;
  const props = Object.getOwnPropertyNames(v);
  return `${v.constructor?.name}{${props.slice(0, 6).join(',')}}`;
};
for (let i = 0; i < 11; i++) {
  const cell = arr[i];
  let extra = '';
  try {
    const c = cell.asCell?.();
    if (c) extra = ` cell.value=${String(c.value).slice(0, 20)} props=${Object.getOwnPropertyNames(c).join('|')}`;
  } catch {}
  try {
    const m = cell.asMap?.();
    if (m && typeof m.size === 'number') extra = ` map.size=${m.size}`;
  } catch {}
  console.log(`[${i}] ${describe(cell)}${extra}`);
}
