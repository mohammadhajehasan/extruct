# Test CSV export with flat vs nested rows
$root = 'C:\Users\Ahmad\Desktop\final-extruct'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(120)
$out = New-Object System.Collections.Generic.List[string]

function Post([string]$url, $payloadObj, [string]$label) {
  $json = $payloadObj | ConvertTo-Json -Depth 8 -Compress
  $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
  try {
    $resp = $client.PostAsync($url, $content).GetAwaiter().GetResult()
    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $out.Add("[$label] $url -> HTTP " + [int]$resp.StatusCode + " (" + $bytes.Length + " bytes)")
    if ($text.Length -gt 0 -and ($text.Length -lt 600)) { $out.Add("    BODY: $text") }
    elseif ($text.Length -ge 600) { $out.Add("    BODY(first 300): " + $text.Substring(0, 300)) }
  } catch {
    $out.Add("[$label] EXCEPTION: " + $_.Exception.Message)
  }
}

# Test 1: Flat rows (the buggy format)
$flatRows = @('a', '1')
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'csv'; headers = @('Name', 'Value'); rows = $flatRows } 'TEST-FLAT'

# Test 2: Nested rows (correct format)  
$nestedRows = @(@('a'), @('1'))
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'csv'; headers = @('Name', 'Value'); rows = $nestedRows } 'TEST-NESTED'

$client.Dispose()
$out | Set-Content -Encoding utf8 (Join-Path $logDir 'export-diag2.txt')
Write-Output 'DONE'