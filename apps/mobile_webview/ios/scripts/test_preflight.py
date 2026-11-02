import importlib.util
import json
import plistlib
import shutil
import tempfile
import unittest
from pathlib import Path

MODULE_SPEC = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("preflight.py"))
preflight = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(preflight)


class ReleaseSafeguards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for relative in (
            "Info.plist", "project.yml", "Sources/PrivacyInfo.xcprivacy",
            "Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
            "ModernSecure.xcodeproj/project.pbxproj",
            "ModernSecure.xcodeproj/xcshareddata/xcschemes/ModernSecure.xcscheme",
            "app-store/metadata.ru.json", "app-store/release-evidence.example.json",
        ):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(preflight.ROOT / relative, destination)

    def test_checked_in_sources_pass(self):
        self.assertEqual(preflight.check_sources(self.root), [])

    def test_placeholder_domain_blocks_build(self):
        path = self.root / "project.yml"
        path.write_text(path.read_text().replace("modernsecure.shpshka.work", "REPLACE_WITH_YOUR_DOMAIN"))
        self.assertTrue(preflight.check_sources(self.root))

    def test_unsafe_transport_blocks_build(self):
        path = self.root / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["NSAppTransportSecurity"]["NSAllowsArbitraryLoadsInWebContent"] = True
        path.write_bytes(plistlib.dumps(info))
        self.assertTrue(preflight.check_sources(self.root))

    def test_absent_firebase_resource_blocks_clean_checkout(self):
        path = self.root / "ModernSecure.xcodeproj/project.pbxproj"
        path.write_text(path.read_text() + "\n/* GoogleService-Info.plist in Resources */\n")
        self.assertTrue(preflight.check_sources(self.root))

    def test_unverified_release_cannot_pass_submission(self):
        self.assertTrue(preflight.check_submission(self.root))
        evidence = self.root / "app-store/release-evidence.local.json"
        shutil.copyfile(self.root / "app-store/release-evidence.example.json", evidence)
        self.assertTrue(preflight.check_submission(self.root))

    def test_missing_one_release_gate_is_not_silently_skipped(self):
        metadata_path = self.root / "app-store/metadata.ru.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata.update(supportUrl="https://example.test/support", copyright="QA fixture")
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        evidence = json.loads((self.root / "app-store/release-evidence.example.json").read_text())
        evidence["teamId"] = "ABCDE12345"
        evidence["appStoreConnectAppId"] = "1234567890"
        evidence["verified"] = {key: True for key in evidence["verified"]}
        path = self.root / "evidence.json"
        path.write_text(json.dumps(evidence))
        self.assertEqual(preflight.check_submission(self.root, path), [])
        del evidence["verified"]["accountDeletionEndToEndTested"]
        path.write_text(json.dumps(evidence))
        self.assertTrue(preflight.check_submission(self.root, path))


if __name__ == "__main__":
    unittest.main()
