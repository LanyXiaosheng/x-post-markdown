"""Exercise production activation with a temporary entitlement; revoke it before exit."""
import base64
import getpass
import hashlib
import json
import socket
import argparse
import os
from pathlib import Path
import paramiko

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--issue-file", type=Path)
parser.add_argument("--revoke-file", type=Path)
args = parser.parse_args()
host = "111.170.35.112"
password = getpass.getpass("SSH password: ")
transport = paramiko.Transport(socket.create_connection((host, 22), timeout=12))
transport.start_client(timeout=12)
fingerprint = base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip("=")
known = json.loads((root.parent / ".xmd-tooling/known-hosts.json").read_text())
if known.get(host + ":22") != fingerprint:
    raise RuntimeError("SSH fingerprint mismatch")
transport.auth_password("root", password)
del password
test_source = """
import base64, json, uuid, urllib.request, urllib.error
from xmd.config import Config
from xmd.service import Service

base = 'https://lanyxiaosheng.cloud/xmd-api/v1'
service = Service(Config.from_env())
license_id, code = service.store.issue()
installation = str(uuid.uuid4())
def request(route, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base+route, data=data,
        headers={'Content-Type':'application/json'} if data else {})
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read())
try:
    config = request('/config')
    assert config['price_cents'] == 2990 and config['purchase_enabled'] is False
    activated = request('/activate', {'code':code, 'installation_id':installation})
    assert activated['claims']['plan'] == 'pro'
    renewed = request('/verify', {'token':activated['token'], 'installation_id':installation})
    assert renewed['claims']['license_id'] == license_id
    service.store.revoke(license_id)
    try:
        request('/verify', {'token':renewed['token'], 'installation_id':installation})
        raise AssertionError('revoked license accepted')
    except urllib.error.HTTPError as error:
        assert error.code == 403
    print(json.dumps({'https':'valid','activation':'passed','verify':'passed','revocation':'passed','payment_enabled':False}))
finally:
    service.store.revoke(license_id)
"""
if args.issue_file:
    test_source = """
import json
from xmd.config import Config
from xmd.service import Service
service=Service(Config.from_env())
identity,code=service.store.issue()
print(json.dumps({'license_id':identity,'code':code}))
"""
elif args.revoke_file:
    identity = json.loads(args.revoke_file.read_text())["license_id"]
    test_source = """
from xmd.config import Config
from xmd.service import Service
Service(Config.from_env()).store.revoke(%s)
print('Temporary test entitlement revoked.')
""" % repr(identity)
try:
    channel = transport.open_session(timeout=12)
    channel.settimeout(90)
    channel.exec_command("cd /opt/xmd-license/backend && runuser -u xmd -- env XMD_STATE_DIR=/var/lib/xmd "
                         "/opt/xmd-license/venv/bin/python -")
    channel.sendall(test_source.encode())
    channel.shutdown_write()
    output = channel.makefile("rb").read().decode()
    error = channel.makefile_stderr("rb").read().decode()
    status = channel.recv_exit_status()
    if args.issue_file:
        data = json.loads(output)
        fd = os.open(str(args.issue_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w") as target:
            json.dump(data, target)
        print("Entitlement saved to supplied private file; code omitted from logs.")
    else:
        print(output)
    if status:
        raise RuntimeError(error)
finally:
    transport.close()
