@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-crypta.ps1" %*
set "CRYPTA_EXIT=%ERRORLEVEL%"
if not "%CRYPTA_EXIT%"=="0" pause
exit /b %CRYPTA_EXIT%
