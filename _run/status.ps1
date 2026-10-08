# Status script: ports + owning processes + tail of logs
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = New-Object System.Collections.Generic.List[string]

$out.Add("TIME: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
foreach ($port in 3000, 8000) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    foreach ($c in $conns) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      $name = 'unknown'
      $started = '-'
      if ($proc) {
        $name = $proc.ProcessName
        try { $started = $proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { $started = '-' }
      }
      $out.Add("PORT $port LISTEN pid=" + $c.OwningProcess + " proc=" + $name + " started=" + $started)
    }
  } else {
    $out.Add("PORT $port : FREE (nothing listening)")
  }
}

foreach ($f in 'web.out.log', 'web.err.log', 'py.out.log', 'py.err.log') {
  $p = Join-Path $logDir $f
  $out.Add("--- $f ---")
  if (Test-Path $p) {
    $lines = Get-Content -LiteralPath $p -Tail 15 -ErrorAction SilentlyContinue
    if ($lines) { foreach ($l in $lines) { $out.Add($l) } } else { $out.Add('(empty)') }
  } else {
    $out.Add('(missing)')
  }
}

$target = Join-Path $logDir 'status.txt'
$out | Set-Content -Encoding utf8 $target
Write-Output ("STATUS -> " + $target)