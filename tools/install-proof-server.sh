#!/bin/bash
set -x
ls /root/proof-rootfs/nix/store/ | head -40
echo "store path count: $(ls /root/proof-rootfs/nix/store/ | wc -l)"
BIN=/root/proof-rootfs/nix/store/6naj0x3l5n0b4cx722xwasyp597p6z3h-ledger-8.1.0/bin/midnight-proof-server
file "$BIN" 2>/dev/null || head -c 100 "$BIN" | od -c | head -3
readelf -l "$BIN" 2>/dev/null | grep interpreter || echo "no readelf"
# install nix store to root
if [ ! -d /nix ]; then cp -a /root/proof-rootfs/nix /nix; fi
ls /nix/store | head -5
