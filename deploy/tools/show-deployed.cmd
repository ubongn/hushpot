@echo off
title Hushpot deployed (preprod)
cd /d "%~dp0.."
echo ==============================================================================
echo  HUSHPOT DEPLOYED ON PREPROD   [%DATE% %TIME%]
echo ==============================================================================
echo.
echo  deployed-address.txt:
type deployed-address.txt
echo.
echo  Live indexer verification (indexer.preprod.midnight.network, v4 GraphQL):
call node tools\verify-contract-indexer.mjs b14415c2f686ea1ab2dee103876cc3c2012830bc6a5e56a48d87f013c6f4abb4
echo.
echo  Deploy log (deploy\logs\deploy-supervisor.txt, run7 13:03):
powershell -NoProfile -Command "Select-String -Path logs\deploy-supervisor.txt -Pattern 'DEPLOYED|Deploy tx id|Deploying' | Select-Object -Last 3 | ForEach-Object { $_.Line -replace '\x1b\[[0-9;]*m','' }"
echo.
pause
