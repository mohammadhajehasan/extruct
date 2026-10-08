# Tails of dev/web logs written by scripts/dev.js and the npm wrapper
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
$out = New-Object System.Collections.Generic.List[string]
$app = Join-Path $root 'extruct'

foreach ($p in @(
    (Join-Path $logDir 'npm-dev.out.log'),
    (Join-Path $logDir 'npm-dev.err.log'),
    (Join-Path $app 'dev.log')
  )) {
  $out.Add("=== $p ===")
  if (Test-Path $p) {
    $out.Add("size=" + (Get-Item $p).Length + " bytes")
    $lines = Get-Content -LiteralPath $p -Tail 18 -ErrorAction SilentlyContinue
    if ($lines) { foreach ($l in $lines) { $out.Add($l) } } else { $out.Add('(empty)') }
  } else {
    $out.Add('(missing)')
  }
}

$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $pr = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  $nm = 'unknown'
  if ($pr) { $nm = $pr.ProcessName }
  $out.Add("PORT 3000 owner pid=" + $c.OwningProcess + " proc=" + $nm)
}

$out | Set-Content -Encoding utf8 (Join-Path $logDir 'tails.txt')
Write-Output 'TAILS DONE'