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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/store-screenshots'
PRIVATE = ROOT / 'build/private-screenshot-tests'
RUNNER_ID = 'kz.modernsecure.screenshot-tests.xctrunner'
EXPECTED = ['01-cases.png', '02-case-overview.png', '03-tasks.png', '04-documents.png']


def simctl(*arguments):
    return subprocess.check_output(['xcrun', 'simctl', *arguments], text=True).strip()


def xcode(arguments, name, environment=None):
    with (PRIVATE / (name + '.log')).open('w', encoding='utf-8') as log:
        result = subprocess.run(['xcodebuild', *arguments], cwd=ROOT, env=environment,
                                stdout=log, stderr=subprocess.STDOUT, timeout=1200)
    if result.returncode:
        # Do not publish raw XCTest activities, typed credentials, or snapshots.
        text = (PRIVATE / (name + '.log')).read_text(encoding='utf-8', errors='replace')
        safe = [line for line in text.splitlines() if re.search(r'error:|CaptureError|\*\* TEST|\*\* BUILD', line)]
        secrets = json.loads((ROOT / 'build/screenshot-access.local.json').read_text())
        for line in safe[-15:]:
            for secret in secrets.values():
                line = line.replace(secret, '[omitted]')
            print(line[:500], flush=True)
        raise RuntimeError(f'{name} failed; raw log retained only in private runner directory')


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
    runtimes = sorted((r for r in inventory if '.iOS-' in r),
                      key=lambda r: tuple(map(int, re.findall(r'\d+', r))), reverse=True)
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    report = {'sourceCommit': source, 'version': '1.0.0', 'build': '2',
              'origin': 'https://modernsecure.shpshka.work', 'syntheticCaseOnly': True, 'devices': []}
    for family, names, size in [
        ('iphone', ['iPhone 17 Pro', 'iPhone 16 Pro'], (1206, 2622)),
        ('ipad', ['iPad Pro 13-inch (M5)', 'iPad Pro 13-inch (M4)'], (2064, 2752)),
    ]:
        choices = [(r, d) for r in runtimes for wanted in names for d in inventory[r]
                   if d.get('isAvailable') and d['name'] == wanted]
        if not choices:
            raise RuntimeError(f'No required {family} screenshot simulator available')
        runtime, device = choices[0]
        udid = device['udid']
        print('Capturing ' + device['name'] + ' / ' + runtime, flush=True)
        try:
            if device['state'] != 'Booted':
                simctl('boot', udid)
            simctl('bootstatus', udid, '-b')
            simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi',
                   '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
            environment = os.environ.copy()
            environment['TEST_RUNNER_SCREENSHOT_EMAIL'] = credentials['email']
            environment['TEST_RUNNER_SCREENSHOT_PASSWORD'] = credentials['password']
            xcode([*common, '-destination', 'id=' + udid, '-parallel-testing-enabled', 'NO',
                   '-resultBundlePath', str(PRIVATE / (family + '.xcresult')), 'test-without-building'],
                  family, environment)
            container = Path(simctl('get_app_container', udid, RUNNER_ID, 'data'))
            images = container / 'Documents/AppStoreScreenshots'
            target = OUTPUT / family
            target.mkdir(exist_ok=True)
            files = []
            for name in EXPECTED:
                blob = (images / name).read_bytes()
                if blob[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', blob[16:24]) != size:
                    raise RuntimeError('Unexpected screenshot format or native dimensions')
                shutil.copyfile(images / name, target / name)
                files.append({'name': family + '/' + name, 'width': size[0], 'height': size[1],
                              'sha256': hashlib.sha256(blob).hexdigest()})
            report['devices'].append({'family': family, 'device': device['name'], 'runtime': runtime, 'files': files})
            (OUTPUT / 'capture-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
            print(f'Captured {len(files)} native {family} screenshots.', flush=True)
        finally:
            subprocess.run(['xcrun', 'simctl', 'shutdown', udid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
