"""Shared application core for HTTP and the trusted local operator CLI."""

import os

from .licensing import Licensing
from .payments import Payments
from .security import load_keys, public_key, runtime_directory
from .store import Store


class Service:
    def __init__(self, config):
        if os.name == "posix":
            os.umask(0o077)
        self.config = config
        state = runtime_directory(config.state_dir)
        self.key, delivery_key = load_keys(state)
        self.store = Store(state)
        self.licensing = Licensing(self.store, self.key)
        self.payments = Payments(self.store, config, delivery_key)

    def configuration(self):
        methods = sorted(self.payments.providers)
        return {"product": "XMD", "price_cents": self.config.price_cents,
                "purchase_enabled": bool(methods), "public_key": public_key(self.key),
                "payment_methods": methods}
