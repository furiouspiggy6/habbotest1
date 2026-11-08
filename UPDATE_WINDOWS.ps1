# Habbo NFT Market Radar - transactional Windows updater (PowerShell 5.1+).
# The local server downloads and verifies the release ZIP before launching this script.
# Keep user data and .env untouched; verify the new server is alive before reporting success.
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][int]$ParentProcessId
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$updates = Join-Path $InstallDir 'data\updates'
New-Item -ItemType Directory -Force -Path $updates | Out-Null
$logFile = Join-Path $updates 'last-update.log'
function Log([string]$message) {
  $msg = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
  Add-Content -LiteralPath $logFile -Value $msg
  Write-Host $msg
}
function Get-AppVersion {
  try {
    $s = Invoke-RestMethod -Uri 'http://127.0.0.1:38571/api/state' -TimeoutSec 2
    return [string]$s.appVersion
  } catch { return '' }
}
function Launch-AppVerified([string]$expectedVersion) {
  $node = Get-Command 'node.exe' -ErrorAction Stop
  if ((Get-AppVersion) -eq $expectedVersion) { Log "Market Radar v$expectedVersion is already healthy."; return }
  if ((Get-AppVersion)) { throw 'Port 38571 is occupied by another running Market Radar version; refusing to take it over.' }
  $stdout = Join-Path $updates 'last-start.stdout.log'
  $stderr = Join-Path $updates 'last-start.stderr.log'
  Log "Starting node server.mjs directly from $InstallDir and checking the local HTTP API."
  $p = Start-Process -FilePath $node.Source -ArgumentList @('server.mjs') -WorkingDirectory $InstallDir -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  for ($i=0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 500
    $actual = Get-AppVersion
    if ($actual -eq $expectedVersion) { Log "Startup verified: v$actual responded at http://127.0.0.1:38571/api/state (PID $($p.Id))."; return }
    if ($actual) { break }
    $p.Refresh()
    if ($p.HasExited) { break }
  }
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  $hint = ''
  if (Test-Path $stderr) { $hint = (Get-Content -LiteralPath $stderr -Tail 8 -ErrorAction SilentlyContinue) -join ' | ' }
  throw "The app did not respond as v$expectedVersion after starting. $hint Read $stderr for details."
}
$stage = Join-Path $updates ('stage-' + $Version + '-' + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $updates ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$files = @('package.json','package-lock.json','README.md','.gitignore','.env.example',
  'START_WINDOWS.bat','UPDATE_WINDOWS.ps1','REPAIR_WINDOWS.ps1','core.mjs','market.mjs',
  'trade.mjs','server.mjs','updates.mjs','public','tests')
$installedModules = Join-Path $InstallDir 'node_modules'
$backupModules = Join-Path $backup 'node_modules'
$stagedModules = $null
$changed = $false
$modulesMoved = $false
$hadOldModules = Test-Path -LiteralPath $installedModules
$installedVersion = ''
try {
  $oldPkg = Join-Path $InstallDir 'package.json'
  if (Test-Path -LiteralPath $oldPkg) { $installedVersion = [string]((Get-Content -LiteralPath $oldPkg -Raw | ConvertFrom-Json).version) }
  Log "Preparing v$Version (previous v$installedVersion) with recovery enabled."
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update version.' }
  if ($ExpectedHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid expected SHA-256 digest.' }
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw 'Verified update archive was not found.' }
  if ((Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'SHA-256 integrity check failed.' }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage -Force
  $source = $stage
  if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) {
    $nested = @(Get-ChildItem -LiteralPath $stage -Directory)
    if ($nested.Count -ne 1) { throw 'Unexpected release archive layout.' }
    $source = $nested[0].FullName
  }
  $pkg = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.name -ne 'habbo-nft-market-radar' -or $pkg.version -ne $Version) { throw 'Archive identity or version mismatch.' }
  foreach ($name in @('server.mjs','core.mjs','market.mjs','updates.mjs','UPDATE_WINDOWS.ps1',
      'START_WINDOWS.bat','public\index.html','public\app.js','public\style.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name))) { throw "Archive missing $name" }
  }
  $node = (Get-Command 'node.exe' -ErrorAction Stop).Source
  foreach ($js in @('server.mjs','core.mjs','market.mjs','updates.mjs','trade.mjs','public\app.js')) {
    & $node --check (Join-Path $source $js) 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $js" }
  }
  $hasDependencies = ($null -ne $pkg.dependencies -and @($pkg.dependencies.PSObject.Properties).Count -gt 0)
  if ($hasDependencies) {
    $npm = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
    Log 'Installing required dependencies in staging (installed code remains untouched).'
    Push-Location $source
    try {
      & $npm install --omit=dev --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'Staged dependency install failed.' }
    } finally { Pop-Location }
  } else { Log 'No npm dependencies required. Skipping npm installation.' }
  $stagedModules = Join-Path $source 'node_modules'
  # Only now wait for the previous server to close; failed preflights never modify installed files.
  for ($i=0; $i -lt 120; $i++) {
    if (-not (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) { throw 'Previous server did not exit; installed files are unchanged.' }
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($name in $files) {
    $old = Join-Path $InstallDir $name
    if (Test-Path -LiteralPath $old) {
      $dest = Join-Path $backup $name
      New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $old -Destination $dest -Recurse -Force
    }
  }
  $changed = $true
  if (Test-Path -LiteralPath $stagedModules) {
    if ($hadOldModules) { Move-Item -LiteralPath $installedModules -Destination $backupModules; $modulesMoved = $true }
    Move-Item -LiteralPath $stagedModules -Destination $installedModules
  }
  foreach ($name in $files) {
    $new = Join-Path $source $name
    if (Test-Path -LiteralPath $new) {
      $destination = Join-Path $InstallDir $name
      if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
      Copy-Item -LiteralPath $new -Destination $destination -Recurse -Force
    }
  }
  # A launch is successful only after the new API responds with the expected version.
  Launch-AppVerified $Version
  Log "Update to v$Version succeeded; startup verified. User data and .env were preserved."
  if (Test-Path -LiteralPath $backupModules) { Remove-Item -LiteralPath $backupModules -Recurse -Force -ErrorAction SilentlyContinue }
  exit 0
} catch {
  Log "UPDATE FAILED: $($_.Exception.Message)"
  if ($changed) {
    Log 'Rolling back to previous version.'
    try {
      foreach ($name in $files) {
        $saved = Join-Path $backup $name
        $destination = Join-Path $InstallDir $name
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $destination -Recurse -Force }
      }
      if (Test-Path -LiteralPath $backupModules) {
        if (Test-Path -LiteralPath $installedModules) { Remove-Item -LiteralPath $installedModules -Recurse -Force }
        Move-Item -LiteralPath $backupModules -Destination $installedModules
      } elseif (-not $hadOldModules -and (Test-Path -LiteralPath $installedModules)) {
        Remove-Item -LiteralPath $installedModules -Recurse -Force
      }
      Log 'Previous version restored.'
    } catch { Log "ROLLBACK ERROR: $($_.Exception.Message). The backup remains at $backup" }
  }
  # Recover a working app even if the update fails. Leave the log for troubleshooting.
  if ($installedVersion) {
    try { Launch-AppVerified $installedVersion } catch { Log "RESTART ERROR: $($_.Exception.Message)" }
  }
  exit 1
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue }
}
