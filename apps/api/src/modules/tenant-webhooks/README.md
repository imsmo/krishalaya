# tenant-webhooks (tenant self-serve outbound webhooks · P1-11 → PC-56 TENANT-13a)

A tenant admin registers https endpoints, subscribes to PUBLIC events from the catalogue, and is shown a **signing secret once**. On
every relayed outbox event the catalogue maps, a delivery is recorded per subscribed endpoint (held if the endpoint is paused) and the
apps/worker delivery job POSTs it — **HMAC-signed** — with the canon's retry ladder.

## Routes (`/v1/webhooks`, `tenancy` flag, **`api.manage`** on every read and write)
- `GET /events` — the public catalogue (name, payload version, the fields a v1 payload carries) — `domain/webhook-catalog.ts`.
- `GET /` — the endpoints (never a secret), 7-day figures from the attempt rows, the count, and `contract` (the delivery contract as built).
- `POST /preview` — the registration review with the guard's LIVE verdict (DNS resolved). Writes nothing.
- `POST /` (Idempotency-Key) — register; the secret is in this response body, once. A replayed key answers `secret: null, secretShown: false`.
- `PATCH /:id` (key, reason) — change event subscriptions.
- `POST /:id/acts/:act/preview` — the confirm step's verdict for pause | resume | rotate | delete | replay-failed.
- `POST /:id/pause` · `/:id/resume` · `/:id/replay-failed` · `/:id/rotate-secret` · `DELETE /:id` (soft) — keyed, reasoned, audited.
- `GET /deliveries?endpointId&status&since&limit&cursor` — the tenant's delivery log (µs keyset), counts, the computed diagnosis.
- `GET /deliveries/:id` — one delivery, payload MASKED, every attempt row.
- `POST /deliveries/:id/acts/replay/preview` · `POST /deliveries/:id/replay` (key, reason) — replay one (original payload, fresh signature).

## The delivery contract (`domain/webhook-rail.state.ts`, byte-identical in apps/worker)
- First attempt as soon as the worker sees it; then 1m · 5m · 30m · 2h · 12h (six attempts a cycle). 2xx = delivered.
- After the sixth failure the delivery is `exhausted` and the ENDPOINT is paused (`paused_reason = exhausted`); its queued deliveries
  are held; `webhooks.endpoint_paused` goes to the outbox (developer contact if a member, and whoever added the endpoint).
- A paused / disabled endpoint's new events are recorded `held`; resume re-queues held + exhausted in creation order.
- A send-time guard refusal DISABLES the endpoint (`unsafe_target`) — nothing is sent.
- Every attempt is a `webhook_delivery_attempts` row (append-only). Deliveries + attempts are kept 90 days (retention-enforcer).
- 10 s per send, 64 KiB of response read, redirects never followed, port 443 only, the connection pinned to the vetted address.

## Security
- **Target guard** (`domain/webhook-ssrf.ts`, shared with the worker): https, port 443, no credentials, no internal names (trailing
  dots stripped first), no single-label names, and EVERY resolved address public (v4 private/reserved ranges; v6 allow-list of
  2000::/3 with mapped and NAT64 addresses judged as their IPv4).
- **Secret** (`core/secrets/secret-envelope.ts`, shared with the worker): `whsec_` + 32 random bytes, shown once; a per-secret data
  key under AES-256-GCM bound to the row, wrapped by the KEK (`WEBHOOK_SIGNING_KEK`; production without it refuses to start — API and
  worker). The hint (last 3 characters) is stored apart. Encrypted, not hashed: an HMAC signer must hold the key.
- **Signature** (`domain/webhook-signature.ts`): `Krishalaya-Signature: t=<unix>,v1=<hmac-sha256 of "t.body">` — two v1 values during
  the 24 h rotation overlap; `X-KV-Signature` carries the same value for 0090-era receivers.
- **Isolation**: tenant_id in every query + RLS (0191: the tenant realm sees `endpoint_kind = 'tenant'` rows only — partner deliveries
  never surface); every delivery read joins this tenant's endpoints. One ACID tx per write; audited with actor · reason · before/after · ip.

## Schema
`webhook_endpoints` (0002 + 0191: `secret_enc`, rotation pair, hint, status, developer_email, soft delete), partitioned
`webhook_deliveries` (0002 + 0191: endpoint_kind, state, retry_step, …), `webhook_delivery_attempts` (0191), view
`webhook_delivery_targets` (0090, recreated by 0191; kv_relay only).
