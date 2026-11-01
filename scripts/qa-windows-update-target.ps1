$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Requires a disposable Windows CI runner.' }
$install = Join-Path $env:LOCALAPPDATA 'Programs\Slide Studio'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio'
if ((Test-Path $install) -or (Test-Path $registry)) { throw 'Refusing to touch an existing Slide installation.' }
$work = Join-Path $env:RUNNER_TEMP ('slide-target-' + [Guid]::NewGuid().ToString('N'))
$report = Join-Path $PWD 'qa/results/update-target-windows'
New-Item -ItemType Directory -Path $work,$report | Out-Null
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../electron/studio-update-windows.ps1'), [Text.Encoding]::UTF8)
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SlideInstallTarget' }, $true)
if ($null -eq $definition) { throw 'Missing production installation target resolver.' }
# Exercise the actual production function with real Windows registry/files,
# without running an installer or acknowledging a helper request.
. ([ScriptBlock]::Create($definition.Extent.Text))
$exe = Join-Path $install 'Slide Studio.exe'
$marker = Join-Path $install '.slide-studio-install'
$results = @()
function Reset-Fixture {
  New-Item -ItemType Directory -Path $install -Force | Out-Null
  [IO.File]::WriteAllText($exe,'disposable executable placeholder')
  [IO.File]::WriteAllText((Join-Path $install 'Uninstall.exe'),'disposable uninstaller placeholder')
  [IO.File]::WriteAllText($marker,'0.0.0')
  Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -Path $registry -Force | Out-Null
  foreach ($pair in @(@('DisplayName','Slide Studio'),@('InstallLocation',$install),@('DisplayVersion','0.0.0'),@('UninstallString',('"' + (Join-Path $install 'Uninstall.exe') + '"')))) {
    New-ItemProperty -LiteralPath $registry -Name $pair[0] -Value $pair[1] -Force | Out-Null
  }
}
function Assert-Rejected([string]$Name, [string]$Executable = $exe, [string]$Version = '') {
  $rejected = $false
  try { $null = Get-SlideInstallTarget $Executable $Version } catch { $rejected = $true }
  if (-not $rejected) { throw "Invalid target was accepted: $Name" }
  $script:results += @{ scenario=$Name; rejected=$true }
}
try {
  Reset-Fixture
  $target = Get-SlideInstallTarget $exe '0.0.0'
  if ($target.directory -ine $install -or $target.executable -ine $exe) { throw 'Valid target was changed.' }
  $results += @{ scenario='registered-current-user'; accepted=$true }

  Remove-Item -LiteralPath $registry -Recurse
  Assert-Rejected 'unregistered'
  Reset-Fixture
  Set-ItemProperty -LiteralPath $registry -Name InstallLocation -Value $work
  Assert-Rejected 'registration-points-elsewhere'
  Reset-Fixture
  Set-ItemProperty -LiteralPath $registry -Name UninstallString -Value ('"' + (Join-Path $work 'Uninstall.exe') + '"')
  Assert-Rejected 'foreign-uninstaller'
  Reset-Fixture
  Set-ItemProperty -LiteralPath $registry -Name DisplayName -Value 'Another application'
  Assert-Rejected 'foreign-product'
  Reset-Fixture
  Remove-Item -LiteralPath $marker
  Assert-Rejected 'missing-installation-marker'
  Reset-Fixture
  Assert-Rejected 'copied-app-outside-default-root' (Join-Path $work 'Slide Studio.exe')
  Reset-Fixture
  Assert-Rejected 'registration-version-not-updated' $exe '1.0.0'
  Set-ItemProperty -LiteralPath $registry -Name DisplayVersion -Value '1.0.0'
  Assert-Rejected 'marker-version-not-updated' $exe '1.0.0'
  [IO.File]::WriteAllText($marker,'1.0.0')
  $null = Get-SlideInstallTarget $exe '1.0.0'
  $results += @{ scenario='updated-registration-and-marker'; accepted=$true }
  @{ passed=$true; productionFunction=$true; scenarios=$results } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $report 'results.json') -Encoding UTF8
  Write-Output "PASS: $($results.Count) real Windows installation-target checks."
} finally {
  Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $install,$work -Recurse -Force -ErrorAction SilentlyContinue
}
