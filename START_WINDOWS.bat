@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Habbo NFT Market Radar - starting...
echo.
where node >nul 2>&1
if errorlevel 1 goto NEED_NODE
set "NODE_MAJOR="
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto NEED_NODE
if %NODE_MAJOR% LSS 24 goto OLD_NODE
node -v
echo Read-only Habbo NFT scanner ready (no SDK installation needed).
echo.
echo Opening dashboard at http://127.0.0.1:38571
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process http://127.0.0.1:38571"
node server.mjs
if errorlevel 1 (
  echo ERROR: Application stopped unexpectedly.
  pause
  exit /b 1
)
exit /b 0
:OLD_NODE
echo ERROR: Node.js version %NODE_MAJOR% is too old for the installed Immutable SDK.
echo This version of Habbo NFT Market Radar requires Node.js 24 or newer.
echo.
echo Install Node.js 24 LTS (or newer) from:
echo https://nodejs.org/en/download
start "" "https://nodejs.org/en/download"
echo.
echo After installation, CLOSE this window and double-click START_WINDOWS.bat again.
echo If it still finds Node %NODE_MAJOR%, open a NEW Command Prompt and run: where node
pause
exit /b 1
:NEED_NODE
echo ERROR: Node.js was not found.
echo Install Node.js 24 LTS or newer from https://nodejs.org/en/download
start "" "https://nodejs.org/en/download"
pause
exit /b 1
