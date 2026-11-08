# Launched by the verified-release updater (either automatic when enabled or manually confirmed).
# The server validates the GitHub release asset and SHA-256 before invoking us.
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][int]$ParentProcessId
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$updates = Join-Path $InstallDir 'data\updates'
New-Item -ItemType Directory -Force -Path $updates | Out-Null
$logFile = Join-Path $updates 'last-update.log'
function Log([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" | Add-Content -Path $logFile
}
function Launch-App {
  $launcher = Join-Path $InstallDir 'START_WINDOWS.bat'
  if (Test-Path $launcher) {
    Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList @('/c', ('"' + $launcher + '"')) -WorkingDirectory $InstallDir
  }
}
$stage = Join-Path $updates ('stage-' + $Version + '-' + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $updates ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$files = @('package.json','package-lock.json','README.md','.gitignore','.env.example',
           'START_WINDOWS.bat','UPDATE_WINDOWS.ps1','core.mjs','market.mjs',
           'trade.mjs','server.mjs','updates.mjs','public','tests')
$installedModules = Join-Path $InstallDir 'node_modules'
$backupModules = Join-Path $backup 'node_modules'
$modulesSwapped = $false
$filesTouched = $false
try {
  Log "Starting update to v$Version; waiting for application to close."
  for ($i=0; $i -lt 120; $i++) {
    if (-not (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    throw 'Previous application is still running; no files were changed.'
  }
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw 'Update archive was not found.' }
  $hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
  if ($hash -ne $ExpectedHash) { throw 'SHA-256 integrity check failed before installation.' }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage -Force
  $sourcePath = $stage
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'package.json'))) {
    $nested = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
    if ($null -eq $nested) { throw 'Update ZIP contains no package.json.' }
    $sourcePath = $nested.FullName
  }
  $pkgFile = Join-Path $sourcePath 'package.json'
  if (-not (Test-Path -LiteralPath $pkgFile)) { throw 'Update ZIP does not contain package.json.' }
  $pkg = Get-Content -LiteralPath $pkgFile -Raw | ConvertFrom-Json
  if ($pkg.name -ne 'habbo-nft-market-radar' -or $pkg.version -ne $Version) {
    throw 'Update ZIP package/version does not match expected release.'
  }
  foreach ($required in @('server.mjs','core.mjs','updates.mjs','UPDATE_WINDOWS.ps1','START_WINDOWS.bat','public\index.html','public\app.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $required))) { throw "Required file missing: $required" }
  }
  $npm = Get-Command npm.cmd -ErrorAction Stop
  Log 'Preparing dependencies in a separate staging directory. No existing files have been touched.'
  Push-Location $sourcePath
  try {
    & $npm.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed in staging.' }
  } finally { Pop-Location }
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach ($name in $files) {
    $oldPath = Join-Path $InstallDir $name
    if (Test-Path -LiteralPath $oldPath) {
      $dest = Join-Path $backup $name
      $parent = Split-Path -Parent $dest
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      Copy-Item -LiteralPath $oldPath -Destination $dest -Recurse -Force
    }
  }
  # npm creates no node_modules folder for dependency-free packages. Only swap when it exists.
  $stagedModules = Join-Path $sourcePath 'node_modules'
  if (Test-Path -LiteralPath $stagedModules) {
    if (Test-Path -LiteralPath $installedModules) {
      Move-Item -LiteralPath $installedModules -Destination $backupModules
    }
  } else { Log 'No dependencies required by release; retaining previous node_modules if present.' }
  try {
    if (Test-Path -LiteralPath $stagedModules) {
      Move-Item -LiteralPath $stagedModules -Destination $installedModules
      $modulesSwapped = $true
    }
    $filesTouched = $true
    foreach ($name in $files) {
      $new = Join-Path $sourcePath $name
      if (Test-Path -LiteralPath $new) {
        $destination = Join-Path $InstallDir $name
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        Copy-Item -LiteralPath $new -Destination $destination -Recurse -Force
      }
    }
  } catch {
    Log "Installation failed; attempting rollback: $($_.Exception.Message)"
    if ($filesTouched) {
      foreach ($name in $files) {
        $saved = Join-Path $backup $name
        if (Test-Path -LiteralPath $saved) {
          $destination = Join-Path $InstallDir $name
          if (Test-Path -LiteralPath $destination -PathType Container) { Remove-Item -LiteralPath $destination -Recurse -Force }
          Copy-Item -LiteralPath $saved -Destination $destination -Recurse -Force
        }
      }
    }
    if ($modulesSwapped -and (Test-Path -LiteralPath $installedModules)) { Remove-Item -LiteralPath $installedModules -Recurse -Force }
    if (Test-Path -LiteralPath $backupModules) { Move-Item -LiteralPath $backupModules -Destination $installedModules }
    throw
  }
  Log "Updated successfully to v$Version. Local data, wallet .env and settings were kept."
  # The old deps backup is very large; remove only after success.
  if (Test-Path -LiteralPath $backupModules) { Remove-Item -LiteralPath $backupModules -Recurse -Force }
} catch {
  Log "UPDATE ERROR: $($_.Exception.Message)"
  Write-Warning "Update failed. Check: $logFile"
} finally {
  # Retain a small source backup and update log under data/updates for recovery.
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue }
  try { Launch-App } catch { Log "Unable to restart automatically: $($_.Exception.Message)" }
}
