#!/bin/bash
cd /root/app
ls -la .midnight* 2>/dev/null
python3 -c "
import json
d=json.load(open('.midnight-state.json'))
def mask(v):
    s=str(v)
    return s if len(s)<60 else s[:25]+'...['+str(len(s))+' chars]'
for k in d: print(k,'=',mask(d[k]))
"
echo "=== derive preview address from seed ==="
cat > /root/app/scripts/show-address.mjs <<'JS'
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket;
import { HDWallet, Roles, createKeystore } from '@midnightntwrk/wallet-sdk';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as fs from 'node:fs';
const state = JSON.parse(fs.readFileSync('.midnight-state.json','utf8'));
const seed = state.wallets.preview.seed;
setNetworkId('preview');
const hd = HDWallet.fromSeed(Buffer.from(seed,'hex'));
const keys = hd.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
const ks = createKeystore(keys[Roles.NightExternal], 'preview');
console.log('PREVIEW_UNSHIELDED_ADDRESS=' + ks.getBech32Address());
JS
node scripts/show-address.mjs 2>&1 | tail -3
