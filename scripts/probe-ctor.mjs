// Probe 5: ContractState.data shape right after initialState.
import * as ocrt from '@midnight-ntwrk/onchain-runtime-v4';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../managed/hushpot/contract/index.js';

const ps = { sk: new Uint8Array(32).fill(1), amount: 0n };
const sc = new Contract({
  localSk: (c) => [c.privateState, c.privateState.sk],
  localPledgeAmount: (c) => [c.privateState, c.privateState.amount],
});
const ctor = await sc.initialState(rt.createConstructorContext(ps, '0'.repeat(64)), 3n, 10n);
const st = ctor.currentContractState;
console.log('ctor name:', st.constructor.name);
console.log('data ctor:', st.data?.constructor?.name, 'instanceof SV:', st.data instanceof ocrt.StateValue);
const arr = st.data?.asArray?.();
console.log('asArray len:', arr?.length);
if (arr) {
  const cap = arr[1].asCell();
  console.log('capacity cell value:', cap.value, Array.isArray(cap.value) ? 'array!' : typeof cap.value);
  console.log('minPledge cell value:', arr[2].asCell().value);
}
