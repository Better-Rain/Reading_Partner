"""Create per-client build inputs from the local deployment configuration."""
import argparse
import ipaddress
import json
import os
import re
from pathlib import Path


def config():
    source = Path(os.environ.get('RP_CONNECTION_FILE') or Path(__file__).resolve().parents[1] / 'private-deploy/connection.json')
    if not source.is_file():
        raise SystemExit('Set RP_CONNECTION_FILE or create private-deploy/connection.json (see docs/PRIVATE_LIBRARY.md).')
    return json.loads(source.read_text(encoding='utf-8-sig'))


def render(platform, settings):
    port = settings['port']
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('Invalid HTTPS port')
    if platform == 'windows':
        ssh = settings['sshHost']
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', ssh):
            raise ValueError('Invalid SSH host alias')
        return json.dumps(dict(address=str(ipaddress.IPv4Address(settings['windowsHost'])), port=port, sshHost=ssh))
    hosts = [str(ipaddress.IPv4Address(host)) for host in settings[platform + 'Hosts']]
    if not hosts:
        raise ValueError('At least one server address is required')
    if platform == 'apple':
        return json.dumps(dict(hosts=hosts, port=port))
    addresses = ', '.join(json.dumps(host) for host in hosts)
    return ('package privatebooks.readingpartner;\nfinal class LibraryConnection {\n'
            f'    static final int PORT = {port};\n    static final String[] HOSTS = {{ {addresses} }};\n}}\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=['windows', 'android', 'apple'])
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = render(args.platform, config())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf-8')