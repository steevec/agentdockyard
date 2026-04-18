@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules" (
  echo [INFO] Premier lancement - execution de setup.bat...
  call setup.bat
)

echo Demarrage d'AgentDockyard (dev)...
start "" npm start
