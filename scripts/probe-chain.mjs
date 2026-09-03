// Probe: how does state thread across sequential circuit calls?
import * as ocrt from '@midnightntwrk/onchain-runtime-v4';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../managed/hushpot/contract/index.js';

const seed = '0'.repeat(64);
const address = rt.dummyContractAddress();

const mkWitness = (ps) => ({
  localSk: (ctx) => [ctx.privateState, ps.sk],
  localPledgeAmount: (ctx) => [ctx.privateState, ps.amount],
});

const ps = { sk: new Uint8Array(32).fill(7), amount: 25n };
const sc = new Contract(mkWitness(ps));

const ctor = await sc.initialState(rt.createConstructorContext(ps, seed), 3n, 10n);
console.log('ctor keys:', Object.keys(ctor));
console.log('currentContractState ctor:', ctor.currentContractState?.constructor?.name);

const mkCtx = (id, contractState, privateState) =>
  rt.createCircuitContext(id, address, seed, contractState, privateState);

// call 1: join
const r1 = await sc.circuits.join(mkCtx('join', ctor.currentContractState, ps));
console.log('join result keys:', Object.keys(r1));
console.log('r1.result:', r1.result);
console.log('r1.context keys:', Object.keys(r1.context));
console.log('queryContexts:', Object.keys(r1.context.queryContexts ?? {}));

// Try to read ledger through the advanced query context
const qc = r1.context.queryContexts?.[Object.keys(r1.context.queryContexts)[0]];
console.log('qc ctor:', qc?.constructor?.name);

// call 2: pledge, chaining the advanced ledger state (qc.state as StateValue)
const qc1 = r1.context.queryContexts[address];
console.log('qc1.state ctor:', qc1.state?.constructor?.name, 'instanceof StateValue:', qc1.state instanceof ocrt.StateValue);
const r2 = await sc.circuits.pledge(mkCtx('pledge', qc1.state, ps));
console.log('pledge OK -> result:', r2.result);
const qc2 = r2.context.queryContexts[address];
console.log('qc2.state:', String(qc2.state).slice(0, 400));
