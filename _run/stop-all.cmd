@echo off
REM stop-all.cmd — إيقاف Backend + Frontend محلياً.
REM
REM الاستخدام:
REM   _run\stop-all.cmd

echo Stopping local stack...

REM Kill Node (Next.js) and Python (uvicorn) processes started by run-all.cmd
taskkill /FI "WINDOWTITLE eq Frontend (Next.js)" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Backend (Python FastAPI)" /T /F >nul 2>&1

echo Done.