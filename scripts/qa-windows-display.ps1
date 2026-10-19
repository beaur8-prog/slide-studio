param([Parameter(Mandatory = $true)][string]$Report)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Display setup is restricted to a disposable Windows CI runner.'
}
# The hosted desktop defaults to 1024x768, below the editor's 1080 DIP minimum.
# Configure the test monitor rather than changing the installed app's minimum
# or weakening the fullscreen-size assertion. No registry setting is persisted.
# https://learn.microsoft.com/windows/win32/api/wingdi/ns-wingdi-devmodew
# https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-changedisplaysettingsw
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StudioTestDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Mode {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Device;
    public ushort SpecVersion, DriverVersion, Size, DriverExtra;
    public uint Fields;
    public int PositionX, PositionY;
    public uint Orientation, FixedOutput;
    public short Color, Duplex, YResolution, TTOption, Collate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Form;
    public ushort LogPixels;
    public uint BitsPerPel, Width, Height, Flags, Frequency;
    public uint ICMMethod, ICMIntent, MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern bool EnumDisplaySettings(string device, int mode, ref Mode data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern int ChangeDisplaySettings(ref Mode data, int flags);
  public static Mode Current() {
    if (Marshal.SizeOf(typeof(Mode)) != 220) throw new Exception("Unexpected DEVMODEW layout");
    var mode = new Mode { Size=220 };
    if (!EnumDisplaySettings(null, -1, ref mode)) throw new Exception("Could not read CI monitor mode");
    return mode;
  }
  public static int Configure() {
    var mode=Current(); mode.Width=1920; mode.Height=1080; mode.Fields=0x180000;
    int test=ChangeDisplaySettings(ref mode, 2);
    if (test != 0) return test;
    return ChangeDisplaySettings(ref mode, 0);
  }
}
'@
$before = [StudioTestDisplay]::Current()
if ($before.Width -lt 1280 -or $before.Height -lt 900) {
  $result = [StudioTestDisplay]::Configure()
  if ($result -ne 0) { throw "Cannot configure the CI monitor to 1920x1080 (Win32 result $result)" }
}
$after = [StudioTestDisplay]::Current()
if ($after.Width -lt 1280 -or $after.Height -lt 900) { throw 'CI monitor remains smaller than the required test viewport' }
@{ before=@{width=$before.Width;height=$before.Height}; after=@{width=$after.Width;height=$after.Height}; registryPersisted=$false } |
  ConvertTo-Json -Depth 3 | Set-Content -Path $Report -Encoding utf8
