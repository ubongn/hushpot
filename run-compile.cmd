@echo off
title Midnight - compact compile (hello-world)
wsl -d mnc -u root -- bash -c "export PATH=/root/.local/bin:/root/.compact/bin:$PATH; cd /root/app; echo '== compact toolchain =='; compact --version; compact compile --version; echo; echo '== compact compile contracts/hello-world.compact contracts/managed/hello-world =='; rm -rf contracts/managed; compact compile contracts/hello-world.compact contracts/managed/hello-world && echo COMPILE_OK; echo; echo '== managed/ output (circuits + keys) =='; find contracts/managed -type f | sort"
echo.
echo Window kept open for screenshot.
pause
