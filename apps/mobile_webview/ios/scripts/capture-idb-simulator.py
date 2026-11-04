#!/usr/bin/env python3
"""Capture the production app through native accessibility, without XCTest.

Uses Meta's local idb CLI. Credentials and accessibility values never enter logs
or artifacts. Store images require the full isolated synthetic-case title.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import time

spec = importlib.util.spec_from_file_location('capture_common', Path(__file__).with_name('capture-store-simulator.py'))
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
ROOT, OUTPUT = common.ROOT, common.OUTPUT
DEMO_TITLE = 'ДЕМО APPLE — проверка приложения, не юридическая услуга'


class CaptureError(RuntimeError):
    pass


def flatten(value):
    if isinstance(value, list):
        return [node for item in value for node in flatten(item)]
    if isinstance(value, dict):
        return [value, *flatten(value.get('children', []))]
    return []


def label(node):
    return str(node.get('AXLabel') or '')


def role(node):
    return ' '.join(str(node.get(key) or '') for key in ['type', 'role', 'role_description', 'subrole']).lower()


def safe_summary(nodes):
    known = ['Вход в аккаунт', 'Электронная почта', 'Пароль', 'Войти', DEMO_TITLE,
             'Текущий этап', 'Задачи', 'Документы', 'Нужно загрузить']
    return [{'type': str(node.get('type', ''))[:60], 'role': str(node.get('role', ''))[:60],
             'labelKind': next((text for text in known if text in label(node)), '[redacted]'),
             'frame': node.get('frame'), 'hasValue': bool(node.get('AXValue'))}
            for node in nodes[:300]]


class Screen:
    def __init__(self, udid):
        self.udid = udid
        self.last_nodes = []
        self.last_operation = 'not-started'

    def call(self, *arguments):
        self.last_operation = ':'.join(arguments[:2])
        # Never let CalledProcessError/TimeoutExpired echo a secret argument.
        try:
            result = subprocess.run(['idb', *arguments, '--udid', self.udid],
                                    capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            raise CaptureError('Native accessibility command unavailable or timed out') from None
        if result.returncode:
            raise CaptureError('Native accessibility operation failed (exit ' + str(result.returncode) + ')')
        return result.stdout

    def read(self):
        try:
            self.last_nodes = flatten(json.loads(self.call('ui', 'describe-all', '--api', 'axbridge',
                                                         '--client-type', 'xctest')))
            return self.last_nodes
        except json.JSONDecodeError:
            raise CaptureError('Native accessibility response was not valid JSON') from None

    def wait(self, predicate, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                nodes = self.read()
                candidates = [node for node in nodes if predicate(node)]
                if candidates:
                    return nodes, candidates[0]
            except CaptureError:
                pass
            time.sleep(2)
        raise CaptureError('Expected native UI state did not appear')

    @staticmethod
    def point(node):
        frame = node.get('frame') or {}
        if not all(isinstance(frame.get(key), (float, int)) for key in ['x', 'y', 'width', 'height']):
            raise CaptureError('Native element frame unavailable')
        if frame['width'] <= 0 or frame['height'] <= 0:
            raise CaptureError('Native element has no visible frame')
        return str(round(frame['x'] + frame['width'] / 2)), str(round(frame['y'] + frame['height'] / 2))

    def set_field(self, text, value):
        placeholder = 'name@example.com' if text == 'Электронная почта' else 'Пароль'
        matches = lambda node: ('textfield' in role(node) or 'textinput' in role(node)) \
            and (text in label(node) or placeholder == node.get('AXValue')
                 or placeholder == node.get('placeholder'))
        _, node = self.wait(matches)
        point = self.point(node)
        try:
            self.call('ui', 'set-value', *point, '--value', value, '--api', 'axbridge')
        except CaptureError:
            # Some WebKit secure fields expose no accessibility value setter.
            _, node = self.wait(matches)
            self.call('ui', 'tap', *self.point(node))
            self.read()
            self.call('ui', 'text', value)
        # Refresh after each UI action; no accessibility values are printed.
        self.read()

    def tap(self, text):
        try:
            self.call('ui', 'scroll', 'visible', text, '--api', 'axbridge')
        except CaptureError:
            pass
        _, node = self.wait(lambda node: text in label(node)
                            and ('button' in role(node) or 'link' in role(node)))
        self.call('ui', 'tap', *self.point(node))
        self.read()


def capture_image(udid, directory, family, name, size):
    target = directory / (name + '.png')
    common.simctl('io', udid, 'screenshot', str(target), timeout=30)
    blob = target.read_bytes()
    if blob[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', blob[16:24]) != size:
        raise CaptureError('Native screenshot dimensions do not match the store slot')
    return {'name': family + '/' + target.name, 'width': size[0], 'height': size[1],
            'sha256': hashlib.sha256(blob).hexdigest()}


def main():
    credentials = json.loads((ROOT / 'build/screenshot-access.local.json').read_text())
    if credentials['email'] != 'apple-review-modernsecure@example.test':
        raise CaptureError('Dedicated synthetic-case account required')
    requested = os.environ.get('SCREENSHOT_DEVICE_FAMILY', 'both')
    if requested not in {'both', 'iphone', 'ipad'}:
        raise CaptureError('Unknown device family')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    inventory = json.loads(common.simctl('list', 'devices', 'available', '--json'))['devices']
    runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2'
    report = {'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'version': '1.0.0', 'build': '2', 'origin': 'https://modernsecure.shpshka.work',
              'captureEngine': 'idb-native-accessibility', 'syntheticCaseOnly': True, 'devices': [], 'errors': []}
    for family, device_name, size in [('iphone', 'iPhone 17 Pro', (1206, 2622)),
                                      ('ipad', 'iPad Pro 13-inch (M5)', (2064, 2752))]:
        if requested != 'both' and requested != family:
            continue
        devices = [device for device in inventory.get(runtime, [])
                   if device['name'] == device_name and device.get('isAvailable')]
        if len(devices) != 1:
            raise CaptureError('Required screenshot simulator unavailable')
        device = devices[0]
        udid = device['udid']
        images = OUTPUT / family
        images.mkdir(exist_ok=True)
        files = []
        phase = 'boot'
        screen = None
        try:
            if device['state'] != 'Booted':
                common.simctl('boot', udid)
            common.simctl('bootstatus', udid, '-b', timeout=600)
            common.simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi',
                          '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
            common.simctl('install', udid, str(ROOT / 'build/simulator/Build/Products/Release-iphonesimulator/ModernSecure.app'))
            common.simctl('launch', '--terminate-running-process', udid, 'kz.modernsecure.modernSecure', timeout=60)
            screen = Screen(udid)
            screen.call('ui', 'rotate', 'PORTRAIT')
            phase = 'login'
            print(f'{family}: filling isolated account through native accessibility; values omitted.', flush=True)
            screen.set_field('Электронная почта', credentials['email'])
            screen.set_field('Пароль', credentials['password'])
            screen.tap('Войти')
            phase = 'verify-synthetic-case'
            screen.wait(lambda node: DEMO_TITLE in label(node))
            time.sleep(2)
            files.append(capture_image(udid, images, family, '01-cases', size))
            screen.tap(DEMO_TITLE)
            screen.wait(lambda node: 'Текущий этап' in label(node))
            time.sleep(2)
            files.append(capture_image(udid, images, family, '02-case-overview', size))
            phase = 'tasks'
            screen.tap('Задачи')
            screen.wait(lambda node: 'Задачи по делу' in label(node))
            time.sleep(2)
            files.append(capture_image(udid, images, family, '03-tasks', size))
            phase = 'documents'
            screen.tap('Документы')
            screen.wait(lambda node: 'Нужно загрузить' in label(node))
            time.sleep(2)
            files.append(capture_image(udid, images, family, '04-documents', size))
            print(f'Captured {len(files)} real native {family} screenshots.', flush=True)
        except (CaptureError, OSError, subprocess.SubprocessError):
            report['errors'].append(family + ': capture failed at ' + phase)
            print(f'{family}: capture stopped at {phase}; private details omitted.', flush=True)
            diagnostic = OUTPUT / 'diagnostics' / family
            diagnostic.mkdir(parents=True, exist_ok=True)
            if screen:
                (diagnostic / 'accessibility-summary.json').write_text(json.dumps({
                    'lastOperation': screen.last_operation,
                    'elements': safe_summary(screen.last_nodes),
                }, ensure_ascii=False, indent=2), encoding='utf-8')
            try:
                common.simctl('io', udid, 'screenshot', str(diagnostic / 'diagnostic-failure.png'), timeout=15)
            except subprocess.SubprocessError:
                pass
        finally:
            report['devices'].append({'family': family, 'device': device_name, 'runtime': runtime,
                                      'captureTestPassed': len(files) == 4, 'files': files})
            (OUTPUT / 'capture-report.json').write_text(json.dumps(report, indent=2) + '\n')
            try:
                common.simctl('shutdown', udid, timeout=45)
            except subprocess.SubprocessError:
                pass
    if report['errors']:
        raise CaptureError('Native capture checks did not all pass')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Native capture failed; credentials and accessibility values omitted.', flush=True)
        raise SystemExit(1) from None
