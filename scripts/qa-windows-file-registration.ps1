param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Registration install checks run only on a disposable Windows CI runner.'
}
$install = Join-Path $env:LOCALAPPDATA 'Programs\Slide Studio'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio'
$classes = 'HKCU:\Software\Classes'
$capabilities = 'HKCU:\Software\SlideStudio\Capabilities'
$application = "$classes\Applications\Slide Studio.exe"
$expectedCommand = '"' + (Join-Path $install 'Slide Studio.exe') + '" "%1"'
$types = @{ '.pptx' = 'SlideStudio.Presentation'; '.slide' = 'SlideStudio.LegacyPresentation' }
foreach ($name in @($install, $uninstallKey, $capabilities, $application, "$classes\SlideStudio.Presentation", "$classes\SlideStudio.LegacyPresentation")) {
  if (Test-Path $name) { throw "Refusing to overwrite pre-existing registration: $name" }
}
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Default-Value([string]$Key) { return (Get-Item $Key).GetValue('') }
function User-Choices {
  return ($types.Keys | Sort-Object | ForEach-Object {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$_\UserChoice"
    if (Test-Path $key) {
      $entry = Get-Item $key
      [ordered]@{ extension = $_; values = @($entry.GetValueNames() | Sort-Object | ForEach-Object { @{ name = $_; value = $entry.GetValue($_); kind = [string]$entry.GetValueKind($_) } }) }
    } else { [ordered]@{ extension = $_; values = @() } }
  }) | ConvertTo-Json -Depth 8 -Compress
}
function Install {
  $process = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
  Assert-True ($process.WaitForExit(60000)) 'Installer timed out'
  Assert-True ($process.ExitCode -eq 0) "Installer exit code: $($process.ExitCode)"
}
function Uninstall {
  $file = Join-Path $install 'Uninstall.exe'
  $process = Start-Process -FilePath $file -ArgumentList '/S' -PassThru
  Assert-True ($process.WaitForExit(60000)) 'Uninstaller launcher timed out'
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ((Test-Path $uninstallKey) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (-not (Test-Path $uninstallKey)) 'Uninstall registration retained'
}

# Existing file defaults and other applications must survive every operation.
$beforeChoices = User-Choices
foreach ($extension in $types.Keys) {
  New-Item "$classes\$extension\OpenWithProgids" -Force | Out-Null
  Set-Item "$classes\$extension" -Value 'QA.ExistingPresentation'
  New-ItemProperty "$classes\$extension\OpenWithProgids" -Name 'QA.ExistingPresentation' -Value '' -Force | Out-Null
}
$registered = 'HKCU:\Software\RegisteredApplications'
New-Item $registered -Force | Out-Null
New-ItemProperty $registered -Name 'QA Existing app' -Value 'Software\QA\Capabilities' -Force | Out-Null

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AssociationProbe {
  [DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)]
  public static extern uint AssocQueryString(uint flags, uint kind, string association, string extra, StringBuilder value, ref uint length);
}
'@
function Assert-Installed {
  Assert-True ((Get-ItemProperty $registered).'Slide Studio' -eq 'Software\SlideStudio\Capabilities') 'Missing RegisteredApplications candidate'
  Assert-True ((Get-ItemProperty $application).FriendlyAppName -eq 'Slide Studio') 'Missing application name'
  Assert-True ((Default-Value "$application\shell\open\command") -eq $expectedCommand) 'Application command must quote executable and filename'
  foreach ($extension in $types.Keys) {
    $progId = $types[$extension]
    Assert-True ((Get-Item "$classes\$extension\OpenWithProgids").GetValueNames().Contains($progId)) "Missing Open With candidate: $extension"
    Assert-True ((Get-Item "$application\SupportedTypes").GetValueNames().Contains($extension)) "Missing SupportedTypes: $extension"
    Assert-True ((Get-ItemProperty "$capabilities\FileAssociations").$extension -eq $progId) "Missing capabilities: $extension"
    Assert-True ((Default-Value "$classes\$progId\shell\open\command") -eq $expectedCommand) 'Incorrect ProgID open command'
    $command = New-Object System.Text.StringBuilder 4096
    [uint32]$size = $command.Capacity
    $status = [AssociationProbe]::AssocQueryString(0, 1, $progId, 'open', $command, [ref]$size)
    Assert-True ($status -eq 0 -and $command.ToString() -eq $expectedCommand) 'Windows Shell cannot resolve the registered open command'
  }
}
function Assert-DefaultsPreserved {
  foreach ($extension in $types.Keys) {
    Assert-True ((Default-Value "$classes\$extension") -eq 'QA.ExistingPresentation') 'Extension default changed'
    Assert-True ((Get-Item "$classes\$extension\OpenWithProgids").GetValueNames().Contains('QA.ExistingPresentation')) 'Another app candidate removed'
  }
  Assert-True ((Get-ItemProperty $registered).'QA Existing app' -eq 'Software\QA\Capabilities') 'Another registered app changed'
  Assert-True ((User-Choices) -eq $beforeChoices) 'UserChoice was modified'
}

Install
Assert-Installed
Assert-DefaultsPreserved
Install
Assert-Installed
Assert-DefaultsPreserved
New-ItemProperty 'HKCU:\Software\SlideStudio' -Name 'QA unrelated preference' -Value 'keep' -Force | Out-Null
Uninstall
Assert-DefaultsPreserved
foreach ($key in @($application, $capabilities, "$classes\SlideStudio.Presentation", "$classes\SlideStudio.LegacyPresentation")) {
  Assert-True (-not (Test-Path $key)) "Owned registration was not removed: $key"
}
Assert-True (-not (Get-Item $registered).GetValueNames().Contains('Slide Studio')) 'RegisteredApplications entry retained'
Assert-True ((Get-ItemProperty 'HKCU:\Software\SlideStudio').'QA unrelated preference' -eq 'keep') 'Unrelated app preferences removed'

# If another installation has replaced our command, the uninstaller must leave
# that registration alone rather than removing someone else's new target.
Install
$otherCommand = '"C:\Other installation\Slide Studio.exe" "%1"'
Set-Item "$classes\SlideStudio.Presentation\shell\open\command" -Value $otherCommand
Uninstall
Assert-True ((Default-Value "$classes\SlideStudio.Presentation\shell\open\command") -eq $otherCommand) 'Foreign replacement registration removed'
Assert-True ((Get-Item "$classes\.pptx\OpenWithProgids").GetValueNames().Contains('SlideStudio.Presentation')) 'Foreign replacement candidate removed'
Assert-DefaultsPreserved
Write-Output 'PASS: install, reinstall, shell command resolution, existing defaults/UserChoice, owned cleanup and replacement ownership.'
