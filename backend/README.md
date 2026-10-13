# XMD activation backend

## Deployed instance (2026-10-13)

Service: xmd-license, nonroot user xmd, loopback 127.0.0.1:8219.
Release: /opt/xmd-license/releases/20261013072705/backend.
Public client endpoint: https://lanyxiaosheng.cloud:8443/xmd-api/v1.
The existing valid public certificate covers this domain. External port 443 fails from
the development machine; 8443 passed real Chromium activation and download integration.
Merchant payments remain disabled. Before enabling merchants, verify the callback URL
and port required by each provider, then configure XMD_PUBLIC_BASE_URL accordingly.
Runtime merchant configuration is /etc/xmd/xmd.env; private keys and state are outside Git.

SQLite + Ed25519 activation for permanent XMD Pro, CNY 29.90 (2990 cents),
one browser installation. Free simple single-post export and Pro bulk/longform/comments
are enforced by the extension. This service provides signed entitlements and verified payment issuance.
An open-source client can be modified to remove local feature gates; licensing cannot prevent that.

## Runtime and dependencies

Python >=3.8 with SSL and SQLite; Python 3.12 is recommended for deployment.
The existing CentOS Python 3.6 is unsupported. The main agent found
`/opt/lany-python/3.12/bin/python3` (3.12.14); use a separate service venv.
Only third-party dependency: `cryptography` (Ed25519, RSA2, AES-GCM).
No Node, FastAPI or payment SDK is needed on the server.

From the deployed `/opt/xmd-license/backend` directory:

```bash
/opt/lany-python/3.12/bin/python3 -m venv /opt/xmd-license/venv
/opt/xmd-license/venv/bin/python -m pip install -r requirements.txt
XMD_STATE_DIR=/var/lib/xmd /opt/xmd-license/venv/bin/python -m xmd.server --port 8219
```

The last command must run as the dedicated `xmd` user. The service always binds
`127.0.0.1`; TLS terminates at nginx. Installation commands are examples; no remote deployment was performed.

## Trusted operator CLI

Run from `/opt/xmd-license/backend`, as `xmd`. Runtime state is outside the repository,
directory mode 0700 and keys/database/delivery files 0600. On POSIX, wrong owners,
group/world-readable state and symlinks are rejected. Windows is a development platform;
NTFS ACLs must be configured separately (POSIX mode checks cannot secure Windows ACLs).

```bash
sudo -u xmd /opt/xmd-license/venv/bin/python -m xmd.cli --state-dir /var/lib/xmd init
sudo -u xmd /opt/xmd-license/venv/bin/python -m xmd.cli --state-dir /var/lib/xmd public-key
sudo -u xmd /opt/xmd-license/venv/bin/python -m xmd.cli --state-dir /var/lib/xmd issue --output /var/lib/xmd/issued-pro.license.json
sudo -u xmd /opt/xmd-license/venv/bin/python -m xmd.cli --state-dir /var/lib/xmd revoke --license-id YOUR_LICENSE_UUID
```

`issue` requires a NEW output path, never overwrites it and does not print the code.
Deliver its `code` privately to the buyer; retain `license_id` for revocation.
Manual issuance is exclusively via this filesystem-authenticated operator CLI.
No administrative HTTP APIs exist. Online automatic issuance only follows a verified provider payment event.
Use unique delivery filenames for additional licenses. `public-key` prints a PUBLIC value;
pin this exact value in the compiled extension through a trusted release process.
Never accept a replacement trust key merely because `/config` returned it.

## Exact public contract

Base: `https://lanyxiaosheng.cloud/xmd-api/v1` (loopback service preserves this path).
JSON success responses are direct objects, without a `data` wrapper.
Errors: `{"error":"machine_readable_code"}` with an appropriate HTTP status.
All responses use `Cache-Control: no-store`.

| Method/path | Request | Success |
| --- | --- | --- |
| GET `/health` | none | 200 `{"ok":true}` after DB check |
| GET `/config` | none | 200 fields shown below |
| POST `/activate` | `{"code":"XMD-…","installation_id":"UUID"}` | 200 `{token,claims}` |
| POST `/verify` | `{"token":"…","installation_id":"UUID"}` | 200 fresh `{token,claims}` |
| POST `/orders` | `{"provider":"wechat" or "alipay","installation_id":"UUID"}` | 201 `{order_id,qr_url}` (WeChat) or `{order_id,checkout_url}` (Alipay) |
| GET `/orders/<order_id>?installation_id=UUID` | same installation UUID | 200 `{order_id,status}`; paid adds `code,license_id` |
| POST `/webhooks/wechat` | signed raw JSON envelope | 204 after atomic settlement |
| POST `/webhooks/alipay` | signed URL-encoded POST form | 200 literal `success` after atomic settlement |

With the shipped configuration, `/config` has EXACTLY these fields:

```json
{
  "product": "XMD",
  "price_cents": 2990,
  "purchase_enabled": false,
  "public_key": "runtime-generated-32-byte-Ed25519-public-key-as-base64url",
  "payment_methods": []
}
```

`public_key` is the raw 32-byte Ed25519 public key, unpadded base64url, not PEM.
`price_cents` is an integer; the fixed configured price defaults to 2990.
`payment_methods` contains strings `wechat` and/or `alipay` only when configured and enabled.
Missing provider/price/public URL/enablement keeps purchases disabled; invalid complete key config
fails startup instead of bypassing verification. Disabled orders/webhooks return 503 `purchase_unavailable`.
UI should display 待配置 while disabled.

Token: `payloadB64.signatureB64`, each unpadded base64url. Ed25519 signs exactly
`UTF8(payloadB64)` (ASCII bytes), NOT the decoded JSON. Decode the payload only after
verifying that signature against the pinned public key. Claims:

