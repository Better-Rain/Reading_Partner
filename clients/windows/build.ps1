$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
$dest=Join-Path (Get-Location) 'release/Reading Partner Cloud'
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item 'node_modules/electron/dist/*' $dest -Recurse -Force
$appDir=Join-Path $dest 'resources/app'
New-Item -ItemType Directory -Force $appDir | Out-Null
python scripts/private_connection.py windows "$appDir/connection.json"
if ($LASTEXITCODE) {throw 'Could not prepare client connection'}
Copy-Item clients/windows/main.cjs,clients/windows/package.json,out/cloud/ca.pem,assets/icon.ico $appDir -Force
$exe=Join-Path $dest 'Reading Partner Cloud.exe'
Move-Item -LiteralPath (Join-Path $dest 'electron.exe') -Destination $exe -Force
$desktop=[Environment]::GetFolderPath('Desktop')
$link=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Reading Partner Cloud.lnk'))
$link.TargetPath=$exe
$link.IconLocation=Join-Path $appDir 'icon.ico'
$link.Save()
