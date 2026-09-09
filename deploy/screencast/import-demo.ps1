# Drives the SyncifyPro import demo with REAL OS mouse/keyboard input.
#
# No browser-extension calls may run while this executes: an attached debugger
# paints Chrome's orange "being debugged" border and a ripple at every click,
# and shifts the page down by 56px.
#   -YOffset 49   normal window (no debug banner)   <- default
#   -YOffset 105  debug banner present
#
# The pointer MOVES ONLY WITH PURPOSE and holds perfectly still while the app
# works. Waits are deliberately generous — trim-freezes.sh cuts any motionless
# stretch back to 2s afterwards, so a slow page costs nothing but a longer cut.
param(
  [int]$XOffset = -1680,   # screen_x = page_x + XOffset   (window left + 248)
  [int]$YOffset = 49,      # screen_y = page_y + YOffset   (window top + 57)
  [string]$Url = "https://syncifypro.app/samples/shopify-products-sample.csv",
  [switch]$DryRun,
  [switch]$ResetOnly
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class Rec {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  static Random rnd = new Random(57);

  // easeInOutCubic travel with a slight perpendicular arc — a hand reaching
  // for a target, not a linear robot sweep. Ends exactly on the target and
  // then stays put: stillness is what makes the freeze cuts invisible.
  public static void Glide(int x, int y, int steps) {
    P c; GetCursorPos(out c);
    double dx = x - c.X, dy = y - c.Y;
    double len = Math.Sqrt(dx*dx + dy*dy);
    if (len < 2) { SetCursorPos(x, y); return; }
    double arc = Math.Min(len * 0.05, 24.0);
    double nx = -dy / len, ny = dx / len;
    for (int i = 1; i <= steps; i++) {
      double t = (double)i / steps;
      double e = t < 0.5 ? 4*t*t*t : 1 - Math.Pow(-2*t+2, 3)/2;
      double bow = Math.Sin(Math.PI * t) * arc;
      int px = (int)Math.Round(c.X + dx*e + nx*bow);
      int py = (int)Math.Round(c.Y + dy*e + ny*bow);
      SetCursorPos(px, py);
      System.Threading.Thread.Sleep(10 + rnd.Next(0, 7));
    }
    SetCursorPos(x, y);
  }
  public static void Click() {
    System.Threading.Thread.Sleep(120);
    mouse_event(2, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(70);
    mouse_event(4, 0, 0, 0, IntPtr.Zero);
  }
  public static string Fg() { var sb = new StringBuilder(512); GetWindowText(GetForegroundWindow(), sb, 512); return sb.ToString(); }
}
'@
[Rec]::SetProcessDPIAware() | Out-Null

function GoPage {
  param([int]$px, [int]$py, [int]$steps = 26)
  [Rec]::Glide(($px + $XOffset), ($py + $YOffset), $steps)
}
function TapPage {
  param([int]$px, [int]$py, [int]$steps = 26)
  GoPage -px $px -py $py -steps $steps
  [Rec]::Click()
}
function Hold { param([int]$ms) Start-Sleep -Milliseconds $ms }
function Guard {
  param([string]$needle)
  $fg = [Rec]::Fg()
  if ($fg -notlike "*$needle*") { Write-Output "ABORT: foreground is '$fg', expected '*$needle*'"; exit 1 }
  Write-Output "ok: '$fg'"
}

# page (CSS) coordinates inside the embedded app
$UrlFieldX = 982;  $UrlFieldY = 546
$FetchX    = 1370; $FetchY    = 546
$ImportX   = 1388; $ImportY   = 527
$DownloadX = 1566; $DownloadY = 84

if ($DryRun) {
  GoPage -px $FetchX -py $FetchY -steps 20
  Write-Output "parked at $($FetchX + $XOffset),$($FetchY + $YOffset)"
  exit 0
}

if ($ResetOnly) {
  Guard "Chrome"
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Hold 300
  [System.Windows.Forms.SendKeys]::SendWait('^r')
  Write-Output "reloaded"
  exit 0
}

# Take focus first: the Claude desktop app grabs it between tool calls, and
# SetForegroundWindow is refused to a background process. A click on the
# admin's empty left margin (outside the app iframe, nothing clickable there)
# activates the window the way a real click does.
GoPage -px 300 -py 700 -steps 18
[Rec]::Click()
Hold 900
Guard "SyncifyPro"
Hold 1200

# 1. type the sample file's URL into Direct URL. ESC right after the click
# kills Chrome's saved-form dropdown before it can be filmed.
TapPage -px $UrlFieldX -py $UrlFieldY -steps 30
Hold 250
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Hold 250
foreach ($chunk in ($Url -split '(?<=\G.{4})' | Where-Object { $_ })) {
  [System.Windows.Forms.SendKeys]::SendWait($chunk)
  Hold (45 + (Get-Random -Minimum 0 -Maximum 55))
}
Hold 900

# 2. fetch and analyse it — move off the button, then wait (generously)
TapPage -px $FetchX -py $FetchY -steps 24
Hold 400
GoPage -px 900 -py 260 -steps 20
Hold 9000
Guard "Import #"

# 3. import, then hold still while the bar runs and lands on 100%
TapPage -px $ImportX -py $ImportY -steps 26
Hold 400
GoPage -px 900 -py 300 -steps 20
Hold 14000

# 4. download the results workbook
TapPage -px $DownloadX -py $DownloadY -steps 28
Hold 400
GoPage -px 1120 -py 300 -steps 22
Hold 5000
Write-Output "SEQUENCE DONE fg='$([Rec]::Fg())'"
