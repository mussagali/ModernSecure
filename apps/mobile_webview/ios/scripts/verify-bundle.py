#!/usr/bin/env python3
"""Inspect the actual compiled .app, not only its source configuration."""
import plistlib
import sys
from pathlib import Path

app = Path(sys.argv[1])
version, build = sys.argv[2:4]
info = plistlib.loads((app / "Info.plist").read_bytes())
expected = {
    "CFBundleIdentifier": "kz.modernsecure.modernSecure",
    "CFBundleShortVersionString": version,
    "CFBundleVersion": build,
    "SiteURL": "https://modernsecure.shpshka.work",
}
for key, value in expected.items():
    if info.get(key) != value:
        raise SystemExit(f"Compiled bundle has incorrect {key}")
ipad_orientations = info.get("UISupportedInterfaceOrientations~ipad", info.get("UISupportedInterfaceOrientations", []))
if set(ipad_orientations) != {
    "UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight",
}:
    raise SystemExit("Compiled bundle must support all four iPad multitasking orientations")
manifest = plistlib.loads((app / "PrivacyInfo.xcprivacy").read_bytes())
if manifest.get("NSPrivacyTracking") is not False:
    raise SystemExit("Compiled privacy manifest has an unexpected tracking declaration")
if not (app / "Assets.car").exists():
    raise SystemExit("Compiled asset catalog missing")
print("PASS: compiled bundle ID, release origin, version, privacy manifest and asset catalog")
