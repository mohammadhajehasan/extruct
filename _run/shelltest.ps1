# 1) Determine what shell npm uses for scripts on this machine (isolated temp package).
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$t = Join-Path $root '_run\shelltest'
New-Item -ItemType Directory -Force -Path $t | Out-Null
'{"name":"shelltest","version":"1.0.0","private":true,"scripts":{"t":"echo hi 2>&1 | tee out.txt"}}' |
  Set-Content -Encoding ascii (Join-Path $t 'package.json')

$out = New-Object System.Collections.Generic.List[string]

foreach ($k in 'script-shell', 'shell') {
  $v = ((& npm.cmd config get $k 2>&1) | Out-String).Trim()
  $out.Add("npm config $k = [$v]")
}

& cmd.exe /c "cd /d `"$t`" && npm.cmd run t" *> (Join-Path $logDir 'shelltest-run.txt')
$teeFile = Join-Path $t 'out.txt'
if (Test-Path $teeFile) {
  $out.Add('TEE WORKS: out.txt created -> ' + (Get-Content -LiteralPath $teeFile -Raw))
} else {
  $out.Add('TEE MISSING: out.txt not created (npm script shell has no tee)')
}

# 2) confirm scripts/dev.js appended to dev.log
$devLog = Join-Path $root 'extruct\dev.log'
if (Test-Path $devLog) {
  $info = Get-Item $devLog
  $out.Add("dev.log size=" + $info.Length + " lastWrite=" + $info.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
  $text = [IO.File]::ReadAllText($devLog, [System.Text.Encoding]::UTF8)
  $idx = $text.LastIndexOf('===== dev start')
  if ($idx -ge 0) {
    $snippet = $text.Substring($idx, [Math]::Min(120, $text.Length - $idx))
    $out.Add('dev.log MARKER FOUND at ' + $idx + ' -> ' + $snippet.Replace("`r", ' ').Replace("`n", ' '))
  } else {
    $out.Add('dev.log MARKER NOT FOUND (launcher did not append)')
  }
}

$out | Set-Content -Encoding utf8 (Join-Path $logDir 'shelltest.txt')
Write-Output 'SHELL TEST DONE'