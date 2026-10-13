# XMD backend design

## Goals and boundaries

Provide permanent Pro entitlement for CNY 29.90, max one browser installation,
with signed renewable 7-day offline leases. Make binding/revocation and verified
payment issuance transactional. Keep purchase disabled until official merchant configuration
and explicit enablement exist. Do not expose manual administration to the network.

The extension handles Free simple single-post export and Pro bulk/longform/comments.
Open-source code is modifiable; these local gates are a commercial entitlement mechanism,
not tamper-proof DRM. Browser installation identity is a random UUID, not hardware attestation;
copying an installation UUID and its token can clone that identity. Revocation reaches offline
clients when they renew or their existing lease expires (maximum seven days).

## Components and data flow

```text
extension -> nginx/TLS -> bounded loopback HTTP server
                             -> Licensing -> SQLite transaction -> Ed25519 token
                             -> Payments -> official checkout adapter
provider signed webhook -> signature verification/decryption
                        -> stored-order checks -> atomic issuance + event ledger
trusted operator CLI -> private filesystem state -> issue / revoke / public-key
```

`security.py` contains strict JSON/base64/UUID parsing and runtime key/filesystem protection.
`store.py` owns the schema and independent SQLite transaction connections.
`licensing.py` serializes entitlement claims and signs UTF8(base64url(payloadJSON)).
`providers.py` implements WeChat Native v3 and Alipay page-pay, signature verification
and integer-cent conversion; `payments.py` owns order state, replay control and encrypted delivery.
`service.py` assembles dependencies for HTTP and CLI. `server.py` routes only the documented
public endpoints. `cli.py` performs local trusted-operator operations.

## Decisions and alternatives

| Decision | Reason and effect |
| --- | --- |
| Python stdlib HTTP + cryptography | Small sidecar; no Node or web framework on CentOS. nginx provides public TLS/proxy. Python 3.6 rejected; 3.12 deployment preferred. |
| SQLite `BEGIN IMMEDIATE` per operation | Serializes first binding, revoke/refresh, retries and payment issuance without process-wide shared connections. Suitable for one low-volume service host. |
| Permanent license + 604800-second lease | Permanent purchase and bounded offline authorization are separate. An expired signed token can renew only through current DB authorization. |
| Ed25519 and pinned raw public key | Browser-verifiable tokens without sharing the signing secret. Server-returned keys are discovery values, not a new trust root. |
| SHA256 of 256-bit random license code | High-entropy codes cannot feasibly be brute-forced from the DB. No plaintext code in license records, URLs or logs. |
| AES-GCM encrypted order delivery copy | Supports repeat polling after verified payment without storing recoverable plaintext in SQLite. A separate runtime key and order/installation AAD protect delivery integrity. |
| Manual local CLI; no admin APIs | Filesystem ownership is the operator trust boundary. Automatic issuance has only the verified payment path. |
| Persist merchant/app/amount snapshots per order | Callback checks use original order terms even after configuration changes. Unique provider transaction IDs prevent cross-order issuance. |
| Fixed official provider endpoints, no redirects | Caller input cannot redirect provider requests or exfiltrate merchant authorization. TLS verification uses Python defaults. |
| Explicit payments flag + complete config | Price defaults to confirmed 2990 cents but cannot enable purchasing alone. Partial config yields no available method; invalid complete crypto config fails startup. |
| No cookies; constrained extension CORS | Explicit license/token/UUID credentials authorize operations. CORS does not replace authentication; HTTPS origins need operator configuration. |

## Threat model, security decisions and trust boundaries

Untrusted input includes HTTP bodies, license codes, tokens, installation UUIDs, order IDs,
and provider callback headers/bodies. Operator config and private filesystem state are trusted.
Every activation input uses strict type/format limits. Signature failures do not parse into an
authorized claim. SQL uses parameterized queries. HTTP accepts bounded bodies, rejects
duplicate JSON/form keys and ambiguous Content-Length/Transfer-Encoding, and limits
concurrent worker threads/timeouts. Per-client/IP limits constrain activation/order attempts.
Only the loopback listener trusts nginx-overwritten X-Real-IP; an untrusted local process is
outside that boundary. Memory-limited rate buckets are an abuse control, not a distributed WAF.

WeChat validates configured public-key ID, exact raw response/envelope signature and a
300-second timestamp window before AES-GCM resource decryption. Payment must be a
`TRANSACTION.SUCCESS`, `SUCCESS`, `NATIVE` transaction. Alipay accepts only RSA2
UTF-8 form notifications and paid states, verifying all fields except `sign`/`sign_type`.
Mainland page-pay implicitly uses CNY; explicit foreign currency is rejected.
Both paths check original order amount/currency/provider/app/merchant before writing.

The payment-event primary key makes exact retries idempotent; mismatched fingerprints
with the same event ID fail. A unique provider transaction ID prevents one transaction
from paying multiple orders. License insertion, transaction ID, delivery and event insertion
commit together or all roll back. A paid duplicate never resurrects a revoked license.
Provider callbacks are acknowledged only after commit. No mock payment route or unsigned fallback exists.

Runtime state must be outside the repository. On POSIX it must be owned by the effective
service UID and private; key/output writes are exclusive and refuse symlinks. Existing DBs
with missing runtime keys refuse startup instead of silently changing the trust root.
The CLI prints public keys and license IDs only, issuing codes to an exclusive private file.
Logs omit request paths, queries, bodies and provider exceptions. nginx sample suppresses
access logs for bearer-authenticated polling. Backups need the same credential protection.

## Known limitations and operational gaps

No credentials or live provider acceptance were available; tests use ephemeral test keys and
mock external network responses. Real provider onboarding remains unverified. The shipped
environment leaves both payment methods disabled and the UI should show 待配置.
No automatic provider order query/reconciliation, refunds/chargebacks, key rotation,
delivery retention purge or operator billing console is implemented. A missing callback
does not become paid based on return URLs or UI claims. Reconcile against official merchant
records and use trusted manual issuance if necessary. Revoking a refunded license is manual.
WeChat uses configured public-key PEM mode; automatic platform-certificate download/rotation
is not implemented. Alipay certificate mode/service-provider mode and foreign-currency gateways
are outside this adapter. Single-host SQLite and in-memory rate limits need re-evaluation for scale.
Manual operator access/service-host compromise can issue arbitrary licenses by design.
Windows filesystem ACLs require explicit setup; production hardening targets Linux/systemd.

## Verification and change history

2026-10-13: Added standalone backend and deployment samples. Existing extension/main files
are outside backend agent ownership. The main agent deployed the completed backend separately.
Tests cover core entitlement state, concurrent first binding and verified payment retries,
invalid/tampered tokens, expired renewal, revocation, replay/transaction reuse, amount/currency/
merchant mismatches, signed WeChat responses/decryption, HTTP input limits, CORS and disabled checkout.
Primary payment references and operator commands are in README.md. The deployment samples
preserve the existing `.cloud` root proxy and use `/opt/xmd-license/venv` with nonroot `xmd`.
