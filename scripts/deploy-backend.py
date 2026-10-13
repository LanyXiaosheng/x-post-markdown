"""Deploy only the XMD service and its dedicated nginx location, with a rollback copy."""
import base64
import getpass
import hashlib
import json
import shlex
import socket
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = "111.170.35.112"
BASE = "/opt/xmd-license"
NGINX = "/www/server/panel/vhost/nginx/lanyxiaosheng-domains.conf"
PYTHON = "/opt/lany-python/3.12/bin/python3"
stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
release = BASE + "/releases/" + stamp
password = getpass.getpass("SSH password: ")
transport = paramiko.Transport(socket.create_connection((HOST, 22), timeout=12))
transport.start_client(timeout=12)
key = transport.get_remote_server_key()
fingerprint = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
known_file = ROOT.parent / ".xmd-tooling" / "known-hosts.json"
known = json.loads(known_file.read_text())
if known.get(HOST + ":22") != fingerprint:
    raise RuntimeError("SSH fingerprint does not match inspected host")
transport.auth_password("root", password)
del password
sftp = paramiko.SFTPClient.from_transport(transport)


def run(command):
    channel = transport.open_session(timeout=12)
    channel.settimeout(180)
    channel.exec_command(command)
    out = channel.makefile("rb").read().decode("utf-8", "replace")
    err = channel.makefile_stderr("rb").read().decode("utf-8", "replace")
    status = channel.recv_exit_status()
    channel.close()
    if status:
        raise RuntimeError("Remote step failed: " + command + "\n" + out + err)
    return out.strip()


def write(remote, data, mode=0o644):
    with sftp.open(remote, "wb") as output:
        output.write(data)
    sftp.chmod(remote, mode)


try:
    print("Preparing dedicated XMD release", flush=True)
    run("test -x " + PYTHON + "; test ! -e " + release + "; mkdir -p " + release + "/backend")
    for local in (ROOT / "backend").rglob("*"):
        if not local.is_file() or "__pycache__" in local.parts or local.name.startswith("."):
            continue
        relative = local.relative_to(ROOT / "backend").as_posix()
        if relative.startswith("tests/"):
            continue
        remote = release + "/backend/" + relative
        run("mkdir -p " + shlex.quote(str(Path(remote).parent).replace("\\", "/")))
        sftp.put(str(local), remote)
        sftp.chmod(remote, 0o644)
    print("Installing isolated runtime dependencies", flush=True)
    run("test -x " + BASE + "/venv/bin/python || " + PYTHON + " -m venv " + BASE + "/venv")
    print(run(BASE + "/venv/bin/python -m pip install --index-url https://mirrors.aliyun.com/pypi/simple/ "
              "-r " + release + "/backend/requirements.txt"), flush=True)
    run("id -u xmd >/dev/null 2>&1 || useradd --system --home-dir /var/lib/xmd --shell /sbin/nologin xmd")
    run("install -d -o xmd -g xmd -m 700 /var/lib/xmd; install -d -o root -g xmd -m 750 /etc/xmd")
    env = (ROOT / "backend/deploy/xmd.env.example").read_bytes()
    try:
        sftp.stat("/etc/xmd/xmd.env")
    except FileNotFoundError:
        write("/etc/xmd/xmd.env", env, 0o640)
        run("chown root:xmd /etc/xmd/xmd.env")
    run("ln -sfn " + release + "/backend " + BASE + "/backend")
    unit_path = "/etc/systemd/system/xmd-license.service"
    try:
        previous_unit = sftp.open(unit_path, "rb").read()
        write(unit_path + ".bak-" + stamp, previous_unit)
    except FileNotFoundError:
        pass
    write(unit_path, (ROOT / "backend/deploy/xmd-license.service").read_bytes())
    run("systemctl daemon-reload; systemctl enable xmd-license; systemctl restart xmd-license")
    print("Waiting for health check", flush=True)
    health_command = "curl -fsS --retry 8 --retry-connrefused --retry-delay 1 http://127.0.0.1:8219/xmd-api/v1/health"
    print(run(health_command), flush=True)

    original = sftp.open(NGINX, "rb").read()
    text = original.decode()
    target = "    server_name lanyxiaosheng.cloud www.lanyxiaosheng.cloud;"
    if text.count(target) != 1:
        raise RuntimeError("Expected one HTTPS cloud server block")
    if "location ^~ /xmd-api/" not in text:
        insertion = (ROOT / "backend/deploy/nginx-location.conf").read_text()
        patched = text.replace(target, target + "\n\n" +
            "\n".join("    " + line if line else "" for line in insertion.splitlines()) + "\n", 1)
        write(NGINX + ".bak-xmd-" + stamp, original)
        write(NGINX, patched.encode())
        try:
            print(run("/www/server/nginx/sbin/nginx -t"), flush=True)
        except Exception:
            write(NGINX, original)
            raise
        run("/www/server/nginx/sbin/nginx -s reload")

    result = json.loads(run("curl -fsS --max-time 12 https://lanyxiaosheng.cloud/xmd-api/v1/config"))
    if result["price_cents"] != 2990 or result["purchase_enabled"]:
        raise RuntimeError("Unexpected public purchase configuration")
    print("Public HTTPS configuration: " + json.dumps(result), flush=True)
    print("Release: " + release, flush=True)
finally:
    sftp.close()
    transport.close()
