@echo off
setlocal
title Agentify ERP (local)
cd /d "%~dp0"

rem Double-click this file to run Agentify ERP on this computer.
rem It unpacks agentify-erp-full.zip the first time, then hands over to the
rem project's own starter (agentify-erp\run-agentify-erp.bat), which installs
rem packages, builds the app, frees port 4000 if needed and starts the server.

if not exist "agentify-erp\package.json" (
  if not exist "agentify-erp-full.zip" (
    echo Could not find agentify-erp-full.zip next to this file.
    echo Put this file in the same folder as the zip and run it again.
    pause & exit /b 1
  )
  echo Unpacking agentify-erp-full.zip into the agentify-erp folder...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path 'agentify-erp-full.zip' -DestinationPath 'agentify-erp' -Force"
  if errorlevel 1 ( echo Unpacking failed. & pause & exit /b 1 )
)

if not exist "agentify-erp\run-agentify-erp.bat" (
  echo The project folder is missing run-agentify-erp.bat. Delete the agentify-erp folder and run this file again.
  pause & exit /b 1
)

call "agentify-erp\run-agentify-erp.bat"
