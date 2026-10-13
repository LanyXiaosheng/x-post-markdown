"""Read-only SSH inventory. Credentials are prompted and never stored."""
import argparse
import base64
import getpass
import hashlib
import json
import socket
from pathlib import Path

import paramiko

parser = argparse.ArgumentParser()
parser.add_argument("--host", required=True)
parser.add_argument("--port", type=int, default=22)
parser.add_argument("--user", default="root")
parser.add_argument("--known-hosts", required=True)
parser.add_argument("--command", help="Explicit read-only diagnostic command")
args = parser.parse_args()
password = getpass.getpass("SSH password: ")
sock = socket.create_connection((args.host, args.port), timeout=12)
transport = paramiko.Transport(sock)
transport.start_client(timeout=12)
key = transport.get_remote_server_key()
fingerprint = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
known_file = Path(args.known_hosts)
known = json.loads(known_file.read_text()) if known_file.exists() else {}
identity = args.host + ":" + str(args.port)
if identity in known and known[identity] != fingerprint:
    raise RuntimeError("SSH host key changed")
known[identity] = fingerprint
known_file.parent.mkdir(parents=True, exist_ok=True)
known_file.write_text(json.dumps(known))
print("SSH fingerprint SHA256:" + fingerprint)
transport.auth_password(args.user, password)
del password
commands = [
    "uname -srm; command -v python3; python3 --version; command -v node; node --version",
    "ss -lntp | head -30",
    "ls /www/server/panel/vhost/nginx/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null",
    "for f in /www/server/panel/vhost/nginx/*.conf; do "
    "test -f \"$f\" && echo \"$f\" && grep -E '^[[:space:]]*(listen|server_name|ssl_certificate|root|include)' \"$f\"; done",
    "systemctl is-active nginx; command -v nginx; ls /www/server/nginx/sbin/nginx 2>/dev/null",
    "ls /www/server/ 2>/dev/null; ls /opt/ 2>/dev/null; "
    "find /www/wwwroot /opt /www/server -maxdepth 4 -type f -name python3 -o -name python3.11 -o -name python3.10 2>/dev/null | head -20",
    "sed -n '1,260p' /www/server/panel/vhost/nginx/lanyxiaosheng-domains.conf",
    "curl -sI --max-time 8 https://api.lanyxiaosheng.com; "
    "curl -sI --max-time 8 https://lanyxiaosheng.cloud; "
    "openssl x509 -in /www/server/panel/vhost/cert/lanyxiaosheng.cloud/fullchain.pem -noout -dates -ext subjectAltName",
]
if args.command:
    commands = [args.command]
try:
    for command in commands:
        channel = transport.open_session(timeout=12)
        channel.exec_command(command)
        channel.settimeout(20)
        print(channel.makefile("r").read().decode("utf-8", errors="replace"))
        error = channel.makefile_stderr("r").read().decode("utf-8", errors="replace")
        if error:
            print(error)
        channel.close()
finally:
    transport.close()
