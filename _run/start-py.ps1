# -*- coding: utf-8 -*-
# تشغيل خدمة الاستخراج Python (FastAPI) على المنفذ 8000
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$app = Join-Path $root 'extruct\mini-services\py-extractor'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$busy = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
if ($busy -gt 0) {
  Write-Output "SKIP: port 8000 already in use"
  exit 0
}

$p = Start-Process -FilePath 'python' `
  -ArgumentList '-m','uvicorn','main:app','--host','0.0.0.0','--port','8000' `
  -WorkingDirectory $app `
  -RedirectStandardOutput (Join-Path $logDir 'py.out.log') `
  -RedirectStandardError  (Join-Path $logDir 'py.err.log') `
  -WindowStyle Hidden -PassThru
$p.Id | Set-Content -Encoding ascii (Join-Path $logDir 'py.pid')
Write-Output ("STARTED py-extractor PID=" + $p.Id)
