# stop-all.ps1 — إيقاف Backend + Frontend محلياً.
#
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File _run\stop-all.ps1

$ErrorActionPreference = "SilentlyContinue"
Write-Host "Stopping local stack..." -ForegroundColor Yellow

# Stop Node (Next.js scripts/dev.js)
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -match "scripts[\\/]dev\.js") {
            Write-Host "Stopping frontend PID $($_.Id)" -ForegroundColor Gray
            Stop-Process -Id $_.Id -Force
        }
    } catch {}
}

# Stop Python (uvicorn main:app)
Get-Process python -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -match "uvicorn.*main:app") {
            Write-Host "Stopping backend PID $($_.Id)" -ForegroundColor Gray
            Stop-Process -Id $_.Id -Force
        }
    } catch {}
}

Write-Host "Done." -ForegroundColor Green