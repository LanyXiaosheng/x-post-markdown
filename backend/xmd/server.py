"""Bounded stdlib HTTP server. Bind loopback and place nginx/TLS in front."""

import argparse
import ipaddress
import re
import socket
import sqlite3
import sys
import threading
import time
from collections import OrderedDict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .config import Config
from .security import APIError, json_bytes, load_json
from .service import Service


BASE = "/xmd-api/v1"
MAX_BODY = 131072
MAX_CLIENTS = 4096
MAX_WORKERS = 32


class Limiter:
    def __init__(self):
        self.lock, self.clients = threading.Lock(), OrderedDict()

    def check(self, client, category, limit):
        now, key = time.monotonic(), (client, category)
        with self.lock:
            if key not in self.clients:
                if len(self.clients) >= MAX_CLIENTS:
                    self.clients.popitem(last=False)
                self.clients[key] = deque()
            times = self.clients[key]
            self.clients.move_to_end(key)
            while times and times[0] <= now - 60:
                times.popleft()
            if len(times) >= limit:
                raise APIError("rate_limited", 429)
            times.append(now)


class HTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def __init__(self, address, service):
        self.service, self.limiter = service, Limiter()
        self.slots = threading.BoundedSemaphore(MAX_WORKERS)
        super().__init__(address, Handler)

    def process_request(self, connection, address):
        if not self.slots.acquire(blocking=False):
            try:
                connection.settimeout(1)
                connection.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\n"
                                   b"Content-Length: 0\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(connection)
            return
        try:
            super().process_request(connection, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, connection, address):
        try:
            super().process_request_thread(connection, address)
        finally:
            self.slots.release()

    def handle_error(self, connection, address):
        # Tracebacks can contain provider data. Do not log request values.
        print("HTTP connection failed.", file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    server_version = "XMD"
    sys_version = ""

    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def log_message(self, format, *args):
        # Suppress stdlib path/query logging: orders use a bearer installation UUID.
        pass

    def allowed_origin(self):
        origin = self.headers.get("Origin")
        configured = self.server.service.config.cors_origins
        if not origin:
            return None
        if origin in configured:
            return origin
        if "chrome-extension://*" in configured and re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            return origin
        raise APIError("origin_not_allowed", 403)

    def response(self, status, data, content_type="application/json; charset=utf-8"):
        body = json_bytes(data) if isinstance(data, dict) else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        try:
            origin = self.allowed_origin()
        except APIError:
            origin = None
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        if self.command == "OPTIONS":
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if status == 429:
            self.send_header("Retry-After", "60")
        self.end_headers()
        if body:
            self.wfile.write(body)
        self.close_connection = True

    def client_ip(self):
        # Listener is loopback-only. nginx must overwrite X-Real-IP (sample supplied).
        forwarded = self.headers.get("X-Real-IP", self.client_address[0])
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            raise APIError("invalid_client_address") from None

    def read_body(self, webhook=False):
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            raise APIError("invalid_content_length")
        length = int(lengths[0])
        maximum = MAX_BODY if webhook else 8192
        if length <= 0 or length > maximum:
            raise APIError("invalid_body_size", 413)
        body = self.rfile.read(length)
        if len(body) != length:
            raise APIError("incomplete_body")
        return body

    def json_body(self):
        if self.headers.get_content_type() != "application/json":
            raise APIError("unsupported_content_type", 415)
        try:
            data = load_json(self.read_body())
            if not isinstance(data, dict):
                raise ValueError("object required")
            return data
        except (ValueError, UnicodeError, RecursionError):
            raise APIError("invalid_json") from None

    def dispatch(self):
        path = urlsplit(self.path)
        if not path.path.startswith(BASE + "/"):
            raise APIError("not_found", 404)
        route, service = path.path[len(BASE):], self.server.service
        # Provider callbacks are server-to-server and still verify signatures.
        webhook = route.startswith("/webhooks/")
        if not webhook:
            self.allowed_origin()
        self.server.limiter.check(self.client_ip(), "webhook" if webhook else "api", 240)
        if self.command == "OPTIONS":
            return self.response(204, b"")
        if self.command == "GET":
            return self.get_route(route, path.query)
        if self.command == "POST":
            if webhook:
                return self.webhook(route[len("/webhooks/"):])
            if route in ("/activate", "/verify", "/orders"):
                limit = 10 if route == "/orders" else 30
                self.server.limiter.check(self.client_ip(), route, limit)
                data = self.json_body()
                operation = {"/activate": service.licensing.activate, "/verify": service.licensing.verify,
                             "/orders": service.payments.create}[route]
                return self.response(200 if route != "/orders" else 201, operation(data))
        raise APIError("not_found", 404)

    def get_route(self, route, query_string):
        service = self.server.service
        if route == "/health":
            with service.store.transaction() as db:
                db.execute("SELECT 1").fetchone()
            return self.response(200, {"ok": True})
        if route == "/config":
            return self.response(200, service.configuration())
        if route.startswith("/orders/"):
            try:
                query = parse_qs(query_string, keep_blank_values=True, max_num_fields=4)
            except ValueError:
                raise APIError("invalid_query") from None
            install = query.get("installation_id", [])
            if len(install) != 1:
                raise APIError("invalid_installation_id")
            return self.response(200, service.payments.status(route[len("/orders/"):], install[0]))
        raise APIError("not_found", 404)

    def webhook(self, provider):
        expected = "application/x-www-form-urlencoded" if provider == "alipay" else "application/json"
        if self.headers.get_content_type() != expected:
            raise APIError("unsupported_content_type", 415)
        for name in ("Wechatpay-Serial", "Wechatpay-Signature", "Wechatpay-Timestamp", "Wechatpay-Nonce"):
            if len(self.headers.get_all(name, [])) > 1:
                raise APIError("duplicate_signature_header")
        self.server.service.payments.notification(provider, self.headers, self.read_body(True))
        if provider == "alipay":
            return self.response(200, b"success", "text/plain; charset=utf-8")
        return self.response(204, b"")

    def run_request(self):
        try:
            self.dispatch()
        except APIError as exc:
            self.response(exc.status, {"error": exc.code})
        except sqlite3.OperationalError:
            self.response(503, {"error": "storage_unavailable"})
        except (socket.timeout, ConnectionError):
            self.close_connection = True
        except Exception:
            print("Request failed internally (request values omitted).", file=sys.stderr)
            self.response(500, {"error": "internal_error"})

    do_GET = run_request
    do_POST = run_request
    do_OPTIONS = run_request


def main(argv=None):
    parser = argparse.ArgumentParser(description="XMD loopback activation service")
    parser.add_argument("--port", type=int, default=8219)
    args = parser.parse_args(argv)
    try:
        service = Service(Config.from_env())
        server = HTTPServer(("127.0.0.1", args.port), service)
    except (ValueError, RuntimeError, OSError):
        print("Startup failed; check configuration and state/key permissions.", file=sys.stderr)
        return 1
    print("XMD listening on 127.0.0.1:%d; no administrative HTTP routes." % args.port)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
