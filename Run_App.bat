@echo off
setlocal
cd /d "%~dp0"

set "desktopLauncher=%~dp0Tesseract.vbs"
if not exist "%desktopLauncher%" (
  echo Khong tim thay Tesseract.
  pause
  exit /b 1
)

start "" wscript.exe "%desktopLauncher%"
endlocal
