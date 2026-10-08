# Wait for the Next.js dev server to answer, then probe root + proxy.
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$web = 'http://127.0.0.1:3000'
$ready = $false
for ($i = 1; $i -le 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $web
    if ($r.StatusCode -eq 200) {
      Write-Output ("WEB READY after " + ($i * 2) + "s status=" + $r.StatusCode + " bytes=" + $r.Content.Length)
      $ready = $true
      break
    }
  } catch {
    Write-Output ("attempt " + $i + " -> " + $_.Exception.Message)
  }
}
if (-not $ready) { Write-Output 'WEB NOT READY' }

# direct health check
try {
  $p = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri "http://127.0.0.1:8000/api/health"
  Write-Output ("DIRECT /api/health -> " + $p.StatusCode)
  $p.Content | Set-Content -Encoding utf8 (Join-Path $logDir 'direct-health.json')
} catch {
  Write-Output ("DIRECT ERR: " + $_.Exception.Message)
}

# home page HTML sanity check (title + body text)
try {
  $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri $web
  $h.Content | Set-Content -Encoding utf8 (Join-Path $logDir 'home.html')
  $hasTitle = $h.Content -match 'title'
  Write-Output ("HOME html bytes=" + $h.Content.Length + " has-title=" + $hasTitle)
} catch {
  Write-Output ("HOME ERR: " + $_.Exception.Message)
}