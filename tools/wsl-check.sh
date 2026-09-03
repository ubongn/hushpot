#!/bin/bash
echo "=== OS ==="; cat /etc/os-release | head -2; uname -r
echo "=== compact ==="; export PATH="/root/.compact/bin:$PATH"; compact --version 2>&1; compact compile --version 2>&1
echo "=== node/npm ==="; node --version 2>&1; npm --version 2>&1
echo "=== compact bin dir ==="; ls /root/.compact/bin 2>/dev/null
echo "=== local bin ==="; ls /root/.local/bin 2>/dev/null
echo "=== tools ==="; which curl tar git yarn 2>&1
echo "=== glibc ==="; ldd --version | head -1
echo "=== root dir ==="; ls -la /root/
echo "=== compact detail ==="; find /root/.compact -maxdepth 3 2>/dev/null | head -20
