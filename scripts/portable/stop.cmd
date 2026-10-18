@echo off
title Arkfeets - Stop
"%~dp0runtime\node\node.exe" "%~dp0stop.mjs"
if errorlevel 1 (
  echo.
  echo Stop failed. Check the message above.
  if not defined ARKFEETS_NONINTERACTIVE pause
  exit /b 1
)
echo.
echo The server has been stopped. It is safe to close this window.
if not defined ARKFEETS_NONINTERACTIVE pause
