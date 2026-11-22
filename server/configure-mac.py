import os, pathlib, subprocess, hashlib, json, secrets, plistlib, sys
root=pathlib.Path.home()/'ReadingPartner'; data=root/'data'; tls=root/'tls'; os.umask(0o077)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from private_connection import config
import ipaddress, re
settings = config()
binds = [str(ipaddress.IPv4Address(ip)) for ip in (sys.argv[1:] or settings['binds'])]
port = int(settings['port'])
if not binds or not 1 <= port <= 65535:
    raise ValueError('Invalid listener configuration')
android_device = settings.get('androidDevice', 'android')
if not re.fullmatch(r'[a-zA-Z0-9_-]+', android_device) or android_device == 'windows':
    raise ValueError('Invalid Android device label')
if not (tls/'server.pem').exists():
    cfg=tls/'cert.cnf'
    cfg.write_text('[req]\ndistinguished_name=dn\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nsubjectKeyIdentifier=hash\nkeyUsage=critical,keyCertSign,cRLSign\n[server]\nbasicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName='+','.join('IP:'+ip for ip in binds)+'\n')
    def openssl(*args):subprocess.run(['openssl',*args],cwd=tls,check=True,stdout=subprocess.DEVNULL)
    openssl('req','-x509','-new','-newkey','rsa:3072','-nodes','-days','3650','-keyout','ca.key','-out','ca.pem','-subj','/CN=Reading Partner private CA','-config','cert.cnf','-extensions','ca')
    openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=Reading Partner')
    openssl('x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','server.pem','-days','730','-extfile','cert.cnf','-extensions','server')
if not (data/'provider.key').exists():(data/'provider.key').write_bytes(secrets.token_bytes(32))
if not (data/'devices.json').exists():
    hashes={}
    for device in ['windows', android_device]:
        token=secrets.token_hex(32); (data/(device+'.pair')).write_text(token);hashes[device]=hashlib.sha256(token.encode()).hexdigest()
    (data/'devices.json').write_text(json.dumps(hashes))
label='private.readingpartner.server'
service=root/'service'; plist=pathlib.Path.home()/'Library/LaunchAgents'/(label+'.plist'); plist.parent.mkdir(exist_ok=True)
plist.write_bytes(plistlib.dumps(dict(Label=label,ProgramArguments=[str(root/'runtime/node/bin/node'),str(service/'service.mjs')],EnvironmentVariables=dict(RP_ROOT=str(root),RP_DATA=str(data),RP_HEADLESS_SERVICE='1',RP_BINDS=','.join(binds),RP_PORT=str(port)),WorkingDirectory=str(service),RunAtLoad=True,KeepAlive=True,Umask=0o077,StandardOutPath=str(root/'server.log'),StandardErrorPath=str(root/'server-error.log'))))
