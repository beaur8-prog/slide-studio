param([Parameter(Mandatory=$true)][string]$Setup, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Update installation QA runs only on a disposable Windows CI runner.' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid QA version.' }
$install = Join-Path $env:LOCALAPPDATA 'Programs/Slide Studio'
$profile = Join-Path $env:APPDATA 'Slide Studio'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio'
if ((Test-Path $install) -or (Test-Path $profile) -or (Test-Path $registry)) { throw 'Refusing to touch an existing app or user profile.' }
$report = Join-Path $PWD 'qa/results/update-native-windows'
New-Item -ItemType Directory -Path $report -Force | Out-Null
$work = Join-Path $env:RUNNER_TEMP ('slide-update-qa-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$exe = Join-Path $install 'Slide Studio.exe'
$helper = $null
$waiter = $null
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
try {
  $initial = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
  Assert-True ($initial.WaitForExit(120000) -and $initial.ExitCode -eq 0) 'Initial install failed.'
  New-Item -ItemType Directory -Path (Join-Path $profile 'updates') -Force | Out-Null
  Set-Content (Join-Path $profile 'updates/settings.json') '{"automatic":false}' -Encoding utf8NoBOM
  $sentinel = Join-Path $profile 'user-data-sentinel.txt'
  Set-Content $sentinel 'preserve this user data during updating' -Encoding utf8NoBOM
  $before = (Get-FileHash $sentinel -Algorithm SHA256).Hash
  $payload = Join-Path $work 'Slide-Studio-Setup-x64.exe'
  Copy-Item -LiteralPath $Setup -Destination $payload
  $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $waiter = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 3') -WindowStyle Hidden -PassThru
  $log = Join-Path $profile 'updates/last-install.log'
  $jobFile = Join-Path $work 'install.json'
  @{ schema=1; id='slide'; parentPid=$waiter.Id; installer=$payload; bytes=(Get-Item $payload).Length;
     sha256=(Get-FileHash $payload -Algorithm SHA256).Hash.ToLowerInvariant(); executable=$exe; version=$Version; log=$log } |
    ConvertTo-Json | Set-Content $jobFile -Encoding utf8NoBOM
  $encoded = & node -e 'const fs=require("node:fs");const {powershellCommand}=require("./electron/studio-updater.cjs");process.stdout.write(powershellCommand(fs.readFileSync("electron/studio-update-windows.ps1","utf8"),process.argv[1]));' $jobFile
  Assert-True ($LASTEXITCODE -eq 0) 'Cannot encode the real update helper.'
  $helper = Start-Process -FilePath $powershell -ArgumentList @('-NoLogo','-NoProfile','-STA','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $report 'helper-stdout.log') -RedirectStandardError (Join-Path $report 'helper-stderr.log')
  $deadline = [DateTime]::UtcNow.AddMinutes(4)
  $sawProgress = $false
  while (-not $helper.HasExited) {
    $helper.Refresh()
    if ($helper.MainWindowTitle -eq 'Slide Studio 업데이트' -and $helper.MainWindowHandle -ne 0) { $sawProgress = $true }
    if (Test-Path $log) {
      $observed = Get-Content $log -Raw -Encoding utf8 | ConvertFrom-Json
      if ($observed.status -eq 'failed') { throw "Update helper reported: $($observed.message)" }
    }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Update helper timed out.' }
    Start-Sleep -Milliseconds 150
  }
  $helper.WaitForExit()
  Assert-True ($helper.ExitCode -eq 0) "Update helper failed: $($helper.ExitCode)"
  Assert-True $sawProgress 'The real Windows update progress window was not observed.'
  $resultFile = if (Test-Path $log) { $log } else { Join-Path $profile 'updates/last-install-seen.log' }
  $result = Get-Content $resultFile -Raw -Encoding utf8 | ConvertFrom-Json
  Assert-True ($result.status -eq 'installed' -and $result.version -eq $Version) 'No verified install result.'
  Assert-True ($result.steps.Count -eq 5) 'Missing installation stages.'
  Assert-True (@($result.steps | Where-Object { -not $_.visible }).Count -eq 0) 'A progress stage was hidden.'
  Assert-True ((Get-Item $exe).VersionInfo.ProductVersion -eq $Version) 'Installed version mismatch.'
  Assert-True ((Get-FileHash $sentinel -Algorithm SHA256).Hash -eq $before) 'Update changed user data.'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $restarted = $null
  do {
    $restarted = @(Get-Process -Name 'Slide Studio' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) | Select-Object -First 1
    if ($null -ne $restarted) { break }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  Assert-True ($null -ne $restarted) 'Updated app was not restarted.'
  Copy-Item $resultFile (Join-Path $report 'install-result.json')
  [ordered]@{ version=$Version; actualWindowsPowerShell=$true; realSetup=$true; initialInstall=$true;
    progressWindowObserved=$sawProgress; visibleStages=$result.steps.Count; versionVerified=$true;
    userDataPreserved=$true; restarted=$true; limitation='Reinstalls the freshly built version; an actual older binary is not installed. JS tests cover newer-version selection and quit guards.' } |
    ConvertTo-Json | Set-Content (Join-Path $report 'results.json') -Encoding utf8NoBOM
  $null = $restarted.CloseMainWindow()
  Assert-True ($restarted.WaitForExit(30000)) 'Disposable empty app did not close.'
  $uninstaller = Start-Process -FilePath (Join-Path $install 'Uninstall.exe') -ArgumentList '/S' -PassThru
  Assert-True ($uninstaller.WaitForExit(60000)) 'Uninstaller launcher timed out.'
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ((Test-Path $registry) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (-not (Test-Path $registry)) 'Disposable installation was not removed.'
  Assert-True ((Get-FileHash $sentinel -Algorithm SHA256).Hash -eq $before) 'Uninstall changed preserved user data.'
  Write-Output 'PASS: real Windows update progress, five visible phases, verified installation, restart and preserved user data.'
} finally {
  foreach ($resultName in @('last-install.log','last-install-seen.log')) {
    $diagnostic = Join-Path $profile ('updates/' + $resultName)
    if (Test-Path $diagnostic) { Copy-Item $diagnostic (Join-Path $report ($resultName + '.json')) }
  }
  # These processes can only be the ones created above, on an initially clean CI runner.
  if ($null -ne $helper -and -not $helper.HasExited) { $helper.Kill(); $helper.WaitForExit() }
  if ($null -ne $waiter -and -not $waiter.HasExited) { $waiter.Kill(); $waiter.WaitForExit() }
}
