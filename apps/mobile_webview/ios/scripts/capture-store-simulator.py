#!/usr/bin/env python3
"""Capture the real production app UI using only the isolated review account.

Xcode logs/results stay private on the runner; only explicit post-login PNGs and
a sanitized device/source report can enter the screenshots artifact.
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/store-screenshots'
PRIVATE = ROOT / 'build/private-screenshot-tests'
RUNNER_ID = 'kz.modernsecure.screenshot-tests.xctrunner'
EXPECTED = ['01-cases.png', '02-case-overview.png', '03-tasks.png', '04-documents.png']


def simctl(*arguments, timeout=180):
    return subprocess.check_output(['xcrun', 'simctl', *arguments], text=True, timeout=timeout).strip()


def xcode(arguments, name, environment=None):
    failure = None
    with (PRIVATE / (name + '.log')).open('w', encoding='utf-8') as log:
        result = subprocess.Popen(['xcodebuild', *arguments], cwd=ROOT, env=environment,
                                  stdout=log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + (900 if name == 'build' else 420)
        next_diagnostic = time.monotonic() + 30
        last_phase = None
        try:
            while result.poll() is None:
                if time.monotonic() > deadline:
                    raise RuntimeError(name + ' exceeded bounded capture time')
                if name != 'build' and time.monotonic() >= next_diagnostic:
                    phase_file = Path(environment.get('TEST_RUNNER_SCREENSHOT_OUTPUT_DIRECTORY', str(PRIVATE))) / 'diagnostic-phase.txt'
                    if phase_file.is_file():
                        phase = phase_file.read_text(encoding='utf-8')
                        if phase != last_phase and re.fullmatch(r'waiting-for-login|entering-dedicated-(?:email|password)(?:-\d+-of-\d+)?|waiting-for-synthetic-case-after-login|opening-(?:case|tasks|documents)', phase):
                            print(name + ': UI phase=' + phase, flush=True)
                            last_phase = phase
                    # A failed diagnostic must not interrupt XCTest or leave
                    # xcodebuild running while the next simulator boots.
                    udid = environment['SCREENSHOT_SIMULATOR_UDID']
                    destination = OUTPUT / 'diagnostics' / name
                    destination.mkdir(parents=True, exist_ok=True)
                    frame = destination / ('frame-' + str(int(time.monotonic())) + '.png')
                    try:
                        diagnostic = subprocess.run(
                            ['xcrun', 'simctl', 'io', udid, 'screenshot', str(frame)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                        if diagnostic.returncode == 0:
                            print(name + ': simulator diagnostic frame captured (not an App Store image).', flush=True)
                    except subprocess.TimeoutExpired:
                        print(name + ': diagnostic frame timed out; XCTest continues.', flush=True)
                    next_diagnostic = time.monotonic() + 45
                time.sleep(2)
        except Exception as error:
            failure = error
        finally:
            if result.poll() is None:
                result.terminate()
                try:
                    result.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    result.kill()
                    result.wait(timeout=20)
    if result.returncode or failure:
        # Do not publish raw XCTest activities, typed credentials, or snapshots.
        text = (PRIVATE / (name + '.log')).read_text(encoding='utf-8', errors='replace')
        safe = [line for line in text.splitlines() if re.search(r'error:|CaptureError|SCREENSHOT_CAPTURED|SCREENSHOT_INPUT_CHECK|\*\* TEST|\*\* BUILD', line)]
        secret_file = ROOT / 'build/screenshot-access.local.json'
        if secret_file.is_file():
            secrets = json.loads(secret_file.read_text())
            for line in safe[-15:]:
                for secret in secrets.values():
                    line = line.replace(secret, '[omitted]')
                print(line[:2500], flush=True)
        if failure:
            raise failure
        raise RuntimeError(f'{name} failed; raw log retained only in private runner directory')


def capture_ui_test(common, udid, family, environment):
    arguments = [*common, '-destination', 'id=' + udid, '-parallel-testing-enabled', 'NO',
                 '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '240',
                 '-maximum-test-execution-time-allowance', '300']
    try:
        xcode([*arguments, '-resultBundlePath', str(PRIVATE / (family + '.xcresult')),
               'test-without-building'], family, environment)
    except RuntimeError:
        log = PRIVATE / (family + '.log')
        text = log.read_text(encoding='utf-8', errors='replace') if log.is_file() else ''
        # Retry only the simulator's failure to start XCTest, never an app test
        # failure or a missing demo case. The already-booted device is reused.
        if 'Simulator device failed to launch ' + RUNNER_ID not in text:
            raise
        print(f'{family}: XCTest runner launch failed; retrying once on the booted device.', flush=True)
        xcode([*arguments, '-resultBundlePath', str(PRIVATE / (family + '-retry.xcresult')),
               'test-without-building'], family + '-retry', environment)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    credentials = json.loads((ROOT / 'build/screenshot-access.local.json').read_text())
    if credentials['email'] != 'apple-review-modernsecure@example.test':
        raise RuntimeError('Dedicated synthetic-case account required')
    subprocess.run(['xcodegen', 'generate', '--spec', 'project.screenshots.yml'], cwd=ROOT, check=True)
    common = ['-project', 'ModernSecure.xcodeproj', '-scheme', 'ModernSecureScreenshots',
              '-configuration', 'Release', '-derivedDataPath', 'build/simulator',
              'CODE_SIGNING_ALLOWED=NO', 'MARKETING_VERSION=1.0.0', 'CURRENT_PROJECT_VERSION=2']
    print('Building test-only capture runner; shipping app sources unchanged.', flush=True)
    xcode([*common, '-destination', 'generic/platform=iOS Simulator', 'build-for-testing'], 'build')
    inventory = json.loads(simctl('list', 'devices', 'available', '--json'))['devices']
    # Keep capture reproducible on the runtime used for the validated build.
    runtime_id = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2'
    if runtime_id not in inventory:
        raise RuntimeError('The required iOS 26.2 screenshot runtime is unavailable')
    runtimes = [runtime_id]
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    report = {'sourceCommit': source, 'version': '1.0.0', 'build': '2',
              'origin': 'https://modernsecure.shpshka.work', 'syntheticCaseOnly': True, 'devices': []}
    requested_family = os.environ.get('SCREENSHOT_DEVICE_FAMILY', 'both')
    if requested_family not in {'both', 'iphone', 'ipad'}:
        raise RuntimeError('Unknown screenshot device family')
    errors = []
    for family, names, size in [
        ('iphone', ['iPhone 17 Pro', 'iPhone 16 Pro'], (1206, 2622)),
        ('ipad', ['iPad Pro 13-inch (M5)', 'iPad Pro 13-inch (M4)'], (2064, 2752)),
    ]:
        if requested_family != 'both' and family != requested_family:
            continue
        choices = [(r, d) for r in runtimes for wanted in names for d in inventory[r]
                   if d.get('isAvailable') and d['name'] == wanted]
        if not choices:
            raise RuntimeError(f'No required {family} screenshot simulator available')
        runtime, device = choices[0]
        udid = device['udid']
        print('Capturing ' + device['name'] + ' / ' + runtime, flush=True)
        try:
            print(f'{family}: booting simulator (up to 600 seconds for first-boot migration).', flush=True)
            if device['state'] != 'Booted':
                simctl('boot', udid)
            # Run headlessly, as in the successful native startup captures.
            # The Simulator GUI adds rendering load on the small hosted VM.
            simctl('bootstatus', udid, '-b', timeout=600)
            print(f'{family}: simulator booted.', flush=True)
            simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi',
                   '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
            environment = os.environ.copy()
            environment['TEST_RUNNER_SCREENSHOT_EMAIL'] = credentials['email']
            environment['TEST_RUNNER_SCREENSHOT_PASSWORD'] = credentials['password']
            environment['SCREENSHOT_SIMULATOR_UDID'] = udid
            images = PRIVATE / (family + '-captures')
            images.mkdir(exist_ok=True)
            environment['TEST_RUNNER_SCREENSHOT_OUTPUT_DIRECTORY'] = str(images)
            # Warm the same production app before XCTest starts its own runner.
            app_bundle = ROOT / 'build/simulator/Build/Products/Release-iphonesimulator/ModernSecure.app'
            print(f'{family}: installing production app (up to 420 seconds on a cold runner).', flush=True)
            simctl('install', udid, str(app_bundle), timeout=420)
            simctl('launch', '--terminate-running-process', udid, 'kz.modernsecure.modernSecure', timeout=120)
            print(f'{family}: production app installed and launched.', flush=True)
            time.sleep(12)
            print(f'{family}: starting bounded UI capture test.', flush=True)
            test_error = None
            try:
                capture_ui_test(common, udid, family, environment)
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                test_error = type(error).__name__
                errors.append(family + ': UI capture failed (' + test_error + ')')
                print(f'{family}: preserving completed captures and diagnostics after UI test failure.', flush=True)
            target = OUTPUT / family
            target.mkdir(exist_ok=True)
            files = []
            for name in EXPECTED:
                if not (images / name).is_file():
                    if test_error:
                        continue
                    raise RuntimeError('Expected authenticated screenshot missing')
                blob = (images / name).read_bytes()
                if blob[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', blob[16:24]) != size:
                    raise RuntimeError('Unexpected screenshot format or native dimensions')
                shutil.copyfile(images / name, target / name)
                files.append({'name': family + '/' + name, 'width': size[0], 'height': size[1],
                              'sha256': hashlib.sha256(blob).hexdigest()})
            diagnostics = OUTPUT / 'diagnostics' / family
            diagnostics.mkdir(parents=True, exist_ok=True)
            for name in ['diagnostic-failure.png', 'diagnostic-phase.txt']:
                if (images / name).is_file():
                    shutil.copyfile(images / name, diagnostics / name)
            report['devices'].append({'family': family, 'device': device['name'], 'runtime': runtime,
                                      'captureTestPassed': test_error is None, 'files': files})
            report['errors'] = errors
            (OUTPUT / 'capture-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
            print(f'Captured {len(files)} native {family} screenshots.', flush=True)
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            errors.append(family + ': ' + type(error).__name__)
            report['errors'] = errors
            (OUTPUT / 'capture-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
            print(f'{family}: capture failed ({type(error).__name__}); continuing with the other device family.', flush=True)
        finally:
            try:
                subprocess.run(['xcrun', 'simctl', 'shutdown', udid], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=45)
            except subprocess.TimeoutExpired:
                print(f'{family}: shutdown requested; disposable runner will finish cleanup.', flush=True)
    if errors:
        raise RuntimeError('Capture checks failed; inspect the preserved real screenshots and diagnostics.')


if __name__ == '__main__':
    main()
