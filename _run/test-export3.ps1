# Test export through Next.js proxy with properly formatted data
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
    $contentType = $resp.Content.Headers.ContentType
    if ($contentType) {
      $sc = $contentType.ToString()
    } else {
      $sc = 'NO CT'
    }
    $out.Add("    Content-Type: $sc")
    if ($bytes.Length -gt 0 -and ($bytes.Length -lt 600)) {
      $out.Add("    BODY: " + [System.Text.Encoding]::UTF8.GetString($bytes))
    }
  } catch {
    $out.Add("[$label] EXCEPTION: " + $_.Exception.Message)
  }
}

# Test export direct (backend) with properly formatted data
$nestedRows = @(@('Apple', '1'), @('Banana', '2'))
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'csv'; headers = @('Name', 'Value'); rows = $nestedRows } 'DIRECT-CSV-NESTED'

# Test XLSX direct (backend)
Post 'http://127.0.0.1:8000/api/export' @{ kind = 'tables'; format = 'xlsx'; headers = @('Name', 'Value'); rows = $nestedRows } 'DIRECT-XLSX-NESTED'

$client.Dispose()
$out | Set-Content -Encoding utf8 (Join-Path $logDir 'export-diag4.txt')
Write-Output 'DONE'