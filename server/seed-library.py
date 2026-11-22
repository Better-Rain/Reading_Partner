"""Seed a fresh Mac service from a consistent copy of the Windows library."""
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from private_connection import config

host = config()['sshHost']


def remote(command):
    return subprocess.check_output(['ssh', '-o', 'BatchMode=yes', '--', host, command], text=True).strip()


def seed():
    target = remote('cd ~/ReadingPartner/data && pwd')
    remote('test ! -e ~/ReadingPartner/data/reading-partner.sqlite')
    source = Path(os.environ['APPDATA'], 'reading-partner', 'reading-partner.sqlite')
    with tempfile.TemporaryDirectory() as tmp:
        snapshot = Path(tmp, 'reading-partner.sqlite')
        with sqlite3.connect(source.as_uri()+'?mode=ro', uri=True) as old, sqlite3.connect(snapshot) as new:
            old.backup(new)
            for key, original in new.execute('select id,file_path from documents').fetchall():
                path = Path(original)
                destination = f'{target}/books/{key}.pdf'
                if path.is_file():
                    subprocess.run(['scp','-q',str(path),f'{host}:{destination}.part'],check=True)
                    local_hash = hashlib.sha256(path.read_bytes()).hexdigest()
                    remote(f'test "$(shasum -a 256 {destination}.part | cut -d" " -f1)" = {local_hash} && mv {destination}.part {destination}')
                    print('Verified', key, flush=True)
                else:
                    print('Missing PDF; preserved records',key,flush=True)
                new.execute('update documents set file_path=? where id=?',(destination,key))
            assert new.execute('pragma integrity_check').fetchone()==('ok',)
        subprocess.run(['scp','-q',str(snapshot),f'{host}:ReadingPartner/data/seed.sqlite'],check=True)
        remote('cd ~/ReadingPartner && test ! -e data/reading-partner.sqlite && cp data/seed.sqlite backups/initial.sqlite && mv data/seed.sqlite data/reading-partner.sqlite')

if __name__ == '__main__':
    seed()
