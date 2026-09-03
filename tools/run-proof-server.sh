#!/bin/bash
BIN=/nix/store/6naj0x3l5n0b4cx722xwasyp597p6z3h-ledger-8.1.0/bin/midnight-proof-server
pkill -f midnight-proof-server 2>/dev/null; sleep 1
nohup "$BIN" --port 6300 -v > /root/proof-server.log 2>&1 &
echo "started pid $!"
sleep 6
echo "=== health ==="
curl -s --max-time 5 http://localhost:6300/health || echo "HEALTH FAILED"
echo
echo "=== log tail ==="
tail -20 /root/proof-server.log
