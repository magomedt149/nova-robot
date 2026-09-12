@echo off
setlocal
cd /d "%~dp0\.."
echo.
echo ==========================================
echo NOVA PERMANENT GPU - ONE TIME SETUP
echo ==========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_permanent_gpu_worker.ps1"
if errorlevel 1 (
  echo.
  echo Setup stopped with an error.
  pause
  exit /b 1
)
echo.
echo NOVA GPU Worker is installed and started.
echo It will start automatically when Windows logs in.
pause
