@echo off
setlocal EnableDelayedExpansion
title LITMUS Setup

echo.
echo ============================================================
echo   LITMUS - Windows Setup
echo ============================================================
echo.

set "LITMUS_DIR=%~dp0"
if "%LITMUS_DIR:~-1%"=="\" set "LITMUS_DIR=%LITMUS_DIR:~0,-1%"
cd /d "%LITMUS_DIR%"

:: ── 1. Node.js ────────────────────────────────────────────────
echo [1/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Node.js not found.
    echo   Download and install Node.js 18 LTS from:
    echo     https://nodejs.org/en/download
    echo   Then re-run this script.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo    OK  Node.js %NODE_VER%

:: ── 2. PostgreSQL ─────────────────────────────────────────────
echo [2/6] Checking PostgreSQL...
where psql >nul 2>&1
if %errorlevel% neq 0 (
    set "PG_BIN="
    for /d %%V in ("C:\Program Files\PostgreSQL\*") do (
        if exist "%%V\bin\psql.exe" set "PG_BIN=%%V\bin"
    )
    if "!PG_BIN!"=="" (
        echo.
        echo   PostgreSQL not found.
        echo   Download from: https://www.postgresql.org/download/windows/
        echo   After installing, re-run this script.
        echo.
        pause
        exit /b 1
    )
    set "PATH=!PG_BIN!;%PATH%"
    echo    Found PostgreSQL at !PG_BIN!
) else (
    echo    OK  PostgreSQL in PATH
)

:: ── 3. Create .env ────────────────────────────────────────────
echo [3/6] Creating environment file...
if not exist "%LITMUS_DIR%\server\.env" (
    (
        echo DATABASE_URL="postgresql://litmus:litmus_dev_pass@localhost:5432/litmus_db"
        echo REDIS_URL="redis://localhost:6379"
        echo JWT_ACCESS_SECRET="dev-access-secret-change-in-production-32c"
        echo JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production-32c"
        echo JWT_ACCESS_EXPIRY="15m"
        echo JWT_REFRESH_EXPIRY="7d"
        echo PORT=3001
        echo NODE_ENV=development
        echo CLIENT_URL="http://localhost:5173"
        echo STORAGE_BACKEND=local
        echo SYNC_INTERVAL_MINUTES=30
        echo OCR_ENABLED=false
        echo LOGIN_RATE_LIMIT_MAX=100
        echo LOGIN_RATE_LIMIT_WINDOW_MS=60000
    ) > "%LITMUS_DIR%\server\.env"
    echo    Created server\.env
) else (
    echo    server\.env already exists
)

:: ── 4. PostgreSQL DB setup ────────────────────────────────────
echo [4/6] Setting up database...
echo.
echo   Enter the password for PostgreSQL's "postgres" superuser.
echo   (You set this when you installed PostgreSQL.)
echo   Press Enter to try with no password.
echo.
set /p "PG_SUPERPASS=  postgres password: "

set "PGPASSWORD=%PG_SUPERPASS%"
set "DB_USER=litmus"
set "DB_PASS=litmus_dev_pass"
set "DB_NAME=litmus_db"

:: Create user if not exists (ignore error if already exists)
psql -U postgres -h 127.0.0.1 -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='%DB_USER%') THEN CREATE USER %DB_USER% WITH PASSWORD '%DB_PASS%'; END IF; END $$;" 2>nul
:: Grant in case it exists but lacks rights
psql -U postgres -h 127.0.0.1 -c "ALTER USER %DB_USER% WITH PASSWORD '%DB_PASS%';" 2>nul

:: Create database if not exists
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE %DB_NAME% OWNER %DB_USER%;" 2>nul
echo    Database ready

:: ── 5. npm install ────────────────────────────────────────────
echo [5/6] Installing packages (first time ~1 minute)...
cd /d "%LITMUS_DIR%"
call npm install
if %errorlevel% neq 0 (
    echo.
    echo   npm install failed. Check your internet connection and retry.
    pause
    exit /b 1
)
echo    Packages installed

:: ── 6. Prisma + seed ─────────────────────────────────────────
echo [6/6] Setting up database schema and seed data...
cd /d "%LITMUS_DIR%\server"
call npx prisma db push --skip-generate
if %errorlevel% neq 0 (
    echo.
    echo   Prisma db push failed.
    echo   Make sure PostgreSQL is running and the password in server\.env is correct.
    pause
    exit /b 1
)
call npx prisma generate

:: Seed only if users table is empty
for /f %%c in ('psql -U %DB_USER% -h 127.0.0.1 -d %DB_NAME% -tAc "SELECT COUNT(*) FROM users" 2^>nul') do set "USER_COUNT=%%c"
if "%USER_COUNT%"=="0" (
    call npx ts-node --project tsconfig.json prisma/seed.ts
    echo    Seed data loaded
) else (
    echo    Database already seeded ^(skipping^)
)

echo.
echo ============================================================
echo   Setup complete!
echo.
echo   Run  start.bat  to launch LITMUS.
echo ============================================================
echo.
pause
