@echo off
setlocal EnableDelayedExpansion
title LITMUS

set "LITMUS_DIR=%~dp0"
if "%LITMUS_DIR:~-1%"=="\" set "LITMUS_DIR=%LITMUS_DIR:~0,-1%"
cd /d "%LITMUS_DIR%"

:: ── Sanity checks ─────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

if not exist "%LITMUS_DIR%\server\.env" (
    echo server\.env not found. Run setup.bat first.
    pause
    exit /b 1
)

if not exist "%LITMUS_DIR%\node_modules" (
    echo node_modules missing. Run setup.bat first.
    pause
    exit /b 1
)

:: ── Add PostgreSQL to PATH if not already there ───────────────
where psql >nul 2>&1
if %errorlevel% neq 0 (
    for /d %%V in ("C:\Program Files\PostgreSQL\*") do (
        if exist "%%V\bin\psql.exe" set "PATH=%%V\bin;%PATH%"
    )
)

echo.
echo ============================================================
echo   LITMUS is starting...
echo.
echo   App:   http://localhost:5173
echo   API:   http://localhost:3001
echo.
echo   Credentials:
echo     ops_user   / password123  (scanner)
echo     admin_user / password123  (admin)
echo.
echo   Close the Server and Client windows to stop.
echo ============================================================
echo.

:: Start server in its own window
start "LITMUS - Server" /d "%LITMUS_DIR%\server" cmd /k "npm run dev"

:: Wait for the server to come up before starting the client
timeout /t 4 /nobreak >nul

:: Start client in its own window
start "LITMUS - Client" /d "%LITMUS_DIR%\client" cmd /k "npm run dev"

:: Open browser after client dev server starts
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173"

echo Servers are running in separate windows.
echo This window can be closed.
echo.
pause >nul
