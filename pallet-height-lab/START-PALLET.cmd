@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Pallet Loading Lab: http://127.0.0.1:5173/#pallet
echo Keep this window open while using the simulator. Press Ctrl+C to stop.
call npm.cmd run dev
pause
