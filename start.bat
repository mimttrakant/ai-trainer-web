@echo off
setlocal
cd /d "%~dp0"
docker compose up --build -d --wait --wait-timeout 180
if errorlevel 1 (
    echo Startup failed. Check Docker Desktop and run docker compose logs.
    pause
    exit /b 1
)
echo App: http://127.0.0.1:5173
echo API: http://127.0.0.1:8000/docs
echo Database admin: http://127.0.0.1:8080
