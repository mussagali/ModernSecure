#!/usr/bin/env python3
"""Launch the real Release .app on available iPhone/iPad simulators.

Screenshots demonstrate startup only, not an authenticated case workflow.
"""
import json
import re
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = root / "build/simulator/Build/Products/Release-iphonesimulator/ModernSecure.app"
output = root / "build/smoke-screenshots"
output.mkdir(parents=True, exist_ok=True)


def simctl(*args, capture=False):
    return subprocess.run(["xcrun", "simctl", *args], check=True, text=True, capture_output=capture)


inventory = json.loads(simctl("list", "devices", "available", "--json", capture=True).stdout)["devices"]
runtimes = sorted((key for key in inventory if ".iOS-" in key),
                  key=lambda key: tuple(map(int, re.findall(r"\d+", key))), reverse=True)
report = []
for family, prefix in (("iphone", "iPhone"), ("ipad", "iPad")):
    candidates = [(runtime, device) for runtime in runtimes for device in inventory[runtime]
                  if device.get("isAvailable") and device.get("name", "").startswith(prefix)]
    if not candidates:
        raise SystemExit(f"No available {prefix} simulator runtime installed")
    runtime, device = candidates[0]
    udid = device["udid"]
    try:
        if device["state"] != "Booted":
            simctl("boot", udid)
        simctl("bootstatus", udid, "-b")
        simctl("install", udid, str(app))
        launch = simctl("launch", udid, "kz.modernsecure.modernSecure", capture=True).stdout.strip()
        print(launch, flush=True)
        # Bounded settle for the remote login page; screenshots still need visual review.
        time.sleep(12)
        simctl("io", udid, "screenshot", str(output / f"{family}-startup.png"))
        report.append({"family": family, "device": device["name"], "runtime": runtime, "launch": launch})
    finally:
        subprocess.run(["xcrun", "simctl", "shutdown", udid], check=False)
(output / "startup-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("PASS: app launched on iPhone and iPad simulators; authenticated workflows remain untested")
