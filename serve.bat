@echo off
rem Serves the Beta Lens builds on http://localhost:8000 (this computer only).
rem Live camera page: http://localhost:8000/beta-lens-live.html
rem Close this window to stop the server.
title Beta Lens preview server
cd /d "%~dp0dist"
echo.
echo   Beta Lens is running at http://localhost:8000/beta-lens-live.html
echo   Close this window to stop it.
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8000 --bind 127.0.0.1
) else (
  python -m http.server 8000 --bind 127.0.0.1
)
pause
