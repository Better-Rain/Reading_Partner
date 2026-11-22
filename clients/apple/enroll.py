#!/usr/bin/env python3
"""Register independent device codes on the library host; print only their paths."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile
import sys

root = Path.home() / 'ReadingPartner' / 'data'
os.umask(0o077)
with (root / '.apple-enroll.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    devices = root / 'devices.json'
    entries = json.loads(devices.read_text())
    labels = ['apple-mac', 'apple-iphone']
    if '--simulator' in sys.argv:
        labels.append('apple-simulator')
    for label in labels:
        file = root / (label + '.pair')
        if not file.exists():
            if label in entries:
                raise SystemExit(f'{label} already registered without a local code')
            with file.open('x') as output:
                output.write(secrets.token_hex(32))
        token = file.read_text().strip()
        if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            raise SystemExit(f'Invalid existing code for {label}')
        digest = hashlib.sha256(token.encode()).hexdigest()
        if entries.get(label, digest) != digest:
            raise SystemExit(f'Conflicting registration for {label}')
        entries[label] = digest
        print(file)
    with tempfile.NamedTemporaryFile('w', dir=root, delete=False) as output:
        json.dump(entries, output)
    os.replace(output.name, devices)
