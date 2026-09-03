#!/bin/bash
set -e
DEST=/mnt/c/Users/Sabiedu/.qwenpaw/workspaces/hack_1/midnight-run/contract
mkdir -p "$DEST"
cd /root/app
tar --exclude=./node_modules \
    --exclude=./*.log \
    --exclude=./.midnight-state.json \
    --exclude=./.midnight-wallet-state* \
    -cf - . | (cd "$DEST" && tar -xf -)
echo "mirrored:"
find "$DEST" -maxdepth 2 | head -20
