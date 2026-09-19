@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
    docker compose exec backend python -m training.worker
) else (
    docker compose exec backend python -m training.worker --threads %*
)
