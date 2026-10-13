"""Mainland WeChat Native v3 and Alipay page-pay public-key adapters.

No sandbox gateways, unsigned fallback, caller-selected API URL, or fake settlement.
"""

import base64
import hashlib
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib import request
from urllib.parse import parse_qsl, urlencode

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .security import APIError, json_bytes, load_json, private_read


MAX_PROVIDER_BODY = 131072


def rsa_key(path, private=False):
    raw = private_read(path)
    key = (serialization.load_pem_private_key(raw, password=None) if private
           else serialization.load_pem_public_key(raw))
    expected = rsa.RSAPrivateKey if private else rsa.RSAPublicKey
    if not isinstance(key, expected) or key.key_size < 2048:
        raise ValueError("payment keys must be RSA >=2048 bits")
    return key


def rsa_sign(key, message):
    return base64.b64encode(key.sign(message, padding.PKCS1v15(), hashes.SHA256())).decode("ascii")


def rsa_verify(key, signature, message):
    key.verify(base64.b64decode(signature, validate=True), message,
               padding.PKCS1v15(), hashes.SHA256())


def required_text(value, limit=128):
    if not isinstance(value, str) or not value or len(value) > limit:
        raise ValueError("missing/invalid payment field")
    return value


def paid_event(provider, order, transaction, event_id, amount, currency, app_id, merchant_id):
    for value in (order, transaction, event_id, app_id, merchant_id):
        required_text(value)
    if type(amount) is not int or amount <= 0 or currency != "CNY":
        raise ValueError("invalid payment amount/currency")
    event = {"provider": provider, "order_id": order, "transaction_id": transaction,
             "event_id": event_id, "amount": amount, "currency": currency,
             "app_id": app_id, "merchant_id": merchant_id}
    fingerprint = {key: value for key, value in event.items() if key != "event_id"}
    event["fingerprint"] = hashlib.sha256(json_bytes(fingerprint)).hexdigest()
    return event


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class WeChat:
    name = "wechat"

    def __init__(self, config, notify_url):
        self.app_id, self.merchant_id = config["app_id"], config["mch_id"]
        self.serial, self.public_id = config["cert_serial"], config["public_key_id"]
        for value in (self.app_id, self.merchant_id, self.serial, self.public_id):
            if not re.fullmatch(r"[A-Za-z0-9_]+", value):
                raise ValueError("invalid WeChat merchant configuration")
        self.private_key = rsa_key(config["private_key_file"], private=True)
        self.public_key = rsa_key(config["public_key_file"])
        self.api_key = private_read(config["api_v3_key_file"])
        if len(self.api_key) != 32:
            raise ValueError("APIv3 key file must contain exactly 32 bytes, no newline")
        self.notify_url = notify_url

    def authorization(self, method, path, body):
        stamp, nonce = str(int(time.time())), secrets.token_hex(16)
        message = (method + "\n" + path + "\n" + stamp + "\n" + nonce + "\n").encode() + body + b"\n"
        signature = rsa_sign(self.private_key, message)
        return ('WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",timestamp="%s",'
                'serial_no="%s",signature="%s"' %
                (self.merchant_id, nonce, stamp, self.serial, signature))

    def verify_envelope(self, headers, body):
        values = {key.lower(): value for key, value in headers.items()}
        if values.get("wechatpay-serial") != self.public_id:
            raise ValueError("unknown WeChat verification key")
        stamp = required_text(values.get("wechatpay-timestamp"))
        nonce = required_text(values.get("wechatpay-nonce"))
        if not stamp.isdigit() or abs(int(time.time()) - int(stamp)) > 300:
            raise ValueError("stale WeChat signature")
        rsa_verify(self.public_key, values.get("wechatpay-signature", ""),
                   (stamp + "\n" + nonce + "\n").encode() + body + b"\n")

    def checkout(self, order):
        path = "/v3/pay/transactions/native"
        payload = {"appid": self.app_id, "mchid": self.merchant_id,
                   "description": "XMD permanent Pro / one browser installation",
                   "out_trade_no": order["id"], "notify_url": self.notify_url,
                   "amount": {"total": order["amount"], "currency": "CNY"}}
        body = json_bytes(payload)
        req = request.Request("https://api.mch.weixin.qq.com" + path, data=body,
                              headers={"Authorization": self.authorization("POST", path, body),
                                       "Content-Type": "application/json", "Accept": "application/json",
                                       "Wechatpay-Serial": self.public_id, "User-Agent": "XMD/1"})
        # urllib uses certificate verification; redirects cannot leak authorization.
        with request.build_opener(NoRedirect()).open(req, timeout=10) as response:
            raw = response.read(MAX_PROVIDER_BODY + 1)
            if len(raw) > MAX_PROVIDER_BODY:
                raise ValueError("oversized WeChat response")
            self.verify_envelope(response.headers, raw)
            data = load_json(raw)
        url = required_text(data.get("code_url"), 2048)
        if not url.startswith("weixin://wxpay/bizpayurl?"):
            raise ValueError("invalid WeChat checkout URI")
        return {"qr_url": url}

    def notification(self, headers, body):
        try:
            self.verify_envelope(headers, body)
            envelope = load_json(body)
            if envelope["event_type"] != "TRANSACTION.SUCCESS":
                raise ValueError("not a successful transaction event")
            resource = envelope["resource"]
            if (resource["algorithm"] != "AEAD_AES_256_GCM"
                    or resource.get("original_type") != "transaction"):
                raise ValueError("unsupported WeChat resource")
            plaintext = AESGCM(self.api_key).decrypt(resource["nonce"].encode(),
                base64.b64decode(resource["ciphertext"], validate=True),
                resource.get("associated_data", "").encode())
            data = load_json(plaintext)
            if data["trade_state"] != "SUCCESS" or data["trade_type"] != "NATIVE":
                raise ValueError("unpaid/wrong product transaction")
            return paid_event(self.name, data["out_trade_no"], data["transaction_id"],
                envelope["id"], data["amount"]["total"], data["amount"]["currency"],
                data["appid"], data["mchid"])
        except (ValueError, KeyError, TypeError, AttributeError, InvalidSignature, InvalidTag):
            raise APIError("invalid_payment_notification", 400) from None


