$ErrorActionPreference='Stop'
$configPath = if ($env:RP_CONNECTION_FILE) { $env:RP_CONNECTION_FILE } else { Join-Path $PSScriptRoot '../../private-deploy/connection.json' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$port = [int]$config.port
$sshTarget = [string]$config.sshHost
if ($port -lt 1 -or $port -gt 65535 -or $sshTarget -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') { throw 'Invalid connection settings' }
$deviceArgs = if ($config.androidSerial) { @('-s', [string]$config.androidSerial) } else { @() }
if (!(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process ssh.exe -ArgumentList '-NT','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-L',"127.0.0.1:${port}:127.0.0.1:${port}",$sshTarget -WindowStyle Hidden
}
$bridge=Join-Path ${env:ProgramFiles(x86)} 'HiSuite/hwtools/hwtransport.exe'
if ((Test-Path $bridge) -and (Get-NetTCPConnection -LocalPort 5997 -State Listen -ErrorAction SilentlyContinue)) {
  & $bridge -P 5997 @deviceArgs reverse "tcp:$port" "tcp:$port"
} else {
  adb @deviceArgs reverse "tcp:$port" "tcp:$port"
}
if ($LASTEXITCODE) {throw 'USB connection unavailable'}
