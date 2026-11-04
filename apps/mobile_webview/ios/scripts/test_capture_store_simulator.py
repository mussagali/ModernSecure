import importlib.util
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
