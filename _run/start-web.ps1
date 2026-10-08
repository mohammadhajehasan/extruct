# -*- coding: utf-8 -*-
# تشغيل واجهة Next.js (dev) على المنفذ 3000
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$app = Join-Path $root 'extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$busy = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
if ($busy -gt 0) {
  Write-Output "SKIP: port 3000 already in use"
  exit 0
}

$nextBin = Join-Path $app 'node_modules\next\dist\bin\next'
$p = Start-Process -FilePath 'node' `
  -ArgumentList $nextBin,'dev','-p','3000' `
  -WorkingDirectory $app `
  -RedirectStandardOutput (Join-Path $logDir 'web.out.log') `
  -RedirectStandardError  (Join-Path $logDir 'web.err.log') `
  -WindowStyle Hidden -PassThru
$p.Id | Set-Content -Encoding ascii (Join-Path $logDir 'web.pid')
Write-Output ("STARTED next-dev PID=" + $p.Id)
