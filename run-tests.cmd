@echo off
title Midnight - HushPot test suite (29 tests)
cd /d C:\Users\Sabiedu\.qwenpaw\workspaces\hack_1\midnight-run
echo == toolchain ==
node --version
echo == npm test (vitest run) ==
call npm test > screenshots\tests-run.log 2>&1
type screenshots\tests-run.log
echo.
echo Window kept open for screenshot.
pause
