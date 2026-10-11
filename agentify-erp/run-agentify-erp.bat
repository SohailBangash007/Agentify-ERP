@echo off
setlocal
title Agentify ERP (local)
cd /d "%~dp0"

rem ===== Settings you may change =====
set PORT=4000
set ERP_BASE_DOMAIN=localhost
set PLATFORM_ADMIN_EMAIL=admin@agentify.local
set PLATFORM_ADMIN_PASSWORD=ChangeMe-12345
rem ====================================
rem The platform admin is created only the first time the server starts. Change the password inside the console afterwards.

if not exist "package.json" (
  echo This file must sit in the project folder, next to package.json.
  echo If you just unzipped, open the inner folder and put this file there.
  pause & exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install version 22 or newer from https://nodejs.org then run this file again.
  pause & exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo Node.js %NODEMAJOR% is too old. Install version 22 or newer from https://nodejs.org
  pause & exit /b 1
)

if not exist "server\node_modules" (
  echo Installing packages. This takes a few minutes the first time...
  call npm run install:all || (echo Install failed. & pause & exit /b 1)
)
if not exist "client\dist\index.html" (
  echo Building the app...
  call npm run build || (echo Build failed. & pause & exit /b 1)
)

rem A server that is already listening on the port (for example the old project) would answer instead of this one.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set BUSYPID=%%p
if defined BUSYPID (
  echo Port %PORT% is already used by another program ^(process %BUSYPID%^). This is usually an older copy of the ERP server.
  for /f "tokens=1" %%n in ('tasklist /FI "PID eq %BUSYPID%" /NH') do echo    It is: %%n
  choice /C YN /M "Stop it and continue"
  if errorlevel 2 ( echo Close it yourself, then run this file again. & pause & exit /b 1 )
  taskkill /PID %BUSYPID% /F >nul
  timeout /t 2 >nul
)

echo.
echo  Agentify ERP is starting.
echo    Website:           http://localhost:%PORT%
echo    Create workspace:  http://localhost:%PORT%/signup
echo    Platform console:  http://localhost:%PORT%/platform   (%PLATFORM_ADMIN_EMAIL%)
echo  Always use port %PORT% (not 5173). Close this window or press Ctrl+C to stop.
echo.

start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:%PORT%"
call npm start
echo.
echo The server stopped. If it says the port is in use, close the other Agentify window or change PORT at the top of this file.
pause
