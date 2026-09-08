@echo off
REM Fetch-X one-command starter (Windows — double-click or run from cmd)
cd /d "%~dp0"

where python >nul 2>nul || (echo [!] Python not found - install from python.org & pause & exit /b 1)
where node >nul 2>nul || (echo [!] Node.js not found - install from nodejs.org & pause & exit /b 1)

echo [1/4] Backend setup...
if not exist backend\.venv python -m venv backend\.venv
call backend\.venv\Scripts\activate.bat
pip install -q -r backend\requirements.txt || (echo [!] pip install failed & pause & exit /b 1)
pushd backend
python seed_demo.py
start "Fetch-X Backend (keep open)" cmd /k uvicorn app.main:app --port 8000
popd

echo [2/4] Frontend setup...
pushd frontend
if not exist node_modules call npm install --no-audit --no-fund

echo [3/4] Finding a free port...
set PORT=3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul && set PORT=3001
netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul && set PORT=3002

echo.
echo ==================================================
echo    FETCH-X IS STARTING
echo    ^>^>^>  OPEN:  http://localhost:%PORT%  ^<^<^<
echo    (backend opens in its own window - keep both)
echo ==================================================
echo.
echo [4/4] Launching Vite on port %PORT% ...
call npm run dev -- --port %PORT%
pause
