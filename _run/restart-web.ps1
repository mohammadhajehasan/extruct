# Restart the Next.js dev server using the documented command: npm run dev
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$app = Join-Path $root 'extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 1) stop whatever listens on 3000 (whole process tree)
$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  Write-Output ("stopping pid " + $c.OwningProcess)
  & taskkill /PID $c.OwningProcess /T /F 2>&1 | Out-Null
}
Start-Sleep -Seconds 3
$still = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($still) { Write-Output 'WARN: port 3000 still busy' } else { Write-Output 'port 3000 free' }

# 2) start via npm run dev (the documented path)
$out = Join-Path $logDir 'npm-dev.out.log'
$err = Join-Path $logDir 'npm-dev.err.log'
$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $app `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
$p.Id | Set-Content -Encoding ascii (Join-Path $logDir 'npm-dev.pid')
Write-Output ("STARTED npm run dev PID=" + $p.Id)

# 3) wait for readiness
$ready = $false
for ($i = 1; $i -le 45; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri 'http://127.0.0.1:3000'
    if ($r.StatusCode -eq 200) {
      Write-Output ("WEB READY after " + ($i * 2) + "s bytes=" + $r.Content.Length)
      $ready = $true
      break
    }
  } catch { }
}
if (-not $ready) { Write-Output 'WEB NOT READY' }

# 4) direct health check
try {
  $pr = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri 'http://127.0.0.1:8000/api/health'
  Write-Output ("DIRECT /api/health -> " + $pr.StatusCode)
  $pr.Content | Set-Content -Encoding utf8 (Join-Path $logDir 'direct-health-after-npmdev.json')
} catch {
  Write-Output ("DIRECT ERR: " + $_.Exception.Message)
}