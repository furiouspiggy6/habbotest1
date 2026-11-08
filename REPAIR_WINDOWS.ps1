# Habbo NFT Market Radar: one-time recovery updater (Windows PowerShell 5.1+).
# Run from the folder containing START_WINDOWS.bat (use Explorer address bar -> powershell).
# Uses only this repository's signed-by-GitHub release URLs and verifies the SHA256 sidecar.
# It does not read, output, change, or upload .env, wallet secrets, or data/state.json.
param([string]$InstallDir = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'furiouspiggy6/habbotest1'
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$PackageFile = Join-Path $InstallDir 'package.json'
$Launcher = Join-Path $InstallDir 'START_WINDOWS.bat'
if (-not (Test-Path -LiteralPath $PackageFile -PathType Leaf) -or -not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
  throw "Open PowerShell inside your Market Radar folder (the folder containing START_WINDOWS.bat), then run this command again. Current folder: $InstallDir"
}
$localPackage = Get-Content -LiteralPath $PackageFile -Raw | ConvertFrom-Json
if ($localPackage.name -ne 'habbo-nft-market-radar') { throw 'This folder is not a Habbo NFT Market Radar installation.' }
$UpdateDir = Join-Path $InstallDir 'data\updates'
New-Item -ItemType Directory -Path $UpdateDir -Force | Out-Null
Write-Host "Market Radar repair: found local version $($localPackage.version)" -ForegroundColor Cyan
# Require TLS 1.2 on older Windows PowerShell hosts.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$headers = @{ 'Accept'='application/vnd.github+json'; 'User-Agent'='Habbo-NFT-Radar-Recovery' }
$release = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 25
$Version = ([string]$release.tag_name).TrimStart('v')
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid GitHub release version $($release.tag_name)." }
if ($release.draft -or $release.prerelease) { throw 'Refusing to install a draft or prerelease.' }
if ([version]$Version -lt [version]$localPackage.version) { throw "Latest release v$Version is older than the installed version." }
$ZipName = "Habbo_NFT_Market_Radar_Windows_v$Version.zip"
$HashName = "$ZipName.sha256"
$ZipAsset = @($release.assets | Where-Object { $_.name -eq $ZipName }) | Select-Object -First 1
$HashAsset = @($release.assets | Where-Object { $_.name -eq $HashName }) | Select-Object -First 1
if ($null -eq $ZipAsset -or $null -eq $HashAsset) { throw 'GitHub release is missing the Windows ZIP or SHA-256 checksum. No changes made.' }
$expectedZipUrl = "https://github.com/$Repo/releases/download/$($release.tag_name)/$ZipName"
$expectedHashUrl = "https://github.com/$Repo/releases/download/$($release.tag_name)/$HashName"
if ([string]$ZipAsset.browser_download_url -cne $expectedZipUrl -or
    [string]$HashAsset.browser_download_url -cne $expectedHashUrl) {
  throw 'Refusing unexpected release asset URL.'
}
# Inspect the running app before stopping anything. Only stop a matching node server.mjs.
$state = $null
try { $state = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:38571/api/state' -TimeoutSec 3 } catch {}
if ($state -and $state.armed) { throw 'Real-money autobuying is armed. Disarm it in the dashboard before updating.' }
$existingPid = $null
try { $existingPid = @(Get-NetTCPConnection -LocalPort 38571 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }) | Select-Object -First 1 } catch {}
if ($existingPid) {
  $processInfo = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
  $executable = if ($processInfo) { Split-Path -Leaf ([string]$processInfo.ExecutablePath) } else { '' }
  if ($executable -notmatch '^node(\.exe)?$' -or [string]$processInfo.CommandLine -notmatch 'server\.mjs') {
    throw "Port 38571 belongs to an unidentified process (PID $existingPid); close it yourself to avoid stopping unrelated software."
  }
  if (-not $state) { throw 'The app is running, but its safety status cannot be read. Close its black command window before retrying.' }
  Write-Host "Detected running Market Radar v$($state.appVersion). It will be closed safely." -ForegroundColor Yellow
}
if ($Version -eq [string]$localPackage.version) {
  if ($existingPid -and $state.appVersion -eq $Version) {
    Write-Host "Already running current v$Version. No repair needed." -ForegroundColor Green
    return
  }
  if ($existingPid) { Stop-Process -Id $existingPid -Force -ErrorAction Stop }
  # Start Node directly, not through cmd /c quoting that may fail on folders with spaces.
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $UpdateDir 'last-start.stdout.log'
  $stderr = Join-Path $UpdateDir 'last-start.stderr.log'
  $p = Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $InstallDir -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  for ($i=0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $check = Invoke-RestMethod -Uri 'http://127.0.0.1:38571/api/state' -TimeoutSec 2
      if ([string]$check.appVersion -eq $Version) {
        Write-Host "Verified Market Radar v$Version is running (PID $($p.Id))." -ForegroundColor Green
        Start-Process 'http://127.0.0.1:38571'
        return
      }
    } catch {}
    $p.Refresh()
    if ($p.HasExited) { break }
  }
  throw "Market Radar failed to restart. Check $stderr, or launch START_WINDOWS.bat to see the error."
}
Write-Host "Retrieving v$Version directly from GitHub (no manual ZIP download)." -ForegroundColor Cyan
$runId = [guid]::NewGuid().ToString('N')
$zipPath = Join-Path $UpdateDir "rescue-$runId.zip"
$shaPath = Join-Path $UpdateDir "rescue-$runId.sha256"
$stage = Join-Path $UpdateDir "rescue-stage-$runId"
try {
  Invoke-WebRequest -Uri $HashAsset.browser_download_url -Headers $headers -UseBasicParsing -OutFile $shaPath -TimeoutSec 60
  $line = @(Get-Content -LiteralPath $shaPath | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+\*?$([regex]::Escape($ZipName))$" }) | Select-Object -First 1
  if (-not $line) { throw 'Checksum file did not contain a matching SHA256 for the expected ZIP.' }
  $expectedHash = [regex]::Match($line, '^([a-fA-F0-9]{64})').Groups[1].Value.ToUpperInvariant()
  if ([double]$ZipAsset.size -gt 30MB) { throw 'Release ZIP is unexpectedly large.' }
  Invoke-WebRequest -Uri $ZipAsset.browser_download_url -Headers $headers -UseBasicParsing -OutFile $zipPath -TimeoutSec 120
  $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) { throw 'Downloaded ZIP SHA256 does not match GitHub release checksum.' }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $stage -Force
  $source = $stage
  if (-not (Test-Path (Join-Path $source 'package.json'))) {
    $nested = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
    if (-not $nested) { throw 'Release ZIP does not contain package.json.' }
    $source = $nested.FullName
  }
  $newPkg = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
  if ($newPkg.name -ne 'habbo-nft-market-radar' -or $newPkg.version -ne $Version) { throw 'Release ZIP does not match the package identity and version.' }
  $installer = Join-Path $source 'UPDATE_WINDOWS.ps1'
  if (-not (Test-Path $installer)) { throw 'Release ZIP has no Windows updater.' }
  # Stop only the verified Market Radar process. Never stop arbitrary Node processes.
  if ($existingPid) {
    $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
    if ($current -and [string]$current.CommandLine -match 'server\.mjs') {
      Stop-Process -Id $existingPid -Force -ErrorAction Stop
      Start-Sleep -Seconds 2
    }
  }
  Write-Host 'Checksum verified. Installing into the existing folder (preserving data and .env)...' -ForegroundColor Cyan
  # If the app was already stopped, provide an intentionally impossible PID to avoid waiting.
  $waitPid = if ($existingPid) { [int]$existingPid } else { 99999999 }
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -InstallDir $InstallDir -ZipPath $zipPath -Version $Version -ExpectedHash $actualHash -ParentProcessId $waitPid
  $installed = Get-Content -LiteralPath $PackageFile -Raw | ConvertFrom-Json
  if ($installed.version -ne $Version) {
    throw "Installer did not finish successfully. Read: $(Join-Path $UpdateDir 'last-update.log')"
  }
  $confirmed = $false
  for ($i=0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $result = Invoke-RestMethod -Uri 'http://127.0.0.1:38571/api/state' -TimeoutSec 2
      if ([string]$result.appVersion -eq $Version) { $confirmed = $true; break }
    } catch {}
  }
  if (-not $confirmed) { throw "The installer returned without a healthy v$Version API. Check $(Join-Path $UpdateDir 'last-update.log')." }
  Write-Host "Market Radar v$Version is verified running." -ForegroundColor Green
  Start-Process 'http://127.0.0.1:38571' 
} finally {
  if (Test-Path $shaPath) { Remove-Item -LiteralPath $shaPath -Force -ErrorAction SilentlyContinue }
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
