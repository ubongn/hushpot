@echo off
rem ===========================================================================
rem run-until-deployed.cmd - supervisor for the Hushpot preprod deploy.
rem
rem Loops `npm run hushpot:deploy` until it succeeds:
rem   - exit 0 AND deployed-address.txt exists  -> done, print the address
rem   - exit 2 (deployContract timeout, see DEPLOY_TIMEOUT_MS) or any crash
rem     -> cooldown, relaunch (max %MAX_ATTEMPTS% attempts total)
rem
rem Every restart hydrates the file-backed wallet state (WALLET_STATE_FILE,
rem default deploy/midnight-level-db/tx-history.json), so each attempt
rem resumes the indexer sync from the saved cursors - syncs get
rem progressively shorter instead of re-scanning from genesis.
rem
rem Run detached from the repo root, e.g.:
rem   cd deploy
rem   start /b cmd /c "tools\run-until-deployed.cmd >> logs\deploy-supervisor.txt 2>&1"
rem ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set MAX_ATTEMPTS=5
set COOLDOWN_SECONDS=120

rem ping-based sleep works even when stdin is detached (timeout.exe does not)
set COOLDOWN_PINGS=%COOLDOWN_SECONDS%
set /a COOLDOWN_PINGS+=1

set ATTEMPT=0

:loop
set /a ATTEMPT+=1
echo ==============================================================================
echo [%DATE% %TIME%] run-until-deployed: attempt %ATTEMPT%/%MAX_ATTEMPTS%
echo ==============================================================================
call npm run hushpot:deploy
set EC=!errorlevel!

if "%EC%"=="0" (
    if exist deployed-address.txt (
        echo [%DATE% %TIME%] deploy SUCCEEDED on attempt %ATTEMPT%.
        echo Contract address:
        type deployed-address.txt
        endlocal
        exit /b 0
    )
    echo [%DATE% %TIME%] exit code 0 but deployed-address.txt is missing - treating as failure.
) else (
    echo [%DATE% %TIME%] deploy attempt %ATTEMPT% exited with code %EC%.
)

if %ATTEMPT% GEQ %MAX_ATTEMPTS% goto :gaveup

echo [%DATE% %TIME%] cooling down %COOLDOWN_SECONDS%s before relaunch...
ping -n %COOLDOWN_PINGS% 127.0.0.1 >nul
goto :loop

:gaveup
echo [%DATE% %TIME%] run-until-deployed: GIVING UP after %MAX_ATTEMPTS% attempts.
echo Last exit code: %EC%. Inspect deploy\logs\ and the wallet state file
echo (deploy\midnight-level-db\tx-history.json) before retrying.
endlocal
exit /b 1
