# start-all.ps1 — تشغيل Backend (Python FastAPI) + Frontend (Next.js) معاً محلياً.
#
# الاستخدام (من داخل extruct):
#   powershell -ExecutionPolicy Bypass -File _run\start-all.ps1
#
# يُشغّل:
#   1. Python FastAPI على http://127.0.0.1:8000
#   2. Next.js dev على http://localhost:3000 (يُ proxy /api/py/... إلى 8000)
#
# لوقفها: رُنّ `powershell -File _run\stop-all.ps1` أو أغلقنوافذها.

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ROOT = Resolve-Path (Join-Path $ROOT "..")
$PY_DIR = Join-Path $ROOT "mini-services\py-extractor"
$WEB_DIR = Join-Path $ROOT

Write-Host "=== extruct local stack ===" -ForegroundColor Cyan
Write-Host "ROOT: $ROOT" -ForegroundColor DarkGray

# 1) Backend Python
Write-Host "[1/2] Starting Python FastAPI on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
$py = Start-Process -FilePath "python" `
    -ArgumentList "-m","uvicorn","main:app","--host","0.0.0.0","--port","8000","--reload" `
    -WorkingDirectory $PY_DIR -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 1

# 2) Frontend Next.js
Write-Host "[2/2] Starting Next.js dev on http://localhost:3000 ..." -ForegroundColor Yellow
$web = Start-Process -FilePath "node" `
    -ArgumentList "scripts\dev.js" `
    -WorkingDirectory $WEB_DIR -WindowStyle Hidden -PassThru

# انتظار حتى يُResponse الـ frontend
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {
        Start-Sleep -Seconds 1
    }
}
if ($ok) {
    Write-Host "Frontend ready: http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "Frontend not responding yet - check dev.log" -ForegroundColor Yellow
}

Write-Host ("Backend PID: {0} | Frontend PID: {1}" -f $py.Id, $web.Id) -ForegroundColor Gray
Write-Host "Stop: powershell -File _run\stop-all.ps1" -ForegroundColor Gray