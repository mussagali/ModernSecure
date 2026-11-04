import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capture_idb', Path(__file__).with_name('capture-idb-simulator.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class NativeBridgePrivacyTests(unittest.TestCase):
    def test_diagnostic_summary_omits_unknown_labels_and_all_field_values(self):
        nodes = [{'type': 'TextField', 'AXLabel': 'private-client-name', 'AXValue': 'private-password'},
                 {'type': 'TextField', 'AXLabel': 'Пароль', 'AXValue': 'another-private-password'}]
        summary = json.dumps(capture.safe_summary(nodes), ensure_ascii=False)
        self.assertNotIn('private-client-name', summary)
        self.assertNotIn('private-password', summary)
        self.assertIn('Пароль', summary)

    def test_failed_command_does_not_disclose_private_arguments(self):
        secret = 'synthetic-test-secret'
        failure = subprocess.CalledProcessError(1, ['idb', '--value', secret])
        with patch.object(capture.subprocess, 'run', side_effect=failure):
            with self.assertRaises(capture.CaptureError) as result:
                capture.Screen('device').call('ui', 'set-value', 'field', '--value', secret)
        self.assertNotIn(secret, str(result.exception))

    def test_timeout_does_not_disclose_private_arguments(self):
        secret = 'synthetic-test-secret'
        with patch.object(capture.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['idb', secret], 60)):
            with self.assertRaises(capture.CaptureError) as result:
                capture.Screen('device').call('ui', 'set-value', 'field', '--value', secret)
        self.assertNotIn(secret, str(result.exception))


if __name__ == '__main__':
    unittest.main()
