# Probe script: checks Python service directly + Next.js proxy + endpoints.
# NOTE: keep string literals ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI).
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$report = [ordered]@{}
$py = 'http://127.0.0.1:8000/api'
$web = 'http://127.0.0.1:3000'

function Try-Get([string]$url, [int]$timeout = 30) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $timeout -Uri $url
    return @{ ok = $true; status = [int]$r.StatusCode; body = $r.Content }
  } catch {
    return @{ ok = $false; status = $null; body = $_.Exception.Message }
  }
}

function Try-Post([string]$url, $body, [int]$timeout = 180) {
  try {
    $json = $body | ConvertTo-Json -Depth 12 -Compress
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $timeout -Method POST -Uri $url `
      -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    return @{ ok = $true; status = [int]$r.StatusCode; body = $r.Content }
  } catch {
    return @{ ok = $false; status = $null; body = $_.Exception.Message }
  }
}

# 1) Python service health
$h = Try-Get "$py/health"
$report['py_health'] = @{ status = $h.status; body = $h.body }

# 2) Next.js web root
$w = Try-Get $web
$report['web_root'] = @{ status = $w.status; bytes = ($w.body | Measure-Object -Character).Characters }

# 3) web root health
$p = Try-Get "$web/health"
$report['web_health'] = @{ status = $p.status; body = $p.body }

# 4) GET endpoints
foreach ($ep in @('enhance/profiles', 'glossary', 'kb/stats', 'audit?limit=5')) {
  $r = Try-Get "$py/$ep"
  $report["get_" + ($ep -replace '[^a-zA-Z0-9]', '_')] = @{ status = $r.status; body = $r.body }
}

# 5) POST /api/merge (dedup)
$m = Try-Post "$py/merge" @{ rows = @(@('a', 'b'), @('a', 'b'), @('c', 'd')); mode = 'global' }
$report['post_merge'] = @{ status = $m.status; body = $m.body }

# 6) POST /api/providers/models (Ollama not running -> fallback list, no crash)
$pm = Try-Post "$py/providers/models" @{ base_url = 'http://localhost:11434/v1'; timeout = 5 }
$b = $pm.body
if ($null -eq $b) { $b = '' }
$report['post_providers_models'] = @{ status = $pm.status; body = $b.Substring(0, [Math]::Min(300, $b.Length)) }

# 7) POST /api/providers/health (regional error classification)
$ph = Try-Post "$py/providers/health" @{ base_url = 'http://localhost:11434/v1'; timeout = 5 }
$report['post_providers_health'] = @{ status = $ph.status; body = $ph.body }

# 8) POST /api/enhance on a real test image
$img = Join-Path $root 'extruct\download\test-table.png'
if (Test-Path $img) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($img))
  $en = Try-Post "$py/enhance" @{ image_b64 = $b64; profile = 'darken_clarity' } 300
  if ($en.ok) {
    $obj = $en.body | ConvertFrom-Json
    $imgLen = 0
    if ($obj.image_b64) { $imgLen = $obj.image_b64.Length }
    $report['post_enhance'] = @{
      status = $en.status
      profile_used = $obj.profile_used
      tuned = $obj.tuned
      elapsed_ms = $obj.elapsed_ms
      out_b64_len = $imgLen
      flags = ($obj.analysis.flags | ConvertTo-Json -Compress)
    }
    if ($obj.image_b64) {
      [IO.File]::WriteAllBytes((Join-Path $logDir 'enhanced.png'), [Convert]::FromBase64String($obj.image_b64))
    }
  } else {
    $report['post_enhance'] = @{ status = $en.status; body = $en.body }
  }
} else {
  $report['post_enhance'] = @{ status = 'SKIP'; body = "image not found" }
}

# 9) POST /api/export (csv + xlsx)
foreach ($fmt in @('csv', 'xlsx')) {
  try {
    $payload = @{ kind = 'tables'; format = $fmt; headers = @('Name', 'Value'); rows = @(@('a', '1'), @('b', '2')) } |
      ConvertTo-Json -Depth 6 -Compress
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Method POST -Uri "$py/export" `
      -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
    $out = Join-Path $logDir ("export_test." + $fmt)
    [IO.File]::WriteAllBytes($out, $r.Content)
    $disp = $r.Headers['Content-Disposition']
    $report["export_$fmt"] = @{ status = [int]$r.StatusCode; bytes = $r.RawContentLength; disposition = $disp }
  } catch {
    $report["export_$fmt"] = @{ status = $null; body = $_.Exception.Message }
  }
}

# 10) KB learn + fewshot round trip
$kl = Try-Post "$py/kb/learn" @{ scope = 'mechanic'; field = 'chassis_no'; wrong = 'PROBE-WRONG'; right = 'PROBE-RIGHT'; context = 'probe' }
$report['post_kb_learn'] = @{ status = $kl.status; body = $kl.body }
$kf = Try-Post "$py/kb/fewshot" @{ field = 'chassis_no'; wrong = 'PROBE-WRONG' }
$report['post_kb_fewshot'] = @{ status = $kf.status; body = $kf.body }

$jsonOut = Join-Path $logDir 'probe.json'
($report | ConvertTo-Json -Depth 8) | Set-Content -Encoding utf8 $jsonOut
Write-Output ("PROBE DONE -> " + $jsonOut)
