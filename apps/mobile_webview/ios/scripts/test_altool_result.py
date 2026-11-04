import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("altool_result", Path(__file__).with_name("check-altool-result.py"))
altool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(altool)


class AppleResultChecks(unittest.TestCase):
    def test_zero_exit_apple_rejection_is_not_success(self):
        output = "VERIFY FAILED with 1 error\nERROR: Validation failed (409) Invalid bundle.\nFailed to validate package."
        self.assertIsNotNone(altool.check_result("validate", output))

    def test_rejection_takes_precedence_over_success_text(self):
        self.assertIsNotNone(altool.check_result("upload", "UPLOAD SUCCEEDED\nERROR: Invalid bundle"))

    def test_ambiguous_response_blocks_next_step(self):
        self.assertIsNotNone(altool.check_result("upload", "Running altool..."))

    def test_positive_apple_confirmations(self):
        for operation, output in (("validate", "VERIFY SUCCEEDED"), ("validate", "No errors validating 'app.ipa'."), ("upload", "UPLOAD SUCCEEDED"), ("upload", "No errors uploading 'app.ipa'.")):
            with self.subTest(operation=operation, output=output):
                self.assertIsNone(altool.check_result(operation, output))


if __name__ == "__main__":
    unittest.main()
