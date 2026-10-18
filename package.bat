@echo off
setlocal
cd /d "%~dp0"
title Arkfeets - Build release
echo Building the production release...
call npm run package:win
if errorlevel 1 (
  echo.
  echo Packaging failed. Review the error above.
  if not defined ARKFEETS_NONINTERACTIVE pause
  exit /b 1
)
echo.
echo Release is ready in the release folder.
if not defined ARKFEETS_NONINTERACTIVE pause
