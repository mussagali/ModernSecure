param([string]$TargetPlatform = 'android-arm64,android-x64')
$ErrorActionPreference = 'Stop'
# Android CMake/JNI cannot reliably build in a Windows path containing Cyrillic.
# Copy source only to an ASCII staging directory; never mirror/delete user files.
$sourceRoot = $PSScriptRoot
& node (Join-Path $sourceRoot '../../scripts/sync-mobile-env.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare public Supabase configuration' }
$buildRoot = Join-Path $env:LOCALAPPDATA 'Temp/modernsecure-client-android-build'
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
& robocopy $sourceRoot $buildRoot /E /XD build .dart_tool .git .impeccable /XF local.properties /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw 'Source copy failed' }
Push-Location $buildRoot
try {
  & flutter pub get
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
  & flutter build apk --debug --target-platform $TargetPlatform --dart-define-from-file=config/supabase.public.json
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
  $output = Join-Path $sourceRoot 'build/app/outputs/flutter-apk'
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  Copy-Item -LiteralPath (Join-Path $buildRoot 'build/app/outputs/flutter-apk/app-debug.apk') -Destination $output
  Write-Output "APK: $output/app-debug.apk"
} finally { Pop-Location }
