param(
  [string]$SourceFile = "coral-sources/splunk.yaml",
  [string]$ConfigDir = ".tmp/splunk-verify-config"
)

$ErrorActionPreference = "Stop"

function Load-DotEnvFile([string]$Path) {
  if (-not (Test-Path $Path)) {
    return $false
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '^\s*[^=]+=') {
      return
    }

    $name, $value = $_ -split '=', 2
    $name = $name.Trim()
    $value = $value.Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value)
  }

  return $true
}

function Invoke-Coral {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )

  Write-Host ">> coral $($Args -join ' ')" -ForegroundColor Cyan
  & coral @Args
  if ($LASTEXITCODE -ne 0) {
    throw "coral exited with code $LASTEXITCODE"
  }
}

$loaded =
  (Load-DotEnvFile "sidecar/.env.local") -or
  (Load-DotEnvFile ".env.local")

if (-not $loaded) {
  throw "No .env.local file with Splunk variables was found."
}

if (-not $env:SPLUNK_HOST -or -not $env:SPLUNK_TOKEN) {
  throw "SPLUNK_HOST and SPLUNK_TOKEN must be present in sidecar/.env.local or .env.local."
}

$absoluteConfigDir = Join-Path (Get-Location) $ConfigDir
New-Item -ItemType Directory -Force -Path $absoluteConfigDir | Out-Null
$env:CORAL_CONFIG_DIR = $absoluteConfigDir

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -Method Get -TimeoutSec 5
  Write-Host "Detected local sidecar at http://127.0.0.1:3000 (version: $($health.version))" -ForegroundColor DarkGray
} catch {
  throw "Local sidecar is not reachable at http://127.0.0.1:3000. Start the sidecar first so splunk.yaml can hit /splunk-proxy/*."
}

Write-Host "Using CORAL_CONFIG_DIR=$absoluteConfigDir" -ForegroundColor DarkGray
Write-Host "Using source file $SourceFile" -ForegroundColor DarkGray

try {
  & coral source remove splunk | Out-Null
} catch {
}

Invoke-Coral source add --file $SourceFile

try {
  Invoke-Coral source test splunk
} catch {
  Write-Warning "coral source test splunk failed."
  Write-Warning "If you are pointing at local Splunk Enterprise on https://localhost:8089, make sure the sidecar can reach it and the token has read access."
  throw
}

Invoke-Coral sql "SELECT schema_name, table_name FROM coral.tables WHERE schema_name = 'splunk' ORDER BY table_name"
Invoke-Coral sql "SELECT name, datatype, total_event_count FROM splunk.indexes LIMIT 5"
Invoke-Coral sql "SELECT name, disabled, cron_schedule FROM splunk.saved_searches LIMIT 5"
Invoke-Coral sql "SELECT _time, host, source, sourcetype, _raw, index FROM splunk.search_results(search => 'search index=_internal | head 2 | fields _time host source sourcetype _raw index splunk_server') LIMIT 2"

Write-Host "Splunk Coral source validation completed." -ForegroundColor Green
