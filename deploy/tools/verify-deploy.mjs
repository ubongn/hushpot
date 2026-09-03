// Verify a HushPot deployment against the Preprod indexer.
//
//   node tools/verify-deploy.mjs [contractAddress]
//
// Reads deploy/deployed-address.txt when no address argument is given.
// Writes the raw indexer response to deploy/logs/deploy-verify.txt.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const INDEXER = process.env.MIDNIGHT_INDEXER ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';

const argAddr = process.argv[2];
let address = argAddr;
if (!address) {
  try {
    address = readFileSync(join(root, 'deployed-address.txt'), 'utf8').trim();
  } catch {
    console.error('No address argument and no deployed-address.txt');
    process.exit(1);
  }
}

const query = `query Verify($address: HexEncoded!) {
  contractAction(address: $address) {
    address
    transaction {
      hash
      protocolVersion
      block {
        hash
        height
        timestamp
      }
    }
  }
}`;

const res = await fetch(INDEXER, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { address } }),
});
const body = await res.json();

const header = [
  `# HushPot deploy verification`,
  `# time (UTC): ${new Date().toISOString()}`,
  `# indexer: ${INDEXER}`,
  `# contract address: ${address}`,
  `# http status: ${res.status}`,
  '',
  JSON.stringify(body, null, 2),
  '',
].join('\n');

mkdirSync(join(root, 'logs'), { recursive: true });
writeFileSync(join(root, 'logs', 'deploy-verify.txt'), header);

console.log(header);
const found = body?.data?.contractAction;
if (found) {
  console.log(`VERIFIED: contract ${found.address} found in tx ${found.transaction?.hash} at block ${found.transaction?.block?.height}`);
  process.exit(0);
} else {
  console.log('NOT FOUND on indexer (null contractAction).');
  process.exit(2);
}
