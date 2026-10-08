# Verify /api/export (csv + xlsx) with RAW JSON (avoids ConvertTo-Json array flattening).
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(120)
$out = New-Object System.Collections.Generic.List[string]

foreach ($base in @('http://127.0.0.1:8000/api')) {
  foreach ($fmt in @('csv', 'xlsx')) {
    $json = '{"kind":"tables","format":"' + $fmt + '","headers":["Name","Value"],"rows":[["a","1"],["b","2"]]}'
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    try {
      $resp = $client.PostAsync("$base/export", $content).GetAwaiter().GetResult()
      $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
      $disp = ''
      $vals = $null
      if ($resp.Content.Headers.TryGetValues('Content-Disposition', [ref]$vals)) { $disp = ($vals -join '') }
      $file = Join-Path $logDir ("ok_export_" + ($base -replace '[^a-zA-Z0-9]', '_') + ".$fmt")
      [IO.File]::WriteAllBytes($file, $bytes)
      $out.Add("[$base/$fmt] HTTP " + [int]$resp.StatusCode + " bytes=" + $bytes.Length + " disp=" + $disp + " -> " + $file)
      if ($fmt -eq 'csv') {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        $out.Add("    CSV(first 120): " + $text.Substring(0, [Math]::Min(120, $text.Length)).Replace("`r", '\r').Replace("`n", '\n'))
      }
    } catch {
      $out.Add("[$base/$fmt] EXCEPTION: " + $_.Exception.Message)
    }
  }
}
$client.Dispose()
$out | Set-Content -Encoding utf8 (Join-Path $logDir 'export-diag2.txt')
Write-Output 'EXPORT DIAG2 DONE'