```text
product: "xmd"
plan: "pro"
installation_id: canonical UUID
license_id: UUID
iat: integer Unix seconds
exp: integer Unix seconds, iat + 604800
license_expires_at: null
```

Permanent entitlement does not expire; the offline lease does. An expired signed lease
may renew through `/verify` after the DB confirms its license is active and bound to
the same installation. Wrong installation, forged token and revoked licenses fail.
Re-activation on the original installation is idempotent; another installation gets 409.
An offline client may retain access until its existing 7-day lease expires after revocation.
Order statuses: `creating`, `pending`, `paid`, `failed`, and `revoked` on delivery after license revocation.
`failed` is a checkout-request failure, not proof that a provider payment failed; a later valid callback can settle it.
Treat installation UUID and order ID as bearer credentials; do not log them or place them in analytics.

## Payments: operational enablement

The deployment example deliberately has `XMD_PAYMENTS_ENABLED=false` and no merchant fields.
Populate official merchant credentials on the server, using private files outside the repository,
then explicitly enable and restart. Do not send credentials through chat or commit them.
Partial merchant configuration never enables that provider. A price alone never enables checkout.

WeChat Native uses merchant RSA >=2048 PEM private key, merchant certificate serial,
app ID, merchant ID, the official WeChat RSA PUBLIC KEY PEM and its `PUB_KEY_ID_...`,
and a file of exactly 32 raw APIv3 key bytes (no newline). This implementation uses
WeChat's public-key mode, not automatic platform-certificate retrieval.
Requests use RSASHA256 authorization; successful responses and callbacks are verified
with the configured provider key. Callback resources are authenticated/decrypted with AES-256-GCM.
`qr_url` is the actual provider-issued `weixin://wxpay/bizpayurl?...` URI for the extension's QR renderer.

Alipay uses mainland `alipay.trade.page.pay`, `FAST_INSTANT_TRADE_PAY`, UTF-8 and RSA2,
an app RSA private PEM, official Alipay PUBLIC KEY PEM, app ID and seller ID.
The checkout URL points to the fixed official HTTPS gateway. The returned page is never evidence of payment.
Only the RSA2-verified POST notification authorizes issuance. Mainland page-pay amounts are CNY;
any explicit non-CNY notification is rejected. All decoded notification fields participate in
verification except `sign` and `sign_type`, including unknown and empty fields.

After verification, BOTH adapters match the stored order's provider, amount in integer cents,
currency, merchant/seller ID and app ID. Transaction IDs and event IDs are unique/idempotent.
One atomic transaction records the payment, creates one installation-bound license and stores
an AES-GCM-encrypted delivery copy of its code. The license table stores only SHA256(code).
Polling cannot manufacture a payment; unsigned or mismatched notifications never issue a license.

Known gaps before live merchant launch: no merchant credentials or actual acceptance tests were
available; no provider query/reconciliation worker, automated refund/revocation, certificate/key
rotation automation or billing support console is implemented. Missed callbacks remain pending
and require trusted-operator reconciliation against official merchant records; use CLI issuance only
after reconciliation. Do not invent a paid state or enable a mock provider. Configure both merchant
callback URLs under the public base and verify a real payment and retry before production sales.

Primary references: [WeChat Native order](https://pay.wechatpay.cn/doc/v3/merchant/4012791877),
[signed callback/decryption](https://pay.wechatpay.cn/doc/v3/merchant/4012791882),
[Alipay page-pay integration](https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/ai-web-app-payment-integration-guide.html),
[Alipay notification verification](https://global.alipay.com/developer/helpcenter/detail?_route=sg&categoryId=67617&knowId=201602452303&sceneCode=AC_DEV),
[official Python signing implementation](https://github.com/alipay/alipay-sdk-python-all/blob/master/alipay/aop/api/util/SignatureUtils.py).

## Deployment and operations

Use [systemd unit](deploy/xmd-license.service), [environment example](deploy/xmd.env.example),
and [nginx location](deploy/nginx-location.conf). Create a locked nonroot `xmd` user,
root-owned `/opt/xmd-license` code/venv, and `/etc/xmd/xmd.env` owned root:xmd mode 0640.
systemd creates `/var/lib/xmd` as xmd mode 0700; initialize it with the same ownership if running CLI first.
Payment private files must be owned by xmd and mode 0600; their containing directory should be 0700.
Preserve the existing `.cloud` HTTPS server/root proxy and certificate; add ONLY the `/xmd-api/` location.
The sample preserves the full upstream path and overwrites X-Real-IP for rate limiting.
nginx query-string access logging is disabled for this location because polling authenticates by UUID.
CORS defaults to valid `chrome-extension://[a-p]{32}` origins; HTTPS web origins must be explicitly listed
with comma-separated `XMD_CORS_ORIGINS`. No cookie-based auth is used.

Back up database AND `signing.key` AND `delivery.key` together, stopping the service for a consistent
snapshot or using SQLite's backup API. Protect backups as credentials. Do not rotate/delete signing
keys casually: clients pin their public key; a missing key for an existing database refuses startup.
Runtime keys are generated only in private state, never in the source tree. Do not copy state into releases.
Protect host access: the trusted operator/service account can issue and revoke licenses by design.
The bounded stdlib server runs only behind nginx/TLS, with body/time/thread limits and per-IP rate limits.

Run local checks from `backend/`:

```bash
python -m unittest discover -s tests -v
python -m compileall -q xmd tests
```

Tests exercise real cryptographic primitives with runtime test keys and mock only external network I/O.
They cover activation/reverify/revocation, concurrent first bind/payment retries, payment mismatches,
signature failures/replay, decryption, HTTP/CORS and disabled checkout. No live merchant or remote deployment
claim is implied by local tests.
