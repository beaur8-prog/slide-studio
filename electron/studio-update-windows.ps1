param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$script:progressForm = $null
$script:progressLabel = $null
$script:progressBar = $null
$script:steps = @()
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
  $script:steps += [ordered]@{ message = $Message; visible = $script:progressForm.Visible; at = [DateTime]::UtcNow.ToString('o') }
}
function Wait-WithProgress($Process, [int]$Milliseconds) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while (-not $Process.HasExited) {
    if ([DateTime]::UtcNow -ge $deadline) { return $false }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 120
  }
  $Process.WaitForExit()
  return $true
}
function Write-Result([string]$Status, [string]$Message) {
  if ($job.PSObject.Properties['log']) {
    [ordered]@{ status = $Status; version = $job.version; message = $Message; completedAt = [DateTime]::UtcNow.ToString('o'); steps = $script:steps } |
      ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $job.log -Encoding UTF8
  }
}
try {
  if ($job.schema -ne 1 -or $job.id -notin @('sheet','slide','word') -or $job.sha256 -notmatch '^[a-f0-9]{64}$' -or $job.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update job.' }
  $directory = [IO.Path]::GetFullPath((Split-Path -Parent $JobFile))
  $installer = [IO.Path]::GetFullPath($job.installer)
  if ((Split-Path -Parent $installer) -ne $directory -or [IO.Path]::GetExtension($installer) -ne '.exe') { throw 'Installer is outside the verified update directory.' }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
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
  Show-Progress '편집기가 안전하게 종료되기를 기다리는 중…'
  # Never terminate the editor. The helper is started only on Electron's quit
  # event, after all editor windows and their save/recovery guards have closed.
  $parent = Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ($null -ne $parent -and -not (Wait-WithProgress $parent 120000)) { throw 'The editor has not exited.' }
  if (@(Get-Process -Name ($names[$job.id]) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Another editor instance is still running. Close it and try the update again.' }
  Show-Progress '설치 파일의 무결성을 확인하는 중…'
  if ((Get-Item -LiteralPath $installer).Length -ne $job.bytes -or (Read-Sha256 $installer) -ne $job.sha256) { throw 'Installer checksum mismatch.' }
  $arguments = if ($job.id -eq 'slide') { @('/S') } else { @('/S','/currentuser') }
  Show-Progress "$($job.version) 버전을 설치하는 중…"
  $process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  if (-not (Wait-WithProgress $process 600000)) { throw 'Update installer timed out.' }
  if ($process.ExitCode -notin @(0,3010)) { throw "Update installer failed: $($process.ExitCode)" }
  # Refuse a success report if the installer did not replace the expected app.
  Show-Progress '설치된 앱의 버전을 확인하는 중…'
  $installedVersion = (Get-Item -LiteralPath $job.executable).VersionInfo.ProductVersion
  if ($installedVersion -ne $job.version) { throw "Installed version mismatch: $installedVersion" }
  Show-Progress '설치 완료. 앱을 다시 실행하는 중…' $true
  Write-Result 'installed' "$($job.version) 버전을 설치했습니다."
  Start-Process -FilePath $job.executable
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
} catch {
  $failure = $_.Exception.Message
  Write-Result 'failed' $failure
  if ($null -ne $script:progressForm) {
    [System.Windows.Forms.MessageBox]::Show($script:progressForm, "업데이트를 완료하지 못했습니다.`n`n$failure`n`n앱을 다시 실행한 뒤 업데이트를 다시 확인해 주세요.", '업데이트 오류', 'OK', 'Warning') | Out-Null
  }
  exit 1
} finally {
  if ($null -ne $script:progressForm) { $script:progressForm.Close(); $script:progressForm.Dispose() }
  Remove-Item -LiteralPath $JobFile -Force -ErrorAction SilentlyContinue
}
