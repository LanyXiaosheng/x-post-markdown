"""Permanent entitlement with renewable seven-day Ed25519 leases."""

import time

from cryptography.exceptions import InvalidSignature

from .security import APIError, b64url, code_hash, installation_id, json_bytes, load_json, unb64url


LEASE_SECONDS = 7 * 24 * 60 * 60


class Licensing:
    def __init__(self, store, signing_key):
        self.store, self.key = store, signing_key

    def token(self, identity, installation):
        now = int(time.time())
        claims = {"product": "xmd", "plan": "pro", "installation_id": installation,
                  "exp": now + LEASE_SECONDS, "iat": now, "license_expires_at": None,
                  "license_id": identity}
        payload = b64url(json_bytes(claims))
        signature = b64url(self.key.sign(payload.encode("ascii")))
        return {"token": payload + "." + signature, "claims": claims}

    def activate(self, data):
        install = installation_id(data.get("installation_id"))
        return self.store.bind(code_hash(data.get("code")), install, self.token)

    def verify(self, data):
        install = installation_id(data.get("installation_id"))
        claims = self.read_token(data.get("token"))
        if claims["installation_id"] != install:
            raise APIError("installation_mismatch", 403)
        # Expired leases can renew a permanent entitlement only after DB checks.
        return self.store.renew(claims["license_id"], install, self.token)

    def read_token(self, token):
        try:
            if not isinstance(token, str) or len(token) > 4096:
                raise ValueError("token size")
            payload, signature = token.split(".")
            self.key.public_key().verify(unb64url(signature), payload.encode("ascii"))
            claims = load_json(unb64url(payload))
            if not isinstance(claims, dict):
                raise ValueError("claims")
            valid = (claims.get("product") == "xmd" and claims.get("plan") == "pro"
                     and type(claims.get("exp")) is int and type(claims.get("iat")) is int
                     and claims["exp"] - claims["iat"] == LEASE_SECONDS
                     and claims["iat"] <= int(time.time()) + 60
                     and claims.get("license_expires_at", False) is None
                     and isinstance(claims.get("license_id"), str))
            if not valid:
                raise ValueError("claims")
            installation_id(claims.get("installation_id"))
            return claims
        except (ValueError, TypeError, UnicodeError, InvalidSignature, APIError):
            raise APIError("invalid_token", 403) from None
