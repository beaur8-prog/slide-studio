param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$Portable,
  [Parameter(Mandatory = $true)][string]$ExpectedSetupSHA256,
  [Parameter(Mandatory = $true)][string]$ExpectedPortableSHA256,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'This install/uninstall check runs only on a disposable Windows CI runner.'
}
foreach ($hash in @($ExpectedSetupSHA256, $ExpectedPortableSHA256)) {
  if ($hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid expected SHA-256' }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid app version' }
if ((Get-FileHash $Setup -Algorithm SHA256).Hash -ne $ExpectedSetupSHA256) { throw 'Setup checksum mismatch' }
if ((Get-FileHash $Portable -Algorithm SHA256).Hash -ne $ExpectedPortableSHA256) { throw 'Portable checksum mismatch' }
$install = Join-Path $env:LOCALAPPDATA 'Programs\Slide Studio'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Slide Studio.lnk'
$startFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Slide Studio'
$profileDirectory = Join-Path $env:APPDATA 'Slide Studio'
$report = Join-Path $PWD 'qa/results/windows-setup-native'
New-Item -ItemType Directory -Path $report -Force | Out-Null
& (Join-Path $PSScriptRoot 'qa-windows-display.ps1') -Report (Join-Path $report 'display-setup.json')
if ((Test-Path $install) -or (Test-Path $registry) -or (Test-Path $profileDirectory)) { throw 'Runner is not clean; refusing to touch a pre-existing installation or profile' }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Run-Setup {
  $process = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
  if (-not $process.WaitForExit(120000)) { throw 'Installer timed out' }
  Assert-True ($process.ExitCode -eq 0) "Installer exited $($process.ExitCode)"
}
function Assert-Installed {
  $entry = Get-ItemProperty $registry
  Assert-True ($entry.DisplayVersion -eq $Version) 'Apps & features version mismatch'
  Assert-True ($entry.InstallLocation -eq $install) 'Registered install directory mismatch'
  Assert-True ($entry.UninstallString -eq ('"' + (Join-Path $install 'Uninstall.exe') + '"')) 'Uninstall command is not quoted'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($link in @($desktopLink, (Join-Path $startFolder 'Slide Studio.lnk'))) {
    Assert-True (Test-Path $link) "Missing shortcut: $link"
    Assert-True ($shell.CreateShortcut($link).TargetPath -eq (Join-Path $install 'Slide Studio.exe')) 'Shortcut does not launch installed app'
  }
  Assert-True (Test-Path (Join-Path $startFolder 'Uninstall Slide Studio.lnk')) 'Missing uninstall shortcut'
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Portable)
  try {
    foreach ($file in $zip.Entries) {
      $name = $file.FullName.Substring('Slide Studio/'.Length)
      if (-not $name -or $file.FullName.EndsWith('/') -or $name -eq '시작하기.txt') { continue }
      $target = Join-Path $install $name
      Assert-True (Test-Path $target) "Missing installed file: $name"
      $stream = $file.Open()
      try { $hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream)) }
      finally { $stream.Dispose() }
      Assert-True ((Get-FileHash $target -Algorithm SHA256).Hash -eq $hash) "Installed payload differs: $name"
    }
  } finally { $zip.Dispose() }
}

Run-Setup
Assert-Installed
New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
$sentinel = Join-Path $profileDirectory 'installer-preserve-test.txt'
Set-Content -Path $sentinel -Value 'keep autosaved user data' -Encoding utf8
$note = Join-Path $install 'user-note.txt'
Set-Content -Path $note -Value 'keep files not owned by the installer' -Encoding utf8
$env:SETUP_PATH = $Setup
$env:EXPECTED_APP_VERSION = $Version
node scripts/qa-installed-windows.cjs
if ($LASTEXITCODE -ne 0) { throw "Installed app verification failed" }
node scripts/qa-unsaved-document.cjs (Join-Path $report "unsaved-protection") (Join-Path $install "Slide Studio.exe")
if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke check failed' }
Run-Setup
Assert-Installed
Assert-True ((Get-Content $sentinel -Raw).Trim() -eq 'keep autosaved user data') 'Update changed user profile'
Assert-True (Test-Path $note) 'Update removed an unrelated file'
$uninstall = Join-Path $install 'Uninstall.exe'
$process = Start-Process -FilePath $uninstall -ArgumentList '/S' -PassThru
if (-not $process.WaitForExit(120000)) { throw 'Uninstaller launcher timed out' }
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while (((Test-Path $registry) -or (Test-Path $uninstall)) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
Assert-True (-not (Test-Path $registry)) 'Uninstall registration was retained'
Assert-True (-not (Test-Path (Join-Path $install 'Slide Studio.exe'))) 'Application was not removed'
Assert-True (-not (Test-Path $uninstall)) 'Uninstaller was not removed'
Assert-True (-not (Test-Path $desktopLink)) 'Desktop shortcut was not removed'
Assert-True (-not (Test-Path $startFolder)) 'Start menu shortcuts were not removed'
Assert-True ((Get-Content $sentinel -Raw).Trim() -eq 'keep autosaved user data') 'Uninstall changed user profile'
Assert-True (Test-Path $note) 'Uninstall removed an unrelated file'
$result = [ordered]@{
  version = $Version; setupSHA256 = $ExpectedSetupSHA256; portableSHA256 = $ExpectedPortableSHA256
  windows = (Get-CimInstance Win32_OperatingSystem).Caption
  cleanInstall = $true; allInstalledPayloadHashes = $true; shortcuts = $true
  appsAndFeaturesRegistration = $true; nativeAppSmoke = $true
  inPlaceReinstall = $true; uninstall = $true
  userProfilePreserved = $true; unrelatedFilePreserved = $true
}
$result | ConvertTo-Json | Set-Content (Join-Path $report 'installation.json') -Encoding utf8
$result | ConvertTo-Json
