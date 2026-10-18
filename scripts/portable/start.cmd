@echo off
title Arkfeets - Start
"%~dp0runtime\node\node.exe" "%~dp0start.mjs"
if errorlevel 1 (
  echo.
  echo Start failed. Check the message above or .runtime\stderr.log.
  if not defined ARKFEETS_NONINTERACTIVE pause
  exit /b 1
)
echo.
echo The server is running in the background. Closing this window will not stop it.
echo Use stop.cmd to stop the server.
if not defined ARKFEETS_NONINTERACTIVE pause
