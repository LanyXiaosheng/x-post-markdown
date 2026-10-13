"""Operator configuration. Partial merchant configurations never enable checkout."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


def https_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("public base URL must be HTTPS without credentials/query/fragment")
    return value.rstrip("/")


@dataclass
class Config:
    state_dir: Path
    price_cents: int = 2990
    public_base_url: str = ""
    payments_enabled: bool = False
    cors_origins: tuple = ("chrome-extension://*",)
    provider_config: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls):
        price = int(os.environ.get("XMD_PRICE_CENTS", "2990"))
        if not 1 <= price <= 100000000:
            raise ValueError("XMD_PRICE_CENTS must be a positive integer in cents")
        base = os.environ.get("XMD_PUBLIC_BASE_URL", "")
        if base:
            base = https_url(base)
        provider_config = {}
        for provider, names in {
            "wechat": ("APP_ID", "MCH_ID", "CERT_SERIAL", "PRIVATE_KEY_FILE",
                       "PUBLIC_KEY_ID", "PUBLIC_KEY_FILE", "API_V3_KEY_FILE"),
            "alipay": ("APP_ID", "SELLER_ID", "PRIVATE_KEY_FILE", "PUBLIC_KEY_FILE"),
        }.items():
            provider_config[provider] = {
                name.lower(): os.environ.get("XMD_" + provider.upper() + "_" + name, "")
                for name in names}
        return cls(Path(os.environ.get("XMD_STATE_DIR", "/var/lib/xmd")), price,
                   base, os.environ.get("XMD_PAYMENTS_ENABLED", "false").lower() == "true",
                   tuple(filter(None, os.environ.get("XMD_CORS_ORIGINS", "chrome-extension://*").split(","))),
                   provider_config)
