# End-to-end probe against the Python backend directly (direct connection path).
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$web = 'http://127.0.0.1:8000/api'
$res = [ordered]@{}

function G([string]$p) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri "$web/$p"
    return @{ status = [int]$r.StatusCode; body = $r.Content }
  } catch { return @{ status = $null; body = $_.Exception.Message } }
}
function P([string]$p, $body, [int]$t = 300) {
  try {
    $json = $body | ConvertTo-Json -Depth 12 -Compress
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $t -Method POST -Uri "$web/$p" `
      -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    return @{ status = [int]$r.StatusCode; body = $r.Content }
  } catch { return @{ status = $null; body = $_.Exception.Message } }
}

$r = G 'health'
$res['health'] = @{ status = $r.status; ok = ($r.body -match '"ok":true'); caps = ($r.body -match 'barcode') }

foreach ($ep in @('enhance/profiles', 'glossary', 'kb/stats', 'audit?limit=3')) {
  $x = G $ep
  $res[$ep] = @{ status = $x.status; ok = ($x.body -match '"ok":true') }
}

$m = P 'merge' @{ rows = @(@('x', 'y'), @('x', 'y')); mode = 'global' }
$res['merge'] = @{ status = $m.status; body = $m.body }

# enhance direct with real image
$img = Join-Path $root 'extruct\download\test-mechanic.png'
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($img))
$en = P 'enhance' @{ image_b64 = $b64; profile = 'darken_clarity' }
if ($en.status -eq 200) {
  $o = $en.body | ConvertFrom-Json
  $res['enhance'] = @{ status = 200; profile = $o.profile_used; ms = $o.elapsed_ms; out_len = $o.image_b64.Length }
} else {
  $res['enhance'] = @{ status = $en.status; body = $en.body }
}

# export csv + xlsx direct (binary-safe via -OutFile)
foreach ($fmt in @('csv', 'xlsx')) {
  $file = Join-Path $logDir ("proxy_export." + $fmt)
  try {
    $payload = @{ kind = 'mechanic'; format = $fmt; headers = @('Name', 'Value'); rows = @(@('a', '1')) } |
      ConvertTo-Json -Depth 6 -Compress
    $r2 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Method POST -Uri "$web/export" `
      -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -OutFile $file
    $sz = 0
    if (Test-Path $file) { $sz = (Get-Item $file).Length }
    $res["export_$fmt"] = @{ status = [int]$r2.StatusCode; bytes = $sz }
  } catch {
    $res["export_$fmt"] = @{ status = $null; body = $_.Exception.Message }
  }
}

# benchmark endpoint without a valid key -> must fail gracefully (ok:false), no 500
$bm = P 'extract' @{ mode = 'tables'; images_b64 = @($b64); provider = 'ollama'; model = 'llava'; base_url = 'http://localhost:11434/v1' }
$bbody = $bm.body
if ($null -eq $bbody) { $bbody = '' }
$res['extract_no_provider'] = @{ status = $bm.status; body = $bbody.Substring(0, [Math]::Min(260, $bbody.Length)) }

($res | ConvertTo-Json -Depth 8) | Set-Content -Encoding utf8 (Join-Path $logDir 'probe-direct.json')
Write-Output 'DIRECT PROBE DONE'