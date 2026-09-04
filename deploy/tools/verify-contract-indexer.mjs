// Verify a deployed contract is visible on the Midnight indexer.
//
//   node tools/verify-contract-indexer.mjs <contractAddress> [network]
//
// Uses the same GraphQL surface as midnight-js-indexer-public-data-provider
// (contractAction -> ContractDeploy -> transaction/block). Exit 0 = the
// indexer knows the deploy tx and reports a committed block height.

const [address, network = 'preprod'] = process.argv.slice(2);
if (!address) {
  console.error('usage: node tools/verify-contract-indexer.mjs <contractAddress> [preprod|mainnet]');
  process.exit(1);
}

const query = `query Verify($addr: HexEncoded!) {
  contractAction(address: $addr) {
    __typename
    ... on ContractDeploy {
      transaction {
        hash
        id
        protocolVersion
        contractActions { address }
        block { height }
      }
    }
  }
}`;

const url =
  network === 'mainnet'
    ? 'https://indexer.mainnet.midnight.network/api/v4/graphql'
    : 'https://indexer.preprod.midnight.network/api/v4/graphql';

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query, variables: { addr: address } }),
});
const json = await res.json();

if (json.errors?.length) {
  console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
  process.exit(1);
}

const action = json.data?.contractAction;
if (!action) {
  console.error(`contract ${address}: NOT FOUND on ${network} indexer (contractAction: null)`);
  process.exit(1);
}

const tx = action.transaction;
console.log(`contract ${address}: FOUND on ${network} indexer`);
console.log(`  deploy tx:    ${tx.hash}`);
console.log(`  tx id:        ${tx.id}`);
console.log(`  block height: ${tx.block?.height}`);
console.log(`  protocol:     ${tx.protocolVersion}`);
