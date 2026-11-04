#!/usr/bin/env python3
"""Reject failed or ambiguous altool output even when its process exits zero."""
import re
import sys
from pathlib import Path


def check_result(operation, output):
    if re.search(r"ERROR:|\b(?:VERIFY|VALIDATION|UPLOAD) FAILED\b|Validation failed|Failed to (?:validate|upload) package", output, re.I):
        return "Apple rejected the package; inspect altool output"
    markers = {
        "validate": r"No errors validating|\b(?:VERIFY|VALIDATION) SUCCEEDED\b",
        "upload": r"No errors uploading|\bUPLOAD SUCCEEDED\b",
    }
    if not re.search(markers[operation], output, re.I):
        return "Apple success confirmation missing; do not assume upload or validation succeeded"
    return None


if __name__ == "__main__":
    error = check_result(sys.argv[1], Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace"))
    if error:
        raise SystemExit(error)
    print("PASS: Apple confirmed " + sys.argv[1])
