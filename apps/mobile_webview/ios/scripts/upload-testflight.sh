#!/bin/bash
set -euo pipefail
: "${RUNNER_TEMP:?Run on a GitHub-hosted macOS runner}"
: "${ASC_KEY_ID:?Missing ASC_KEY_ID secret}"
: "${ASC_ISSUER_ID:?Missing ASC_ISSUER_ID secret}"
: "${ASC_PRIVATE_KEY_P8_BASE64:?Missing App Store Connect API key secret}"
[[ "$ASC_KEY_ID" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Invalid ASC key ID' >&2; exit 1; }
[[ "$ASC_ISSUER_ID" =~ ^[A-Fa-f0-9-]{36}$ ]] || { echo 'Invalid ASC issuer ID' >&2; exit 1; }
cd "$(dirname "$0")/.."
IPA=build/export/ModernSecure.ipa
test -f "$IPA"
umask 077
export API_PRIVATE_KEYS_DIR="$RUNNER_TEMP/modernsecure-asc-keys"
mkdir -p "$API_PRIVATE_KEYS_DIR"
trap 'rm -f "$API_PRIVATE_KEYS_DIR/AuthKey_$ASC_KEY_ID.p8"' EXIT
python3 - <<'PY'
import base64, os
from pathlib import Path
key = base64.b64decode(os.environ['ASC_PRIVATE_KEY_P8_BASE64'], validate=True)
if not key.startswith(b'-----BEGIN PRIVATE KEY-----'):
    raise SystemExit('Invalid App Store Connect .p8 private key')
Path(os.environ['API_PRIVATE_KEYS_DIR'], 'AuthKey_' + os.environ['ASC_KEY_ID'] + '.p8').write_bytes(key)
PY
xcrun altool --validate-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tee build/altool-validate.log
python3 scripts/check-altool-result.py validate build/altool-validate.log
xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tee build/altool-upload.log
python3 scripts/check-altool-result.py upload build/altool-upload.log
echo 'Uploaded to App Store Connect for processing. App Review submission and public release were not performed.'
