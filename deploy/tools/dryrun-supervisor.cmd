@echo off
rem DRY-RUN copy of run-until-deployed.cmd: replaces the real deploy with a
rem stub that fails (exit 2) then succeeds, and shrinks the cooldown.
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set MAX_ATTEMPTS=5
set COOLDOWN_SECONDS=1
set COOLDOWN_PINGS=2
set ATTEMPT=0
set STUB_STATE_FILE=%TEMP%\run-until-deployed-dryrun-state.txt
if exist "%STUB_STATE_FILE%" del "%STUB_STATE_FILE%"

:loop
set /a ATTEMPT+=1
echo [test] attempt !ATTEMPT!/%MAX_ATTEMPTS%
rem stub: attempt 1-2 "time out" (exit 2), attempt 3 succeeds and writes the file
if !ATTEMPT! LSS 3 (
    call :stubdeploy 2
) else (
    call :stubdeploy 0
)
set EC=!errorlevel!
echo [test] exit code !EC!
if "%EC%"=="0" (
    if exist deployed-address.txt (
        echo [test] SUCCESS on attempt !ATTEMPT!
        type deployed-address.txt
        del deployed-address.txt
        endlocal
        exit /b 0
    )
    echo [test] exit 0 but no address file
) else (
    echo [test] deploy attempt !ATTEMPT! exited !EC!
)
if !ATTEMPT! GEQ %MAX_ATTEMPTS% goto :gaveup
echo [test] cooldown...
ping -n %COOLDOWN_PINGS% 127.0.0.1 >nul
goto :loop

:gaveup
echo [test] GAVE UP
endlocal
exit /b 1

:stubdeploy
if "%~1"=="0" echo 00test-address-00> deployed-address.txt
exit /b %~1
