import importlib.util
import io
import json
from itertools import chain, repeat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    'capture_store_simulator', Path(__file__).with_name('capture-store-simulator.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureProcessTests(unittest.TestCase):
    def test_timeout_preserves_failure_and_masks_private_log_values(self):
        process = Mock(returncode=None)
        process.poll.side_effect = [None, None]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'build').mkdir()
            (root / 'build/screenshot-access.local.json').write_text(json.dumps({'password': 'canary-secret-value'}))
            def start(*args, **kwargs):
                kwargs['stdout'].write('error: failure involving canary-secret-value\n')
                return process
            output = io.StringIO()
            with patch.object(capture, 'ROOT', root), patch.object(capture, 'PRIVATE', root), \
                 patch.object(capture.subprocess, 'Popen', side_effect=start), \
                 patch.object(capture.time, 'monotonic', side_effect=[0, 0, 421]), \
                 patch('sys.stdout', output):
                with self.assertRaisesRegex(RuntimeError, 'bounded capture time'):
                    capture.xcode([], 'iphone', {'SCREENSHOT_SIMULATOR_UDID': 'test-device'})
            self.assertNotIn('canary-secret-value', output.getvalue())
            self.assertIn('[omitted]', output.getvalue())
        process.terminate.assert_called_once()

    def test_runner_launch_failure_retries_on_the_same_booted_device(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'iphone.log').write_text('Simulator device failed to launch ' + capture.RUNNER_ID)
            with patch.object(capture, 'PRIVATE', root), \
                 patch.object(capture, 'xcode', side_effect=[RuntimeError('launch failed'), None]) as xcode:
                capture.capture_ui_test([], 'same-device', 'iphone', {})
            self.assertEqual(xcode.call_count, 2)
            for call in xcode.call_args_list:
                self.assertIn('id=same-device', call.args[0])

    def test_real_app_test_failure_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'iphone.log').write_text('CaptureError.demoCaseUnavailable')
            with patch.object(capture, 'PRIVATE', root), \
                 patch.object(capture, 'xcode', side_effect=RuntimeError('app test failed')) as xcode:
                with self.assertRaises(RuntimeError):
                    capture.capture_ui_test([], 'same-device', 'iphone', {})
            xcode.assert_called_once()

    def test_diagnostic_timeout_does_not_interrupt_successful_xctest(self):
        process = Mock(returncode=0)
        process.poll.side_effect = [None, 0, 0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(capture, 'PRIVATE', root), patch.object(capture, 'OUTPUT', root), \
                 patch.object(capture.subprocess, 'Popen', return_value=process), \
                 patch.object(capture.subprocess, 'run', side_effect=subprocess.TimeoutExpired('simctl', 10)), \
                 patch.object(capture.time, 'monotonic', side_effect=chain([0, 0], repeat(31))), \
                 patch.object(capture.time, 'sleep'):
                capture.xcode([], 'iphone', {'SCREENSHOT_SIMULATOR_UDID': 'test-device'})
        process.terminate.assert_not_called()

    def test_unexpected_capture_error_terminates_xcode_before_next_device(self):
        process = Mock(returncode=None)
        process.poll.side_effect = [None, None]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(capture, 'PRIVATE', root), patch.object(capture, 'OUTPUT', root), \
                 patch.object(capture.subprocess, 'Popen', return_value=process), \
                 patch.object(capture.subprocess, 'run', side_effect=OSError('simctl unavailable')), \
                 patch.object(capture.time, 'monotonic', side_effect=chain([0, 0], repeat(31))), \
                 patch.object(capture.time, 'sleep'):
                with self.assertRaises(OSError):
                    capture.xcode([], 'iphone', {'SCREENSHOT_SIMULATOR_UDID': 'test-device'})
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=20)


if __name__ == '__main__':
    unittest.main()
