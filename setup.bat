@echo off
chcp 65001 >nul
echo.
echo === AgentDockyard - Setup (dev) ===
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERREUR : Node.js non trouve.
  echo Telecharger sur https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo Node.js %NODE_VER% detecte

cd /d "%~dp0"

echo.
echo Installation des dependances npm...
call npm install
if %errorlevel% neq 0 (
  echo ERREUR : npm install a echoue.
  pause
  exit /b 1
)

echo.
echo === Setup termine - lancez start.bat pour demarrer en dev ===
echo.
pause
