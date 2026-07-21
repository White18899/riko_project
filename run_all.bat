@echo off
title Riko AI Companion Launcher
cd /d "%~dp0"

echo ==================================================
echo        🌸 Starting Riko AI Companion 🌸
echo ==================================================

if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe run_all.py
) else (
    python run_all.py
)

pause
