$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
Set-Location (Join-Path $PSScriptRoot '../..')
$sdk=$env:ANDROID_HOME
$bt="$sdk/build-tools/35.0.0"
$android="$sdk/platforms/android-36/android.jar"
$env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.1'
$jdk="$env:JAVA_HOME/bin"
$out='out/cloud/android'
New-Item -ItemType Directory -Force "$out/res/raw","$out/classes","$out/dex",release |Out-Null
Copy-Item 'clients/android/res/*' "$out/res" -Recurse -Force
Copy-Item 'out/cloud/ca.pem' "$out/res/raw/reading_ca.pem" -Force
& "$bt/aapt2.exe" compile --dir "$out/res" -o "$out/res.zip"
& "$bt/aapt2.exe" link -o "$out/base.apk" -I $android --manifest 'clients/android/AndroidManifest.xml' "$out/res.zip"
python scripts/private_connection.py android "$out/LibraryConnection.java"
if ($LASTEXITCODE) {throw 'Could not prepare client connection'}
& "$jdk/javac.exe" -encoding UTF-8 -source 8 -target 8 -classpath $android -d "$out/classes" "$out/LibraryConnection.java" clients/android/ReaderActivity.java
& "$jdk/jar.exe" cf "$out/classes.jar" -C "$out/classes" .
& "$bt/d8.bat" --min-api 26 --lib $android --output "$out/dex" "$out/classes.jar"
Copy-Item "$out/base.apk" "$out/dex/base.apk" -Force
Push-Location "$out/dex"
try { & "$bt/aapt.exe" add base.apk classes.dex } finally { Pop-Location }
& "$bt/zipalign.exe" -f 4 "$out/dex/base.apk" "$out/aligned.apk"
$signDir="$env:LOCALAPPDATA/ReadingPartnerBuild";New-Item -ItemType Directory -Force $signDir|Out-Null
Add-Type -AssemblyName System.Security
$pwPath="$signDir/signing.dpapi"; $keyPath="$signDir/mobile.p12"
if (!(Test-Path $pwPath)) { $bytes=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes);[IO.File]::WriteAllBytes($pwPath,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser')) }
$env:RP_SIGN=[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($pwPath),$null,'CurrentUser'))
try {
 if (!(Test-Path $keyPath)) {& "$jdk/keytool.exe" -genkeypair -alias reader -keystore $keyPath -storepass:env RP_SIGN -keypass:env RP_SIGN -keyalg RSA -keysize 3072 -validity 3650 -dname 'CN=Reading Partner Private'}
 & "$bt/apksigner.bat" sign --ks $keyPath --ks-pass env:RP_SIGN --out 'release/Reading-Partner-Android.apk' "$out/aligned.apk"
 & "$bt/apksigner.bat" verify 'release/Reading-Partner-Android.apk'
} finally { Remove-Item Env:RP_SIGN }
