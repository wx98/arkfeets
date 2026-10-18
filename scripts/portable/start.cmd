@echo off
"%~dp0runtime\node\node.exe" "%~dp0start.mjs"
if errorlevel 1 pause
