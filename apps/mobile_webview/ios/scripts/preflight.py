#!/usr/bin/env python3
"""Cross-platform source check; --submission also checks release evidence.

This does not compile Swift or certify compliance. No Apple credentials needed.
"""
import argparse
import json
import plistlib
import re
import struct
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_sources(root=ROOT):
    errors = []

    def check(ok, message):
        if not ok:
            errors.append(message)

    info = plistlib.loads((root / "Info.plist").read_bytes())
    manifest = plistlib.loads((root / "Sources/PrivacyInfo.xcprivacy").read_bytes())
    project = (root / "ModernSecure.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
    spec = (root / "project.yml").read_text(encoding="utf-8")
    check("REPLACE_WITH_YOUR_DOMAIN" not in spec + project, "Release host is still a placeholder")
    for text in (spec, project):
        check("modernsecure.shpshka.work" in text, "Production host missing")
    check("Release:\n      SITE_HOST: modernsecure.shpshka.work\n      SITE_SCHEME: https" in spec,
          "Release must use the production HTTPS origin")
    check(info.get("CFBundleShortVersionString") == "$(MARKETING_VERSION)", "Version must use MARKETING_VERSION")
    check(info.get("CFBundleVersion") == "$(CURRENT_PROJECT_VERSION)", "Build must use CURRENT_PROJECT_VERSION")
    check(not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads"), "Arbitrary HTTP loads enabled")
    check(not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoadsInWebContent"), "HTTP WebView loads enabled")
    check(manifest.get("NSPrivacyTracking") is False and manifest.get("NSPrivacyTrackingDomains") == [], "Unexpected tracking declaration")
    apis = manifest.get("NSPrivacyAccessedAPITypes", [])
    check(any(api.get("NSPrivacyAccessedAPIType") == "NSPrivacyAccessedAPICategoryUserDefaults"
              and "CA92.1" in api.get("NSPrivacyAccessedAPITypeReasons", []) for api in apis), "UserDefaults reason missing")
    collected = manifest.get("NSPrivacyCollectedDataTypes", [])
    check(bool(collected), "Web account data collection must not be omitted")
    check(all(item.get("NSPrivacyCollectedDataTypeTracking") is False for item in collected), "Unexpected tracking purpose")
    check("PrivacyInfo.xcprivacy in Resources" in project, "Privacy manifest is not bundled")
    # A generated reference to an absent optional Firebase file breaks a clean checkout.
    check((root / "GoogleService-Info.plist").exists() or "GoogleService-Info.plist in Resources" not in project,
          "Generated project references a missing Firebase configuration; regenerate it")
    scheme = ET.parse(root / "ModernSecure.xcodeproj/xcshareddata/xcschemes/ModernSecure.xcscheme")
    check(scheme.find("ArchiveAction").get("buildConfiguration") == "Release", "Archive scheme must use Release")
    icon = (root / "Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png").read_bytes()
    check(icon[:8] == b"\x89PNG\r\n\x1a\n", "App icon must be PNG")
    width, height, _, color, _, _, _ = struct.unpack(">IIBBBBB", icon[16:29])
    check((width, height) == (1024, 1024), "App icon must be 1024 x 1024")
    check(color in (0, 2), "App Store icon must have no alpha/transparency channel")
    metadata = json.loads((root / "app-store/metadata.ru.json").read_text(encoding="utf-8"))
    bundle_id = metadata.get("bundleId", "")
    check(bool(re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle_id)),
          "App Store Connect bundle ID missing from metadata")
    check(f"PRODUCT_BUNDLE_IDENTIFIER: {bundle_id}\n" in spec,
          "XcodeGen bundle ID differs from App Store Connect metadata")
    project_ids = re.findall(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);", project)
    check(bool(project_ids) and all(value == bundle_id for value in project_ids),
          "Generated Xcode project bundle ID differs from App Store Connect metadata")
    for script in ("install-signing.sh", "build.sh", "verify-bundle.py", "smoke-simulator.py"):
        check(bundle_id in (root / "scripts" / script).read_text(encoding="utf-8"),
              f"Bundle ID missing or stale in {script}")
    for name, limit in (("name", 30), ("subtitle", 30), ("keywords", 100), ("description", 4000), ("promotionalText", 170)):
        check(isinstance(metadata.get(name), str) and 0 < len(metadata[name]) <= limit, f"Invalid App Store field: {name}")
    return errors


def check_submission(root=ROOT, evidence_path=None):
    # Evidence remains private: reviewer credentials must be entered only in ASC.
    path = Path(evidence_path) if evidence_path else root / "app-store/release-evidence.local.json"
    if not path.is_file():
        return ["Release evidence missing: copy release-evidence.example.json to release-evidence.local.json and complete it honestly"]
    evidence = json.loads(path.read_text(encoding="utf-8"))
    template = json.loads((root / "app-store/release-evidence.example.json").read_text(encoding="utf-8"))
    errors = []
    metadata = json.loads((root / "app-store/metadata.ru.json").read_text(encoding="utf-8"))
    for key in ("supportUrl", "privacyPolicyUrl"):
        url = urlparse(metadata.get(key, ""))
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            errors.append(f"Public HTTPS URL missing: {key}")
    if not metadata.get("copyright", "").strip():
        errors.append("Owner-approved copyright missing")
    if not re.fullmatch(r"[A-Z0-9]{10}", evidence.get("teamId", "")):
        errors.append("Valid Apple Developer Team ID missing")
    if not evidence.get("appStoreConnectAppId", "").isdigit():
        errors.append("App Store Connect numeric app ID missing")
    elif evidence["appStoreConnectAppId"] != metadata.get("appStoreConnectAppId"):
        errors.append("Release evidence refers to a different App Store Connect app")
    for key in template["verified"]:
        if evidence.get("verified", {}).get(key) is not True:
            errors.append(f"Release blocker: {key}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--submission", action="store_true")
    parser.add_argument("--evidence", help="Private release evidence JSON path")
    args = parser.parse_args()
    try:
        errors = check_sources()
        if args.submission:
            errors += check_submission(evidence_path=args.evidence)
    except (OSError, ValueError, KeyError, ET.ParseError, struct.error) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    for message in errors:
        print(f"FAIL: {message}", file=sys.stderr)
    if not errors:
        print("PASS: iOS source preflight" + (" and supplied release evidence" if args.submission else " (not an Xcode build or submission approval)"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
