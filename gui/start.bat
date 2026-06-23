@echo off
echo ==========================================
echo IPTV Filter Application - Windows Launcher
echo ==========================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python 3.8+ and try again.
    pause
    goto :eof
)

:: Check if virtual environment exists
IF NOT EXIST venv\Scripts\python.exe (
    echo [INFO] Creating virtual environment...
    python -m venv venv
    IF %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        goto :eof
    )
)

:: Activate virtual environment
echo [INFO] Activating virtual environment...
call venv\Scripts\activate.bat

:: Install dependencies
echo [INFO] Installing/verifying dependencies...
pip install -r requirements.txt
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    goto :eof
)

:: Launch the application
echo [INFO] Starting application...
python main.py

:: Deactivate upon exit
deactivate
pause
