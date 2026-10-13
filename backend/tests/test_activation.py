import contextlib
import io
import os
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from xmd.cli import main as cli
from xmd.config import Config
from xmd.licensing import LEASE_SECONDS
from xmd.security import APIError, b64url, json_bytes, load_json, unb64url
from xmd.service import Service


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "state"
        self.service = Service(Config(self.state))
        self.identity, self.code = self.service.store.issue()
        self.install = str(uuid.uuid4())

    def activate(self, installation=None):
        return self.service.licensing.activate({"code": self.code,
                    "installation_id": installation or self.install})

    def test_activation_signature_claims_and_sha256_only_storage(self):
        result = self.activate()
        payload, signature = result["token"].split(".")
        self.service.key.public_key().verify(unb64url(signature), payload.encode("utf-8"))
        self.assertEqual(load_json(unb64url(payload)), result["claims"])
        self.assertEqual(result["claims"]["exp"] - result["claims"]["iat"], LEASE_SECONDS)
        self.assertIsNone(result["claims"]["license_expires_at"])
        self.assertEqual(result["claims"]["product"], "xmd")
        self.assertEqual(result["claims"]["plan"], "pro")
        with self.service.store.transaction() as db:
            row = db.execute("SELECT * FROM licenses WHERE id=?", (self.identity,)).fetchone()
            self.assertEqual(len(row["code_hash"]), 64)
            self.assertNotIn(self.code, str(dict(row)))
        self.assertNotIn(self.code.encode(), (self.state / "xmd.sqlite3").read_bytes())

    def test_same_installation_reactivation_and_renewal(self):
        first = self.activate()
        self.assertEqual(self.activate()["claims"]["license_id"], self.identity)
        with patch("xmd.licensing.time.time", return_value=first["claims"]["iat"] + 100):
            result = self.service.licensing.verify({"token": first["token"], "installation_id": self.install})
        self.assertEqual(result["claims"]["exp"], first["claims"]["exp"] + 100)

    def test_expired_lease_renews_active_permanent_license(self):
        with patch("xmd.licensing.time.time", return_value=int(time.time()) - LEASE_SECONDS - 100):
            expired = self.activate()
        renewed = self.service.licensing.verify({"token": expired["token"], "installation_id": self.install})
        self.assertGreater(renewed["claims"]["exp"], int(time.time()))

    def test_revocation_blocks_activation_and_expired_or_current_renewal(self):
        token = self.activate()["token"]
        self.service.store.revoke(self.identity)
        for operation in (lambda: self.activate(), lambda: self.service.licensing.verify(
                {"token": token, "installation_id": self.install})):
            with self.assertRaises(APIError) as raised:
                operation()
            self.assertEqual(raised.exception.code, "license_revoked")

    def test_concurrent_first_bind_allows_exactly_one_installation(self):
        installs = [str(uuid.uuid4()) for _ in range(12)]
        barrier = threading.Barrier(len(installs))
        def bind(installation):
            barrier.wait(timeout=10)
            try:
                self.activate(installation)
                return installation
            except APIError as exc:
                self.assertEqual(exc.code, "installation_limit")
                return None
        with ThreadPoolExecutor(max_workers=len(installs)) as pool:
            winners = list(filter(None, pool.map(bind, installs)))
        self.assertEqual(len(winners), 1)
        with self.service.store.transaction() as db:
            row = db.execute("SELECT installation_id FROM licenses WHERE id=?", (self.identity,)).fetchone()
        self.assertEqual(row[0], winners[0])

    def test_mismatching_installation_and_invalid_uuid(self):
        token = self.activate()["token"]
        with self.assertRaises(APIError):
            self.activate(str(uuid.uuid4()))
        with self.assertRaises(APIError) as raised:
            self.service.licensing.verify({"token": token, "installation_id": str(uuid.uuid4())})
        self.assertEqual(raised.exception.code, "installation_mismatch")
        for value in (None, {}, "bad", str(uuid.UUID(int=0))):
            with self.assertRaises(APIError):
                self.service.licensing.activate({"code": self.code, "installation_id": value})

    def test_invalid_code_and_tampered_token(self):
        for code in (None, "", "XMD-" + "A" * 43, "' OR 1=1 --", {"code": self.code}):
            with self.assertRaises(APIError):
                self.service.licensing.activate({"code": code, "installation_id": self.install})
        result = self.activate()
        claims = dict(result["claims"], installation_id=str(uuid.uuid4()))
        tampered = b64url(json_bytes(claims)) + "." + result["token"].split(".")[1]
        for token in (tampered, None, "garbage", "a.b.c", "A.A", result["token"] + "="):
            with self.assertRaises(APIError) as raised:
                self.service.licensing.verify({"token": token, "installation_id": self.install})
            self.assertEqual(raised.exception.code, "invalid_token")

    def test_restart_retains_public_key_and_binding(self):
        activated = self.activate()
        restarted = Service(Config(self.state))
        self.assertEqual(restarted.configuration(), self.service.configuration())
        self.assertEqual(restarted.licensing.verify({"token": activated["token"],
                    "installation_id": self.install})["claims"]["license_id"], self.identity)

    def test_missing_existing_database_key_fails_closed(self):
        (self.state / "signing.key").rename(self.state / "saved-signing.key")
        with self.assertRaises(RuntimeError):
            Service(Config(self.state))
        self.assertFalse((self.state / "signing.key").exists())

    def test_default_config_and_partial_provider_configuration_disable_checkout(self):
        with patch.dict(os.environ, {}, clear=True):
            config = Config.from_env()
        self.assertEqual(config.price_cents, 2990)
        self.assertEqual(self.service.configuration()["payment_methods"], [])
        self.assertFalse(self.service.configuration()["purchase_enabled"])
        partial = Config(Path(self.temp.name) / "partial", public_base_url="https://example.invalid/xmd-api/v1",
                         payments_enabled=True, provider_config={"wechat": {"app_id": "", "mch_id": ""}})
        self.assertFalse(Service(partial).configuration()["purchase_enabled"])
        with self.assertRaises(APIError):
            self.service.payments.create({"provider": "wechat", "installation_id": self.install})

    def test_operator_issue_uses_exclusive_delivery_file_and_never_prints_code(self):
        output = Path(self.temp.name) / "operator.license.json"
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(cli(["--state-dir", str(self.state), "issue", "--output", str(output)]), 0)
        issued = load_json(output.read_bytes())
        self.assertNotIn(issued["code"], captured.getvalue())
        activated = self.service.licensing.activate({"code": issued["code"], "installation_id": self.install})
        self.assertEqual(activated["claims"]["license_id"], issued["license_id"])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli(["--state-dir", str(self.state), "issue", "--output", str(output)]), 1)
        with self.service.store.transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM licenses").fetchone()[0], 2)
        if os.name == "posix":
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
