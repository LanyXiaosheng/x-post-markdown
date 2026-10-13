"""Checkout orders and exactly-once entitlement issuance after provider verification."""

import hmac
import secrets
import sqlite3
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .providers import configured_providers
from .security import APIError, installation_id


class Payments:
    def __init__(self, store, config, delivery_key):
        self.store, self.config = store, config
        self.cipher = AESGCM(delivery_key)
        self.providers = configured_providers(config)

    def create(self, data):
        install = installation_id(data.get("installation_id"))
        name = data.get("provider")
        if not isinstance(name, str) or name not in self.providers:
            raise APIError("purchase_unavailable", 503)
        provider = self.providers[name]
        order = {"id": secrets.token_hex(16), "provider": name, "installation_id": install,
                 "amount": self.config.price_cents, "currency": "CNY",
                 "app_id": provider.app_id, "merchant_id": provider.merchant_id}
        with self.store.transaction() as db:
            pending = db.execute("SELECT COUNT(*) FROM orders WHERE installation_id=? "
                "AND status IN ('creating','pending') AND created_at>?",
                (install, int(time.time()) - 3600)).fetchone()[0]
            if pending >= 5:
                raise APIError("too_many_pending_orders", 429)
            db.execute("INSERT INTO orders(id,provider,installation_id,amount,currency,app_id,"
                       "merchant_id,status,created_at) VALUES (?,?,?,?,?,?,?,'creating',?)",
                       tuple(order.values()) + (int(time.time()),))
        try:
            checkout = provider.checkout(order)
        except Exception:
            with self.store.transaction() as db:
                db.execute("UPDATE orders SET status='failed' WHERE id=? AND status='creating'",
                           (order["id"],))
            raise APIError("payment_provider_unavailable", 502) from None
        with self.store.transaction() as db:
            db.execute("UPDATE orders SET checkout_url=?,qr_url=?,"
                       "status=CASE WHEN status='paid' THEN 'paid' ELSE 'pending' END WHERE id=?",
                       (checkout.get("checkout_url"), checkout.get("qr_url"), order["id"]))
        return {"order_id": order["id"], **checkout}

    @staticmethod
    def _aad(order):
        return (order["id"] + ":" + order["installation_id"]).encode("ascii")

    def notification(self, provider, headers, body):
        if provider not in self.providers:
            raise APIError("purchase_unavailable", 503)
        verified = self.providers[provider].notification(headers, body)
        self._settle_verified(verified)

    def _settle_verified(self, event):
        try:
            with self.store.transaction() as db:
                order = db.execute("SELECT * FROM orders WHERE id=?", (event["order_id"],)).fetchone()
                if order is None:
                    raise APIError("unknown_payment_order", 400)
                fields = ("provider", "amount", "currency", "app_id", "merchant_id")
                if any(order[key] != event[key] for key in fields):
                    raise APIError("payment_order_mismatch", 400)
                previous = db.execute("SELECT * FROM payment_events WHERE provider=? AND event_id=?",
                                      (event["provider"], event["event_id"])).fetchone()
                if previous:
                    if previous["fingerprint"] != event["fingerprint"]:
                        raise APIError("payment_replay_conflict", 409)
                    return
                if order["status"] == "paid":
                    if order["transaction_id"] != event["transaction_id"]:
                        raise APIError("payment_transaction_conflict", 409)
                else:
                    identity, code = self.store.insert_license(db, order["installation_id"])
                    nonce = secrets.token_bytes(12)
                    delivery = nonce + self.cipher.encrypt(nonce, code.encode(), self._aad(order))
                    db.execute("UPDATE orders SET status='paid',transaction_id=?,license_id=?,delivery=? WHERE id=?",
                               (event["transaction_id"], identity, delivery, order["id"]))
                db.execute("INSERT INTO payment_events VALUES (?,?,?,?,?)",
                           (event["provider"], event["event_id"], order["id"],
                            event["fingerprint"], int(time.time())))
        except sqlite3.IntegrityError:
            raise APIError("payment_transaction_conflict", 409) from None

    def status(self, identity, installation):
        install = installation_id(installation)
        if not isinstance(identity, str) or len(identity) != 32:
            raise APIError("order_not_found", 404)
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM orders WHERE id=?", (identity,)).fetchone()
            if row is None or not hmac.compare_digest(row["installation_id"], install):
                raise APIError("order_not_found", 404)
            result = {"order_id": identity, "status": row["status"]}
            if row["status"] == "paid":
                license_row = db.execute("SELECT revoked FROM licenses WHERE id=?", (row["license_id"],)).fetchone()
                if license_row is None or license_row["revoked"]:
                    result["status"] = "revoked"
                    return result
                blob = row["delivery"]
                result["code"] = self.cipher.decrypt(blob[:12], blob[12:], self._aad(row)).decode()
                result["license_id"] = row["license_id"]
            return result
