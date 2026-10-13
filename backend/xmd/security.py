"""Strict encodings and runtime-only key storage."""

import base64
import hashlib
import json
import os
import re
import stat
import uuid
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class APIError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64url(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("invalid base64url")
    data = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if b64url(data) != value:
        raise ValueError("noncanonical base64url")
    return data


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
                      allow_nan=False).encode("utf-8")


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def load_json(data):
    def invalid_constant(value):
        raise ValueError("nonfinite JSON number")
    return json.loads(data, object_pairs_hook=_unique_pairs, parse_constant=invalid_constant)


def installation_id(value):
    if not isinstance(value, str) or len(value) != 36:
        raise APIError("invalid_installation_id")
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise APIError("invalid_installation_id") from None
    if parsed.int == 0 or str(parsed) != value.lower():
        raise APIError("invalid_installation_id")
    return str(parsed)


def code_hash(code):
    if not isinstance(code, str) or not re.fullmatch(r"XMD-[A-Za-z0-9_-]{43}", code):
        raise APIError("invalid_code", 403)
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def check_private(path, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or path.is_symlink():
        raise RuntimeError("state/key path must be a regular file or directory")
    if os.name == "posix":
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeError("state/key owner or permissions are unsafe")


def private_write(path, data):
    """Never overwrite an operator's output or follow a symlink."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(str(path), flags, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def private_read(path):
    path = Path(path)
    check_private(path)
    return path.read_bytes()


def runtime_directory(path):
    path = Path(path).absolute()
    source = Path(__file__).resolve().parents[2]
    if source == path.resolve() or source in path.resolve().parents:
        raise RuntimeError("runtime state must be outside the repository")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    check_private(path, directory=True)
    return path


def load_keys(state):
    """Generate only at runtime. Existing databases must retain their original keys."""
    signing_path, delivery_path = state / "signing.key", state / "delivery.key"
    for path in (signing_path, delivery_path):
        if not path.exists():
            if (state / "xmd.sqlite3").exists():
                raise RuntimeError("missing key for existing database; restore backup")
            try:
                private_write(path, os.urandom(32))
            except FileExistsError:
                pass
    signing_raw, delivery_raw = private_read(signing_path), private_read(delivery_path)
    if len(signing_raw) != 32 or len(delivery_raw) != 32:
        raise RuntimeError("runtime key must be exactly 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(signing_raw), delivery_raw


def public_key(signing_key):
    return b64url(signing_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw))