def alipay_content(params, notification=False):
    excluded = {"sign", "sign_type"} if notification else {"sign"}
    # Notify verification includes every received field, even empty ones.
    return "&".join(key + "=" + params[key] for key in sorted(params)
                    if key not in excluded).encode("utf-8")


def amount_cents(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,2})?", value):
        raise ValueError("invalid decimal amount")
    whole, _, decimal = value.partition(".")
    return int(whole) * 100 + int((decimal + "00")[:2])


class Alipay:
    name = "alipay"

    def __init__(self, config, notify_url):
        self.app_id, self.merchant_id = config["app_id"], config["seller_id"]
        if not self.app_id.isdigit() or not self.merchant_id.isdigit():
            raise ValueError("invalid Alipay merchant configuration")
        self.private_key = rsa_key(config["private_key_file"], private=True)
        self.public_key = rsa_key(config["public_key_file"])
        self.notify_url = notify_url

    def checkout(self, order):
        amount = "%d.%02d" % divmod(order["amount"], 100)
        biz = {"out_trade_no": order["id"], "total_amount": amount,
               "subject": "XMD permanent Pro / one browser installation",
               "product_code": "FAST_INSTANT_TRADE_PAY"}
        params = {"app_id": self.app_id, "method": "alipay.trade.page.pay",
                  "charset": "utf-8", "sign_type": "RSA2", "version": "1.0", "format": "JSON",
                  "timestamp": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S"),
                  "notify_url": self.notify_url, "biz_content": json_bytes(biz).decode()}
        params["sign"] = rsa_sign(self.private_key, alipay_content(params))
        return {"checkout_url": "https://openapi.alipay.com/gateway.do?" + urlencode(params)}

    def notification(self, headers, body):
        try:
            pairs = parse_qsl(body.decode("utf-8"), keep_blank_values=True,
                              strict_parsing=True, encoding="utf-8", errors="strict", max_num_fields=128)
            params = dict(pairs)
            if len(pairs) != len(params) or params.get("sign_type") != "RSA2":
                raise ValueError("duplicate parameter or wrong signature algorithm")
            if params.get("charset", "utf-8").lower() != "utf-8":
                raise ValueError("unsupported charset")
            rsa_verify(self.public_key, params.get("sign", ""), alipay_content(params, True))
            if params["trade_status"] not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
                raise ValueError("not a paid transaction")
            return paid_event(self.name, params["out_trade_no"], params["trade_no"],
                params["notify_id"], amount_cents(params["total_amount"]),
                params.get("currency", "CNY"), params["app_id"], params["seller_id"])
        except (ValueError, KeyError, TypeError, UnicodeError, InvalidSignature):
            raise APIError("invalid_payment_notification", 400) from None


def configured_providers(config):
    if not config.payments_enabled or not config.public_base_url or config.price_cents is None:
        return {}
    providers = {}
    for provider_class in (WeChat, Alipay):
        values = config.provider_config.get(provider_class.name, {})
        if values and all(values.values()):
            notify = config.public_base_url + "/webhooks/" + provider_class.name
            providers[provider_class.name] = provider_class(values, notify)
    return providers
