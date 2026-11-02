#!/bin/bash
# GitHub-hosted ephemeral macOS runners only. Secrets never enter the repository.
set -euo pipefail
: "${RUNNER_TEMP:?Run on a GitHub-hosted macOS runner}"
: "${GITHUB_ENV:?Missing GitHub environment file}"
: "${APPLE_TEAM_ID:?Missing APPLE_TEAM_ID environment variable}"
: "${APPLE_CERTIFICATE_P12_BASE64:?Missing certificate secret}"
: "${APPLE_CERTIFICATE_PASSWORD:?Missing certificate password secret}"
: "${APPLE_PROFILE_BASE64:?Missing provisioning profile secret}"
umask 077
python3 - <<'PY'
import base64, os
from pathlib import Path
for variable, filename in [('APPLE_CERTIFICATE_P12_BASE64', 'modernsecure-signing.p12'), ('APPLE_PROFILE_BASE64', 'modernsecure-profile.mobileprovision')]:
    Path(os.environ['RUNNER_TEMP'], filename).write_bytes(base64.b64decode(os.environ[variable], validate=True))
PY
security cms -D -i "$RUNNER_TEMP/modernsecure-profile.mobileprovision" > "$RUNNER_TEMP/modernsecure-profile.plist"
python3 - <<'PY'
import datetime, os, plistlib, re, shutil
from pathlib import Path
p = plistlib.loads(Path(os.environ['RUNNER_TEMP'], 'modernsecure-profile.plist').read_bytes())
team = os.environ['APPLE_TEAM_ID']
if not re.fullmatch(r'[A-Z0-9]{10}', team):
    raise SystemExit('Invalid Apple Team ID')
e = p.get('Entitlements', {})
if p.get('TeamIdentifier') != [team] or e.get('application-identifier') != team + '.kz.modernsecure.app':
    raise SystemExit('Provisioning profile belongs to a different team or bundle ID')
if p['ExpirationDate'] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit('Provisioning profile expired')
if p.get('ProvisionedDevices') or p.get('ProvisionsAllDevices') or e.get('get-task-allow'):
    raise SystemExit('Use an App Store distribution profile, not development, ad hoc or enterprise')
if e.get('aps-environment') != 'production':
    raise SystemExit('Profile needs the production Push Notifications entitlement used by this project')
uid = p.get('UUID', '')
if not re.fullmatch(r'[0-9A-Fa-f-]{36}', uid):
    raise SystemExit('Invalid provisioning profile UUID')
destination = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
destination.mkdir(parents=True, exist_ok=True)
shutil.copyfile(Path(os.environ['RUNNER_TEMP'], 'modernsecure-profile.mobileprovision'), destination / (uid + '.mobileprovision'))
with open(os.environ['GITHUB_ENV'], 'a') as f:
    f.write('IOS_PROFILE_UUID=' + uid + '\n')
PY
KEYCHAIN_PATH="$RUNNER_TEMP/modernsecure-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
echo "::add-mask::$KEYCHAIN_PASSWORD"
echo "IOS_KEYCHAIN_PATH=$KEYCHAIN_PATH" >> "$GITHUB_ENV"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$RUNNER_TEMP/modernsecure-signing.p12" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -k "$KEYCHAIN_PATH" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null
security list-keychains -d user -s "$KEYCHAIN_PATH" "$HOME/Library/Keychains/login.keychain-db"
