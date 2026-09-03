#!/bin/bash
R=/mnt/c/Users/Sabiedu/.qwenpaw/workspaces/hack_1/midnight-run
grep -o "checkRuntimeVersion('[0-9.]*')" $R/managed/hushpot/contract/index.js | head -1
python3 - <<'PY'
import json
d = json.load(open('/mnt/c/Users/Sabiedu/.qwenpaw/workspaces/hack_1/midnight-run/managed/hushpot/compiler/contract-info.json'))
print('compiler:', d.get('compiler-version'), '| runtime:', d.get('runtime-version'))
print('circuits:', sorted(c['name'] for c in d['circuits']))
print('witnesses:', sorted(w['name'] for w in d['witnesses']))
PY
ls $R/managed/hushpot/keys/
