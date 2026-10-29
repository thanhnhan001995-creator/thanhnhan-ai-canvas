@echo off
setlocal
cd /d "%~dp0"

set "desktopLauncher=%~dp0Content Flow Desktop.vbs"
if not exist "%desktopLauncher%" (
  echo Khong tim thay Content Flow Desktop.
  pause
  exit /b 1
)

start "" wscript.exe "%desktopLauncher%"
endlocal
