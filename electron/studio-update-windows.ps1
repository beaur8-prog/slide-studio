param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$job = $null
$readyFile = "$JobFile.ready"
$helperReady = $false
$editorExited = $false
$script:progressForm = $null
$script:progressLabel = $null
$script:progressBar = $null
$script:steps = @()
function Get-SlideInstallTarget([string]$Executable, [string]$ExpectedVersion = '') {
  # Adapt Word Studio 1.4.13's pre-acknowledgement target resolution to Slide's
  # deliberately fixed, per-user installer. Never migrate another installation.
  $target = [IO.Path]::GetFullPath($Executable)
  $folder = [IO.Path]::GetDirectoryName($target).TrimEnd('\')
  $expected = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Slide Studio')).TrimEnd('\')
  if ([IO.Path]::GetFileName($target) -ine 'Slide Studio.exe' -or $folder -match '["\r\n]' -or $folder -ine $expected) {
    throw 'This copy is outside the supported current-user installation. Run Setup manually, then start Slide Studio from the Start menu.'
  }
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    $entry = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio')
    if ($null -eq $entry) { throw 'Cannot identify the running Slide installation. Run Setup manually to repair its registration.' }
    try {
      $location = [string]$entry.GetValue('InstallLocation')
      $uninstaller = Join-Path $folder 'Uninstall.exe'
      $marker = Join-Path $folder '.slide-studio-install'
      if ($entry.GetValue('DisplayName') -ne 'Slide Studio' -or [string]::IsNullOrWhiteSpace($location) -or
          [IO.Path]::GetFullPath($location).TrimEnd('\') -ine $folder -or
          $entry.GetValue('UninstallString') -ine ('"' + $uninstaller + '"') -or
          -not [IO.File]::Exists($target) -or -not [IO.File]::Exists($uninstaller) -or -not [IO.File]::Exists($marker)) {
        throw 'Slide installation registration does not match this app. Run Setup manually to repair the installation.'
      }
      if ($ExpectedVersion -and ($entry.GetValue('DisplayVersion') -ne $ExpectedVersion -or
          [IO.File]::ReadAllText($marker).Trim() -ne $ExpectedVersion)) {
        throw 'The installed Slide registration or installation marker has the wrong version.'
      }
    } finally { $entry.Dispose() }
  } finally { $base.Dispose() }
  return @{ directory = $folder; executable = $target }
}
function Read-Sha256([string]$Filename) {
  # Get-FileHash can be unavailable when Windows PowerShell inherits a module
  # path from a different PowerShell installation. Use the built-in .NET API.
  $stream = [IO.File]::OpenRead($Filename)
  $hasher = $null
  try {
    $hasher = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $hasher) { $hasher.Dispose() }
    $stream.Dispose()
  }
}
function Show-Progress([string]$Message, [bool]$Complete = $false) {
  $script:progressLabel.Text = $Message
  if ($Complete) { $script:progressBar.Style = 'Continuous'; $script:progressBar.Value = 100 }
  [System.Windows.Forms.Application]::DoEvents()
  $script:steps += [ordered]@{ message = $Message; visible = ($script:progressForm.Visible -and [StudioUpdateWindow]::IsWindowVisible($script:progressForm.Handle)); at = [DateTime]::UtcNow.ToString('o') }
}
function Wait-WithProgress($Process, [int]$Milliseconds, [bool]$AllowCancel = $false) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while (-not $Process.HasExited) {
    if ($AllowCancel -and -not (Test-Path -LiteralPath $JobFile)) { return $false }
    if ([DateTime]::UtcNow -ge $deadline) { return $false }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 120
  }
  $Process.WaitForExit()
  return $true
}
function Write-Result([string]$Status, [string]$Message) {
  if ($null -ne $job -and $job.PSObject.Properties['log']) {
    [ordered]@{ status = $Status; version = $job.version; message = $Message; completedAt = [DateTime]::UtcNow.ToString('o'); steps = $script:steps } |
      ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $job.log -Encoding UTF8
  }
}
try {
  Write-Output 'Studio update helper started.'
  if (-not (Test-Path -LiteralPath $JobFile)) { return }
  $job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($job.schema -ne 1 -or $job.id -notin @('sheet','slide','word') -or $job.sha256 -notmatch '^[a-f0-9]{64}$' -or $job.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update job.' }
  $directory = [IO.Path]::GetFullPath((Split-Path -Parent $JobFile))
  $installer = [IO.Path]::GetFullPath($job.installer)
  if ((Split-Path -Parent $installer) -ne $directory -or [IO.Path]::GetExtension($installer) -ne '.exe') { throw 'Installer is outside the verified update directory.' }
  # Resolve before acknowledging, while the editor can still show manual repair
  # and log paths without closing a document. A neighbouring uninstaller alone
  # is not proof that a copied app folder can be updated in place.
  $slideTarget = if ($job.id -eq 'slide') { Get-SlideInstallTarget $job.executable } else { $null }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StudioUpdateWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $names = @{ sheet = 'Sheet Studio'; slide = 'Slide Studio'; word = 'Word Studio' }
  $script:progressForm = New-Object System.Windows.Forms.Form
  $script:progressForm.Text = "$($names[$job.id]) 업데이트"
  $script:progressForm.ClientSize = New-Object System.Drawing.Size(480, 155)
  $script:progressForm.StartPosition = 'CenterScreen'
  $script:progressForm.FormBorderStyle = 'FixedDialog'
  $script:progressForm.ControlBox = $false
  $script:progressLabel = New-Object System.Windows.Forms.Label
  $script:progressLabel.Location = New-Object System.Drawing.Point(24, 20)
  $script:progressLabel.Size = New-Object System.Drawing.Size(432, 45)
  $script:progressLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $script:progressBar = New-Object System.Windows.Forms.ProgressBar
  $script:progressBar.Location = New-Object System.Drawing.Point(24, 76)
  $script:progressBar.Size = New-Object System.Drawing.Size(432, 20)
  $script:progressBar.Style = 'Marquee'
  $script:progressBar.MarqueeAnimationSpeed = 30
  $note = New-Object System.Windows.Forms.Label
  $note.Location = New-Object System.Drawing.Point(24, 109)
  $note.Size = New-Object System.Drawing.Size(432, 30)
  $note.Text = '설치가 끝나면 앱을 다시 실행합니다. 잠시 기다려 주세요.'
  $script:progressForm.Controls.AddRange(@($script:progressLabel, $script:progressBar, $note))
  $script:progressForm.Show()
  # The console is launched hidden. Windows may apply that startup visibility
  # to the first Form.Show() too; an explicit second ShowWindow overrides it.
  $null = [StudioUpdateWindow]::ShowWindow($script:progressForm.Handle, 5)
  $script:progressForm.Activate()
  if (-not [StudioUpdateWindow]::IsWindowVisible($script:progressForm.Handle)) { throw 'The update progress window could not be displayed.' }
  Show-Progress '편집기가 안전하게 종료되기를 기다리는 중…'
  Write-Result 'waiting' '설치 도우미가 준비되어 편집기 종료를 기다립니다.'
  @{ schema = 1; id = $job.id; parentPid = $job.parentPid } | ConvertTo-Json -Compress | Set-Content -LiteralPath $readyFile -Encoding UTF8
  $helperReady = $true
  # Acknowledge startup first, then wait for the editor's normal, cancellable
  # close. Never terminate the editor or install after its request is removed.
  $parent = Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ($null -ne $parent -and -not (Wait-WithProgress $parent 120000 $true)) {
    if (-not (Test-Path -LiteralPath $JobFile)) { return }
    throw 'The editor has not exited.'
  }
  if (-not (Test-Path -LiteralPath $JobFile)) { return }
  $editorExited = $true
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (@(Get-Process -Name ($names[$job.id]) -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $deadline) {
    if (-not (Test-Path -LiteralPath $JobFile)) { return }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 120
  }
  if (@(Get-Process -Name ($names[$job.id]) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Another editor instance is still running. Close it and try the update again.' }
  if (-not (Test-Path -LiteralPath $JobFile)) { return }
  Show-Progress '설치 파일의 무결성을 확인하는 중…'
  if ((Get-Item -LiteralPath $installer).Length -ne $job.bytes -or (Read-Sha256 $installer) -ne $job.sha256) { throw 'Installer checksum mismatch.' }
  # NSIS /D is the final, unquoted argument. The fixed per-user root was checked
  # above; keep silent installation so only this helper owns automatic relaunch.
  $arguments = if ($job.id -eq 'slide') { @('/S', ('/D=' + $slideTarget.directory)) } else { @('/S','/currentuser') }
  Show-Progress "$($job.version) 버전을 설치하는 중…"
  $process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  # Word Studio 1.4.13: retain the native handle before waiting under PS 5.1.
  $null = $process.Handle
  if (-not (Wait-WithProgress $process 600000)) { throw 'Update installer timed out.' }
  $process.Refresh()
  if ($null -eq $process.ExitCode -or $process.ExitCode -notin @(0,3010)) { throw "Update installer failed: $($process.ExitCode)" }
  # Refuse a success report if the installer did not replace the expected app.
  Show-Progress '설치된 앱의 버전을 확인하는 중…'
  if ($job.id -eq 'slide') { $null = Get-SlideInstallTarget $job.executable $job.version }
  $installedVersion = (Get-Item -LiteralPath $job.executable).VersionInfo.ProductVersion
  if ($installedVersion -ne $job.version) { throw "Installed version mismatch: $installedVersion" }
  Show-Progress '설치 완료. 앱을 다시 실행하는 중…' $true
  Write-Result 'installed' "$($job.version) 버전을 설치했습니다."
  Start-Process -FilePath $job.executable
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
} catch {
  $failure = $_.Exception.Message
  Write-Result 'failed' $failure
  Write-Error $_ -ErrorAction Continue
  if ($helperReady -and $editorExited -and $null -ne $script:progressForm) {
    [System.Windows.Forms.MessageBox]::Show($script:progressForm, "업데이트를 완료하지 못했습니다.`n`n$failure`n`n앱을 다시 실행한 뒤 업데이트를 다시 확인해 주세요.", '업데이트 오류', 'OK', 'Warning') | Out-Null
  }
  exit 1
} finally {
  if ($null -ne $script:progressForm) { $script:progressForm.Close(); $script:progressForm.Dispose() }
  Remove-Item -LiteralPath $JobFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$JobFile.ps1" -Force -ErrorAction SilentlyContinue
}
