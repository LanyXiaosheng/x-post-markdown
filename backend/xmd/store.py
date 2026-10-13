"""One connection per transaction; SQLite serializes binding and revocation."""

import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager

from .security import APIError, check_private, code_hash, private_write


SCHEMA = """
CREATE TABLE IF NOT EXISTS licenses (
 id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
 installation_id TEXT, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 created_at INTEGER NOT NULL, bound_at INTEGER, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, installation_id TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount > 0), currency TEXT NOT NULL,
 app_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('creating','pending','paid','failed')),
 checkout_url TEXT, qr_url TEXT, created_at INTEGER NOT NULL,
 transaction_id TEXT, license_id TEXT REFERENCES licenses(id), delivery BLOB,
 UNIQUE(provider, transaction_id)
);
CREATE TABLE IF NOT EXISTS payment_events (
 provider TEXT NOT NULL, event_id TEXT NOT NULL, order_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY, action TEXT NOT NULL, license_id TEXT NOT NULL, at INTEGER NOT NULL
);
PRAGMA user_version=1;
"""


class Store:
    def __init__(self, state):
        self.path = state / "xmd.sqlite3"
        try:
            private_write(self.path, b"")
        except FileExistsError:
            pass
        check_private(self.path)
        with self.transaction() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError("unsupported database version")
            db.executescript(SCHEMA)
        if os.name == "posix":
            os.chmod(self.path, 0o600)

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(str(self.path), timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def insert_license(self, db, installation=None):
        code = "XMD-" + secrets.token_urlsafe(32)
        identity, now = str(uuid.uuid4()), int(time.time())
        db.execute("INSERT INTO licenses VALUES (?,?,?,0,?,?,NULL)",
                   (identity, code_hash(code), installation, now, now if installation else None))
        db.execute("INSERT INTO audit(action,license_id,at) VALUES ('issue',?,?)", (identity, now))
        return identity, code

    def issue(self):
        with self.transaction() as db:
            return self.insert_license(db)

    def revoke(self, identity):
        with self.transaction() as db:
            changed = db.execute("UPDATE licenses SET revoked=1, revoked_at=? WHERE id=?",
                                 (int(time.time()), identity)).rowcount
            if not changed:
                raise APIError("license_not_found", 404)
            db.execute("INSERT INTO audit(action,license_id,at) VALUES ('revoke',?,?)",
                       (identity, int(time.time())))

    @staticmethod
    def active(row, installation):
        if row is None:
            raise APIError("invalid_code", 403)
        if row["revoked"]:
            raise APIError("license_revoked", 403)
        if row["installation_id"] and row["installation_id"] != installation:
            raise APIError("installation_limit", 409)

    def bind(self, digest, installation, make_token):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM licenses WHERE code_hash=?", (digest,)).fetchone()
            self.active(row, installation)
            db.execute("UPDATE licenses SET installation_id=?, bound_at=COALESCE(bound_at,?) WHERE id=?",
                       (installation, int(time.time()), row["id"]))
            # Sign while the write transaction is held, serializing against revoke.
            return make_token(row["id"], installation)

    def renew(self, identity, installation, make_token):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM licenses WHERE id=?", (identity,)).fetchone()
            self.active(row, installation)
            if row["installation_id"] != installation:
                raise APIError("installation_mismatch", 403)
            return make_token(identity, installation)
