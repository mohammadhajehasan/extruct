# Test with flat rows (potential buggy format)
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
    $out.Add("[$label] $url -> HTTP " + [int]$resp.StatusCode + " (" + $bytes.Length + " bytes)")
    if ($bytes.Length -gt 0 -and ($bytes.Length -lt 600)) {
      $out.Add("    BODY: " + [System.Text.Encoding]::UTF8.GetString($bytes))
    }
  } catch {
    $out.Add("[$label] EXCEPTION: " + $_.Exception.Message)
  }
}

# Test 1: Direct backend with FLAT rows (what might be failing in frontend)
$flatRows = @('a', '1')
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'csv'; headers = @('Name', 'Value'); rows = $flatRows } 'DIRECT-FLAT'

# Test 2: Direct backend with NESTED rows (correct format)
$nestedRows = @(@('a'), @('1'))
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'csv'; headers = @('Name', 'Value'); rows = $nestedRows } 'DIRECT-NESTED'

$client.Dispose()
$out | Set-Content -Encoding utf8 (Join-Path $logDir 'export-diag5.txt')
Write-Output 'DONE'