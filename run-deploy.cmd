@echo off
title Midnight - deploy to preview network
wsl -d mnc -u root -- bash -c "cd /root/app; echo '== npm run deploy -- --network preview =='; npm run deploy -- --network preview 2>&1 | tee /root/deploy.log; echo; echo '== .midnight-state.json =='; cat .midnight-state.json 2>/dev/null; echo; echo DEPLOY_WINDOW_DONE - kept open for screenshot"
echo.
pause
