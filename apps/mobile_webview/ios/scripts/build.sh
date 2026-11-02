#!/bin/bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$IOS_ROOT"
MODE="${1:-simulator}"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Build requires macOS with full Xcode. Use the GitHub Actions iOS workflow from Windows.' >&2
  exit 1
fi
if [[ "$MODE" != simulator && "$MODE" != archive ]]; then
  echo 'Usage: bash scripts/build.sh simulator|archive' >&2
  exit 1
fi
command -v xcodegen >/dev/null || { echo 'Install XcodeGen first: brew install xcodegen' >&2; exit 1; }
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
if [[ "${SDK_VERSION%%.*}" -lt 26 ]]; then
  echo 'An iOS 26 SDK or later is required for App Store uploads.' >&2
  exit 1
fi
VERSION="${IOS_VERSION:-1.0.0}"
BUILD_NUMBER="${IOS_BUILD_NUMBER:-1}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid IOS_VERSION' >&2; exit 1; }
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid IOS_BUILD_NUMBER' >&2; exit 1; }
xcodebuild -version
xcodegen generate
python3 scripts/preflight.py
COMMON=(-project ModernSecure.xcodeproj -scheme ModernSecure -configuration Release
  "MARKETING_VERSION=$VERSION" "CURRENT_PROJECT_VERSION=$BUILD_NUMBER")
if [[ "$MODE" == simulator ]]; then
  xcodebuild "${COMMON[@]}" -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath build/simulator CODE_SIGNING_ALLOWED=NO build
  python3 scripts/verify-bundle.py build/simulator/Build/Products/Release-iphonesimulator/ModernSecure.app "$VERSION" "$BUILD_NUMBER"
  exit 0
fi
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"
: "${IOS_PROFILE_UUID:?Set IOS_PROFILE_UUID for an installed App Store provisioning profile}"
[[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Invalid Team ID' >&2; exit 1; }
[[ "$IOS_PROFILE_UUID" =~ ^[A-Fa-f0-9-]{36}$ ]] || { echo 'Invalid profile UUID' >&2; exit 1; }
ARCHIVE="build/ModernSecure-${VERSION}-${BUILD_NUMBER}.xcarchive"
# Refuse to overwrite another archive or IPA; increment the build number instead.
[[ ! -e "$ARCHIVE" && ! -e build/export/ModernSecure.ipa ]] || { echo 'Archive/export already exists; use a new build directory or number' >&2; exit 1; }
xcodebuild "${COMMON[@]}" -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  CODE_SIGN_STYLE=Manual "DEVELOPMENT_TEAM=$APPLE_TEAM_ID" \
  'CODE_SIGN_IDENTITY=Apple Distribution' "APP_STORE_PROFILE_UUID=$IOS_PROFILE_UUID" archive
python3 - <<'PY'
import os, plistlib
from pathlib import Path
settings = {
    'method': 'app-store-connect', 'destination': 'export', 'signingStyle': 'manual',
    'teamID': os.environ['APPLE_TEAM_ID'], 'signingCertificate': 'Apple Distribution',
    'provisioningProfiles': {'kz.modernsecure.app': os.environ['IOS_PROFILE_UUID']},
    'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True,
}
Path('build').mkdir(exist_ok=True)
Path('build/ExportOptions.plist').write_bytes(plistlib.dumps(settings))
PY
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export -exportOptionsPlist build/ExportOptions.plist
codesign --verify --deep --strict "$ARCHIVE/Products/Applications/ModernSecure.app"
python3 scripts/verify-bundle.py "$ARCHIVE/Products/Applications/ModernSecure.app" "$VERSION" "$BUILD_NUMBER"
echo "Exported IPA: $IOS_ROOT/build/export/ModernSecure.ipa"
echo 'No upload or App Review submission was performed.'
