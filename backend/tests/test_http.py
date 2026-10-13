import http.client
import tempfile
import threading
import unittest
import uuid
from pathlib import Path

from xmd.config import Config
from xmd.security import json_bytes, load_json
from xmd.server import HTTPServer
from xmd.service import Service


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(Config(Path(self.temp.name) / "state"))
        self.server = HTTPServer(("127.0.0.1", 0), self.service)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        self.thread.start()
        self.install = str(uuid.uuid4())

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            request_headers = {"Content-Type": "application/json"}
            request_headers.update(headers or {})
            body = json_bytes(data) if isinstance(data, dict) else data
            connection.request(method, "/xmd-api/v1" + path, body=body, headers=request_headers)
            response = connection.getresponse()
            raw = response.read()
            value = load_json(raw) if raw and response.getheader("Content-Type", "").startswith("application/json") else raw
            return response.status, dict(response.getheaders()), value
        finally:
            connection.close()

    def test_health_and_exact_configuration(self):
        status, headers, body = self.request("GET", "/health")
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, _, body = self.request("GET", "/config")
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {"product", "price_cents", "purchase_enabled", "public_key", "payment_methods"})
        self.assertEqual(body["product"], "XMD")
        self.assertEqual(body["price_cents"], 2990)
        self.assertFalse(body["purchase_enabled"])
        self.assertEqual(body["payment_methods"], [])
        self.assertEqual(len(body["public_key"]), 43)

    def test_extension_cors_and_preflight(self):
        origin = "chrome-extension://" + "a" * 32
        status, headers, body = self.request("OPTIONS", "/activate", headers={"Origin": origin,
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        self.assertEqual(headers["Access-Control-Allow-Headers"], "Content-Type")
        status, headers, _ = self.request("GET", "/config", headers={"Origin": origin})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        status, headers, _ = self.request("GET", "/config", headers={"Origin": "https://untrusted.invalid"})
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_activation_verification_and_revocation_over_http(self):
        identity, code = self.service.store.issue()
        status, _, body = self.request("POST", "/activate", {"code": code, "installation_id": self.install})
        self.assertEqual(status, 200)
        token = body["token"]
        status, _, verified = self.request("POST", "/verify", {"token": token, "installation_id": self.install})
        self.assertEqual(status, 200)
        self.assertEqual(verified["claims"]["license_id"], identity)
        self.service.store.revoke(identity)
        status, _, body = self.request("POST", "/verify", {"token": token, "installation_id": self.install})
        self.assertEqual((status, body), (403, {"error": "license_revoked"}))

    def test_purchase_and_callbacks_disabled_without_credentials(self):
        for provider in ("wechat", "alipay"):
            status, _, body = self.request("POST", "/orders", {"provider": provider, "installation_id": self.install})
            self.assertEqual((status, body), (503, {"error": "purchase_unavailable"}))
        status, _, _ = self.request("POST", "/webhooks/wechat", b"{}")
        self.assertEqual(status, 503)
        status, _, _ = self.request("POST", "/webhooks/alipay", b"sign_type=RSA2",
                                   headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 503)

    def test_invalid_json_body_size_and_content_type(self):
        for data in (b'{"code":"one","code":"two"}', b"[]", b"{", b'{"exp":NaN}'):
            status, _, _ = self.request("POST", "/activate", data)
            self.assertEqual(status, 400)
        status, _, _ = self.request("POST", "/activate", b"x" * 8193)
        self.assertEqual(status, 413)
        status, _, _ = self.request("POST", "/activate", b"{}", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, _ = self.request("POST", "/activate", b"{}", headers={"Transfer-Encoding": "chunked"})
        self.assertEqual(status, 400)

    def test_no_admin_http_endpoints_and_invalid_order_queries(self):
        for path in ("/admin/issue", "/issue", "/revoke", "/webhooks/mock", "/simulate-paid"):
            status, _, _ = self.request("POST", path, {"installation_id": self.install})
            self.assertIn(status, (404, 503))
        for query in ("", "?installation_id=bad", "?installation_id=a&installation_id=b",
                      "?a=1&b=2&c=3&d=4&e=5"):
            status, _, _ = self.request("GET", "/orders/" + "0" * 32 + query)
            self.assertEqual(status, 400)

    def test_invalid_code_attempts_rate_limited(self):
        data = {"code": "XMD-" + "A" * 43, "installation_id": self.install}
        for _ in range(30):
            status, _, _ = self.request("POST", "/activate", data)
            self.assertEqual(status, 403)
        status, headers, body = self.request("POST", "/activate", data)
        self.assertEqual((status, body), (429, {"error": "rate_limited"}))
        self.assertEqual(headers["Retry-After"], "60")


if __name__ == "__main__":
    unittest.main()
