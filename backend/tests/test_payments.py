import base64
import tempfile
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from xmd.config import Config
from xmd.providers import alipay_content, rsa_sign, rsa_verify
from xmd.security import APIError, json_bytes, private_write
from xmd.service import Service


class PaymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Synthetic keys live only in OS temp directories; no payment network calls.
        cls.keys_temp = tempfile.TemporaryDirectory()
        cls.merchant = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.provider = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        root = Path(cls.keys_temp.name)
        cls.private_path, cls.public_path, cls.api_path = root / "merchant.key", root / "provider.pem", root / "api.key"
        private_write(cls.private_path, cls.merchant.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        private_write(cls.public_path, cls.provider.public_key().public_bytes(serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo))
        cls.api_key = AESGCM.generate_key(bit_length=256)
        private_write(cls.api_path, cls.api_key)

    @classmethod
    def tearDownClass(cls):
        cls.keys_temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        providers = {
            "wechat": {"app_id": "wxTestApp", "mch_id": "1900000000", "cert_serial": "ABC123",
                       "private_key_file": str(self.private_path), "public_key_id": "PUB_KEY_ID_1000",
                       "public_key_file": str(self.public_path), "api_v3_key_file": str(self.api_path)},
            "alipay": {"app_id": "2026000000", "seller_id": "2088000000",
                       "private_key_file": str(self.private_path), "public_key_file": str(self.public_path)}}
        self.service = Service(Config(Path(self.temp.name) / "state", 2990,
            "https://example.invalid/xmd-api/v1", True, provider_config=providers))
        self.payments = self.service.payments
        self.install = str(uuid.uuid4())
        self.order = self.payments.create({"provider": "alipay", "installation_id": self.install})["order_id"]

    def counts(self):
        with self.service.store.transaction() as db:
            return (db.execute("SELECT COUNT(*) FROM licenses").fetchone()[0],
                    db.execute("SELECT COUNT(*) FROM payment_events").fetchone()[0])

    def alipay_notification(self, **overrides):
        params = {"app_id": "2026000000", "seller_id": "2088000000", "out_trade_no": self.order,
                  "trade_no": "trade-123", "notify_id": "notice-123", "trade_status": "TRADE_SUCCESS",
                  "total_amount": "29.90", "sign_type": "RSA2", "charset": "utf-8",
                  "subject": "XMD + permanent Pro 中文", "extra": ""}
        params.update(overrides)
        params["sign"] = rsa_sign(self.provider, alipay_content(params, notification=True))
        return urlencode(params).encode()

    def envelope(self, body, stamp=None, serial="PUB_KEY_ID_1000"):
        stamp, nonce = str(stamp or int(time.time())), "test-envelope-nonce"
        return {"Wechatpay-Serial": serial, "Wechatpay-Timestamp": stamp, "Wechatpay-Nonce": nonce,
                "Wechatpay-Signature": rsa_sign(self.provider, (stamp + "\n" + nonce + "\n").encode()
                                               + body + b"\n")}

    def wechat_order(self):
        body = json_bytes({"code_url": "weixin://wxpay/bizpayurl?pr=test-checkout"})
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = body
        response.headers = self.envelope(body)
        with patch("xmd.providers.request.build_opener") as opener:
            opener.return_value.open.return_value = response
            result = self.payments.create({"provider": "wechat", "installation_id": self.install})
            self.assertTrue(result["qr_url"].startswith("weixin://wxpay/bizpayurl?"))
            req = opener.return_value.open.call_args.args[0]
        return result["order_id"], req

    def wechat_notification(self, order, **overrides):
        data = {"out_trade_no": order, "transaction_id": "wx-trade-123", "trade_state": "SUCCESS",
                "trade_type": "NATIVE", "appid": "wxTestApp", "mchid": "1900000000",
                "amount": {"total": 2990, "currency": "CNY"}}
        data.update(overrides)
        nonce, aad = b"resource1234", b"transaction"
        ciphertext = AESGCM(self.api_key).encrypt(nonce, json_bytes(data), aad)
        body = json_bytes({"id": "wx-notice-123", "event_type": "TRANSACTION.SUCCESS",
            "resource": {"algorithm": "AEAD_AES_256_GCM", "original_type": "transaction",
                         "nonce": nonce.decode(), "associated_data": aad.decode(),
                         "ciphertext": base64.b64encode(ciphertext).decode()}})
        return self.envelope(body), body

    def test_alipay_checkout_signed_correct_amount_and_fixed_gateway(self):
        checkout = self.payments.create({"provider": "alipay", "installation_id": self.install})
        parsed = urlsplit(checkout["checkout_url"])
        self.assertEqual(parsed.netloc, "openapi.alipay.com")
        params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        self.assertEqual(params["method"], "alipay.trade.page.pay")
        self.assertIn('"total_amount":"29.90"', params["biz_content"])
        rsa_verify(self.merchant.public_key(), params["sign"], alipay_content(params))

    def test_wechat_authorization_and_response_signature(self):
        order, req = self.wechat_order()
        import re
        fields = dict(re.findall(r'(\w+)="([^"]+)"', req.headers["Authorization"]))
        message = ("POST\n/v3/pay/transactions/native\n" + fields["timestamp"] + "\n"
                   + fields["nonce_str"] + "\n").encode() + req.data + b"\n"
        rsa_verify(self.merchant.public_key(), fields["signature"], message)
        self.assertIn(order.encode(), req.data)
        self.assertIn(b'"total":2990', req.data)

    def test_alipay_paid_delivery_idempotence_and_binding(self):
        body = self.alipay_notification()
        for _ in range(3):
            self.payments.notification("alipay", {}, body)
        result = self.payments.status(self.order, self.install)
        self.assertEqual(result["status"], "paid")
        self.assertEqual(self.counts(), (1, 1))
        activated = self.service.licensing.activate({"code": result["code"], "installation_id": self.install})
        self.assertEqual(activated["claims"]["license_id"], result["license_id"])
        with self.assertRaises(APIError):
            self.service.licensing.activate({"code": result["code"], "installation_id": str(uuid.uuid4())})
        with self.service.store.transaction() as db:
            row = db.execute("SELECT delivery FROM orders WHERE id=?", (self.order,)).fetchone()
        self.assertNotIn(result["code"].encode(), row[0])
        self.service.store.revoke(result["license_id"])
        self.assertEqual(self.payments.status(self.order, self.install), {"order_id": self.order, "status": "revoked"})
        self.payments.notification("alipay", {}, body)
        self.assertEqual(self.counts(), (1, 1))

    def test_concurrent_payment_duplicates_issue_one_license(self):
        body = self.alipay_notification()
        with ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(lambda _: self.payments.notification("alipay", {}, body), range(20)))
        self.assertEqual(self.counts(), (1, 1))

    def test_alipay_invalid_signature_duplicate_params_and_unpaid_fail_closed(self):
        original = self.alipay_notification()
        bad = (original.replace(b"29.90", b"99.90"), original + b"&total_amount=29.90",
               self.alipay_notification(sign_type="RSA"), self.alipay_notification(trade_status="WAIT_BUYER_PAY"),
               b"trade_status=TRADE_SUCCESS")
        for body in bad:
            with self.assertRaises(APIError):
                self.payments.notification("alipay", {}, body)
        self.assertEqual(self.counts(), (0, 0))

    def test_signed_amount_currency_app_merchant_mismatches_rejected(self):
        mismatches = ({"total_amount": "29.91"}, {"total_amount": "29.901"},
                      {"currency": "USD"}, {"app_id": "00000"}, {"seller_id": "00000"})
        for fields in mismatches:
            with self.assertRaises(APIError):
                self.payments.notification("alipay", {}, self.alipay_notification(**fields))
        self.assertEqual(self.counts(), (0, 0))

    def test_event_replay_conflict_and_transaction_reuse_roll_back(self):
        self.payments.notification("alipay", {}, self.alipay_notification())
        with self.assertRaises(APIError) as raised:
            self.payments.notification("alipay", {}, self.alipay_notification(trade_no="different-trade"))
        self.assertEqual(raised.exception.code, "payment_replay_conflict")
        other = self.payments.create({"provider": "alipay", "installation_id": self.install})["order_id"]
        with self.assertRaises(APIError) as raised:
            self.payments.notification("alipay", {}, self.alipay_notification(
                out_trade_no=other, notify_id="different-notice"))
        self.assertEqual(raised.exception.code, "payment_transaction_conflict")
        self.assertEqual(self.counts(), (1, 1))
        self.assertEqual(self.payments.status(other, self.install)["status"], "pending")

    def test_order_delivery_requires_matching_installation(self):
        self.payments.notification("alipay", {}, self.alipay_notification())
        with self.assertRaises(APIError) as raised:
            self.payments.status(self.order, str(uuid.uuid4()))
        self.assertEqual(raised.exception.status, 404)

    def test_wechat_valid_envelope_decryption_and_paid_issuance(self):
        order, _ = self.wechat_order()
        headers, body = self.wechat_notification(order)
        self.payments.notification("wechat", headers, body)
        self.payments.notification("wechat", headers, body)
        self.assertEqual(self.payments.status(order, self.install)["status"], "paid")
        self.assertEqual(self.counts(), (1, 1))

    def test_wechat_invalid_signature_stale_unknown_key_and_invalid_gcm(self):
        order, _ = self.wechat_order()
        headers, body = self.wechat_notification(order)
        invalid_gcm = json_bytes({"id": "notice", "event_type": "TRANSACTION.SUCCESS", "resource": {
            "algorithm": "AEAD_AES_256_GCM", "original_type": "transaction", "nonce": "resource1234",
            "associated_data": "transaction", "ciphertext": base64.b64encode(b"bad" * 10).decode()}})
        bad = (({}, body), (dict(headers, **{"Wechatpay-Signature": "invalid"}), body),
               (self.envelope(body, stamp=int(time.time()) - 301), body),
               (self.envelope(body, serial="PUB_KEY_ID_UNKNOWN"), body),
               (self.envelope(invalid_gcm), invalid_gcm))
        for envelope, raw in bad:
            with self.assertRaises(APIError):
                self.payments.notification("wechat", envelope, raw)
        self.assertEqual(self.counts(), (0, 0))

    def test_wechat_signed_order_mismatches_fail_closed(self):
        order, _ = self.wechat_order()
        for fields in ({"amount": {"total": 1, "currency": "CNY"}},
                       {"amount": {"total": True, "currency": "CNY"}},
                       {"amount": {"total": 2990, "currency": "USD"}},
                       {"appid": "other"}, {"mchid": "other"}, {"trade_state": "NOTPAY"}):
            headers, body = self.wechat_notification(order, **fields)
            with self.assertRaises(APIError):
                self.payments.notification("wechat", headers, body)
        self.assertEqual(self.counts(), (0, 0))

    def test_unsigned_wechat_response_rejected_and_order_not_paid(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers = {}
        response.read.return_value = json_bytes({"code_url": "weixin://wxpay/bizpayurl?pr=bad"})
        with patch("xmd.providers.request.build_opener") as opener:
            opener.return_value.open.return_value = response
            with self.assertRaises(APIError):
                self.payments.create({"provider": "wechat", "installation_id": self.install})
        self.assertEqual(self.counts(), (0, 0))


if __name__ == "__main__":
    unittest.main()
