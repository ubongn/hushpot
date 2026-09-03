#!/bin/bash
export PATH=/root/.local/bin:/root/.compact/bin:$PATH
cd /root
npx --yes create-mn-app@latest app --template hello-world --use-npm --skip-git 2>&1 | tail -40
echo "=== result ==="
ls -la /root/app 2>/dev/null
