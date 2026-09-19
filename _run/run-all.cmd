@echo off
REM run-all.cmd — تشغيل Backend (Python FastAPI) + Frontend (Next.js) معاً محلياً.
REM
REM الاستخدام (من داخل extruct):
REM   _run\run-all.cmd
REM
REM يُشغّل:
REM   1. Python FastAPI على http://127.0.0.1:8000
REM   2. Next.js dev على http://localhost:3000 (يُ proxy /api/py/... إلى 8000)
REM
REM لوقفها: رُنّ _run\stop-all.cmd أو أغلقنوافذها.

set "ROOT=%~dp0.."
set "PY_DIR=%ROOT%\mini-services\py-extractor"
set "WEB_DIR=%ROOT%"

echo === extruct local stack ===
echo ROOT: %ROOT%

REM 1) Backend Python
echo [1/2] Starting Python FastAPI on http://127.0.0.1:8000 ...
start "Backend (Python FastAPI)" /D "%PY_DIR%" python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
timeout /t 2 /nobreak >nul

REM 2) Frontend Next.js
echo [2/2] Starting Next.js dev on http://localhost:3000 ...
start "Frontend (Next.js)" /D "%WEB_DIR%" node scripts\dev.js

echo.
echo Frontend: http://localhost:3000
echo Backend:  http://127.0.0.1:8000
echo Stop: _run\stop-all.cmd