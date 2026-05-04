param(
  [string]$IconPath = "assets\icon.ico"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$icon = Join-Path $root $IconPath
$rcedit = Join-Path $root "node_modules\electron-winstaller\vendor\rcedit.exe"

if (-not (Test-Path $icon)) {
  throw "Icon file not found: $icon"
}

if (-not (Test-Path $rcedit)) {
  throw "rcedit.exe not found: $rcedit"
}

# Apply rcedit only to the unpacked Electron executable. NSIS portable
# executables contain an appended payload; rcedit truncates that overlay.
$targets = @(
  (Join-Path $root "release\win-unpacked\Reading Partner.exe")
)

foreach ($target in $targets) {
  if (Test-Path $target) {
    & $rcedit $target "--set-icon" $icon
    Write-Host "Applied icon to $target"
  }
}
