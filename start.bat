@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ==== Opera AI Reply ====
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js غير مثبت. حمّله من https://nodejs.org (الإصدار 22 أو أحدث)
  pause
  exit /b 1
)

start "" http://localhost:3000/
node --no-warnings server/index.js
pause
