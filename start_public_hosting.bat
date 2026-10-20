@echo off
title Coastal View - Free Live Public Hosting
echo ========================================================
echo   Coastal View, Managed By Ani's
echo   100%% Free Permanent Live Hosting Launcher
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    pause
    exit /b 1
)

echo [1/2] Starting Coastal View Node.js server on port 3000...
start /b cmd /c "node server.js"

timeout /t 2 /nobreak >nul

echo [2/2] Connecting to Cloudflare Global Edge Network...
echo.
echo ========================================================
echo Look for your public HTTPS link (https://...trycloudflare.com) below:
echo ========================================================
echo.

C:\Users\Public\cloudflared.exe tunnel --url http://localhost:3000
