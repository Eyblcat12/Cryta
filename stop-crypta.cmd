@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-crypta.ps1" -Stop
set "CRYPTA_EXIT=%ERRORLEVEL%"
pause
exit /b %CRYPTA_EXIT%
