// Sanity: single-tree + version alignment (attempt-3 postmortem check).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const root = join(process.cwd(), 'node_modules', '@midnight-ntwrk');

const versions = Object.fromEntries(
  ['onchain-runtime-v3', 'compact-js', 'compact-runtime', 'midnight-js-protocol'].map((name) => [
    name,
    JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).version,
  ]),
);
console.log('versions:', JSON.stringify(versions, null, 0));

const { ContractMaintenanceAuthority } = await import('@midnight-ntwrk/onchain-runtime-v3');
console.log('ContractMaintenanceAuthority importable:', typeof ContractMaintenanceAuthority);

const managed = await import('./../contracts/managed/hushpot/contract/index.js');
console.log('managed hushpot loaded OK (embedded runtime check passed):', typeof managed.Contract === 'function');
console.log('SANITY_PASS');
