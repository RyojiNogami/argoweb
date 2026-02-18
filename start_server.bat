@echo off
echo ==================================================
echo      ARGO: Generative Musical Interface
echo ==================================================
echo.
echo [1] Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH.
    echo Please install Python to run the local server.
    pause
    exit /b
)

echo [2] Starting Local Server...
echo.
echo     Access the app at: http://localhost:8000
echo.
echo     (Close this window to stop the server)
echo ==================================================
python -m http.server 8000
pause
