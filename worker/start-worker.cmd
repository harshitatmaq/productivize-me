@echo off
rem Starts the Scout worker from the repository root and restarts it if it stops.
rem Used by the Windows Task Scheduler entry described in worker/README.md.
cd /d "%~dp0\.."
:loop
call npm run worker
echo Scout worker stopped - restarting in 30 seconds (close this window to stop).
timeout /t 30 /nobreak >nul
goto loop
