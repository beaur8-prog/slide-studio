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

# Test both shared keys and foreign additions inside our own containers, before
# and after installation. Empty default values must count as real values too.
$foreign = @(
  @{ when = 'before'; key = "$classes\.pptx\OpenWithProgids"; name = 'QA Foreign before'; kind = 'String'; value = '' },
  @{ when = 'before'; key = "$classes\.slide\OpenWithProgids"; name = 'QA Foreign before'; kind = 'DWord'; value = 17 },
  @{ when = 'before'; key = "$classes\SlideStudio.Presentation"; name = 'QA Foreign before'; kind = 'String'; value = 'keep' },
  @{ when = 'before'; key = "$classes\SlideStudio.LegacyPresentation\DefaultIcon"; name = 'QA Foreign before'; kind = 'Binary'; value = [byte[]](1, 2, 3) },
  @{ when = 'before'; key = "$application\SupportedTypes"; name = '.foreign'; kind = 'String'; value = '' },
  @{ when = 'before'; key = $capabilities; name = ''; kind = 'String'; value = '' },
  @{ when = 'after'; key = "$classes\.pptx\OpenWithProgids"; name = 'QA Foreign after'; kind = 'String'; value = '' },
  @{ when = 'after'; key = "$classes\SlideStudio.Presentation\shell\open\command"; name = 'QA Foreign after'; kind = 'Binary'; value = [byte[]](4, 5, 6) },
  @{ when = 'after'; key = "$application\shell\print\command"; name = ''; kind = 'String'; value = '"C:\Foreign app\print.exe" "%1"' },
  @{ when = 'after'; key = "$capabilities\FileAssociations"; name = '.foreign'; kind = 'String'; value = 'Foreign.Presentation' },
  @{ when = 'after'; key = "$capabilities\ForeignChild"; name = 'QA Foreign after'; kind = 'DWord'; value = 42 },
  @{ when = 'after'; key = 'HKCU:\Software\SlideStudio'; name = ''; kind = 'String'; value = '' }
)
function Add-Foreign([string]$When) {
  $hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    foreach ($entry in $foreign | Where-Object when -eq $When) {
      $key = $hive.CreateSubKey($entry.key.Substring('HKCU:\'.Length))
      try { $key.SetValue($entry.name, $entry.value, [Microsoft.Win32.RegistryValueKind]$entry.kind) }
      finally { $key.Dispose() }
    }
  } finally { $hive.Dispose() }
}
function Assert-ForeignPreserved {
  $failures = @()
  foreach ($entry in $foreign) {
    if (-not (Test-Path $entry.key)) { $failures += "missing key: $($entry.key)"; continue }
    $key = Get-Item $entry.key
    if (-not $key.GetValueNames().Contains([string]$entry.name)) { $failures += "missing value: $($entry.key) [$($entry.name)]"; continue }
    if ([string]$key.GetValueKind($entry.name) -ne $entry.kind) { $failures += "changed type: $($entry.key) [$($entry.name)]"; continue }
    $actual = $key.GetValue($entry.name)
    $same = if ($entry.kind -eq 'Binary') { [Convert]::ToBase64String($actual) -eq [Convert]::ToBase64String($entry.value) } else { $actual -ceq $entry.value }
    if (-not $same) { $failures += "changed data: $($entry.key) [$($entry.name)]" }
  }
  Assert-True ($failures.Count -eq 0) ("Foreign registry data lost: " + ($failures -join '; '))
}
Add-Foreign 'before'

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
Add-Foreign 'after'
Install
Assert-Installed
Assert-DefaultsPreserved
New-ItemProperty 'HKCU:\Software\SlideStudio' -Name 'QA unrelated preference' -Value 'keep' -Force | Out-Null
Uninstall
Assert-DefaultsPreserved
Assert-ForeignPreserved
foreach ($extension in $types.Keys) {
  $progId = $types[$extension]
  Assert-True (-not (Get-Item "$classes\$extension\OpenWithProgids").GetValueNames().Contains($progId)) 'Owned Open With value was retained'
  Assert-True (-not (Get-Item "$application\SupportedTypes").GetValueNames().Contains($extension)) 'Owned supported type was retained'
  Assert-True (-not (Get-Item "$capabilities\FileAssociations").GetValueNames().Contains($extension)) 'Owned capability mapping was retained'
}
Assert-True (-not (Test-Path "$application\shell\open\command")) 'Owned application command was retained'
Assert-True (-not (Test-Path "$classes\SlideStudio.Presentation\DefaultIcon")) 'Empty owned icon key was retained'
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
Assert-ForeignPreserved
Write-Output 'PASS: install/reinstall/uninstall, existing defaults/UserChoice, 12 foreign registry values/subkeys including empty defaults, owned-value cleanup and replacement ownership.'
