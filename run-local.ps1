# -*- coding: utf-8 -*-
# Run local stack: Backend (FastAPI) + Frontend (Next.js dev)
# Usage: powershell -ExecutionPolicy Bypass -File run-local.ps1

$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$pyDir = Join-Path $root 'mini-services\py-extractor'
$webDir = Join-Path $root 'extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Check ports available
$pyPort = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
$webPort = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count

# Backend Python (FastAPI)
if ($pyPort -eq 0) {
    Write-Host "[1/2] Starting Python FastAPI on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
    $py = Start-Process -FilePath 'python' -ArgumentList '-m','uvicorn','main:app','--host','127.0.0.1','--port','8000' `
        -WorkingDirectory $pyDir -RedirectStandardOutput (Join-Path $logDir 'py.out.log') `
        -RedirectStandardError (Join-Path $logDir 'py.err.log') -WindowStyle Hidden -PassThru
    $py.Id | Set-Content -Encoding ascii (Join-Path $logDir 'py.pid')
    Start-Sleep -Seconds 2
} else {
    Write-Host "[SKIP] Backend already running on port 8000" -ForegroundColor Green
}

# Frontend Next.js
if ($webPort -eq 0) {
    Write-Host "[2/2] Starting Next.js dev on http://localhost:3000 ..." -ForegroundColor Yellow
    $nextBin = Join-Path $webDir 'node_modules\next\dist\bin\next'
    $web = Start-Process -FilePath 'node' -ArgumentList $nextBin,'dev','-p','3000' `
        -WorkingDirectory $webDir -RedirectStandardOutput (Join-Path $logDir 'web.out.log') `
        -RedirectStandardError (Join-Path $logDir 'web.err.log') -WindowStyle Hidden -PassThru
    $web.Id | Set-Content -Encoding ascii (Join-Path $logDir 'web.pid')
    Start-Sleep -Seconds 2
} else {
    Write-Host "[SKIP] Frontend already running on port 3000" -ForegroundColor Green
}

# Wait for services
Write-Host "Waiting for services to be ready..." -ForegroundColor Cyan
$okPy = $false
$okWeb = $false

for ($i = 0; $i -lt 20; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $okPy = $true }
    } catch {}

    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $okWeb = $true }
    } catch {}

    if ($okPy -and $okWeb) { break }
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "Status:" -ForegroundColor Cyan
if ($okPy) {
    Write-Host "OK Backend: http://127.0.0.1:8000/api/health" -ForegroundColor Green
} else {
    Write-Host "FAIL Backend - check logs/py.err.log" -ForegroundColor Red
}
if ($okWeb) {
    Write-Host "OK Frontend: http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "FAIL Frontend - check logs/web.err.log" -ForegroundColor Red
}

Write-Host ""
Write-Host "Stop: powershell -File stop-all.ps1" -ForegroundColor Gray