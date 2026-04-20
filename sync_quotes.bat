@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Checking Python...
python --version >nul 2>nul
if not "%ERRORLEVEL%"=="0" goto no_python

echo Checking AkShare dependencies...
python -c "import akshare, pandas" >nul 2>nul
if not "%ERRORLEVEL%"=="0" goto install_deps
goto ask_dates

:install_deps
echo First run needs AkShare and pandas. Installing now...
python -m pip install -r requirements.txt
if not "%ERRORLEVEL%"=="0" goto deps_failed
goto ask_dates

:ask_dates
echo.
set /p START_DATE=Start trading date YYYYMMDD, for example 20260420: 
set /p END_DATE=End/current date YYYYMMDD, for example 20260424: 

python sync_stocks.py --start %START_DATE% --end %END_DATE%
if not "%ERRORLEVEL%"=="0" goto sync_failed

echo.
echo Sync finished. Refresh admin.html, then click the data-file refresh button.
pause
exit /b 0

:no_python
echo Python was not found. Please install Python first, then run this file again.
pause
exit /b 1

:deps_failed
echo Dependency installation failed. Please check your network or run:
echo python -m pip install -r requirements.txt
pause
exit /b 1

:sync_failed
echo Sync failed. Please check the error message above.
pause
exit /b 1
