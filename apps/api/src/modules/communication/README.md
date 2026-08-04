# communication (PRD M13) — the notification spine

Krishalaya owns the **policy + content** of notifications; the actual **send** is delegated to an external
notification product (push / in-app / email / sms / whatsapp / ivr) across a resilience-wrapped gateway port.
Gated by the `communication` feature flag (default **OFF**).

## What it owns

- **Event catalog** (`notification_events`, GLOBAL, read-only here) — the trigger vocabulary with each event's
  `priority`, `default_channels`, `user_can_opt_out`, `batchable`.
- **Templates** (`notification_templates`) — per `event × channel × language`, with **tenant overrides** layered
  over platform defaults. `{{variable}}` rendering lives only in the template entity (ReDoS-safe token, missing
  keys render blank — a token never leaks to a user).
- **Preferences + quiet hours** (`notification_preferences`, `user_quiet_hours`, user-scoped) — per-channel
  opt-in/out and a DST-correct quiet window (resolved via `Intl`, no library).
- **Delivery log** (`notifications`, PARTITIONED by `created_at`) — one row per recipient×channel, with
  `cost_minor` for the SMS cost-bomb monitor and a `notif_status` state machine.

## The fanout (how every module's events become notifications)

Each module emits domain events through the transactional outbox. `notification-event-map.ts` maps a real
outbox `event_type` → a catalog `event_code` + which payload keys hold the recipient(s). At init the module
registers one `DomainEventFanoutHandler` per mapped type into the shared `OUTBOX_HANDLER_REGISTRY`. Inside the
relay's per-event transaction the handler:

1. resolves the catalog event → channel set via `resolveChannels` (default channels ∩ the user's preferences;
   **mandatory events ignore opt-out**, and **`critical` events bypass quiet hours** while intrusive channels —
   push/sms/whatsapp/ivr — are suppressed in quiet hours for non-critical; email/in-app are never suppressed);
2. resolves the effective template (tenant override → platform default; requested language → `en`/`hi`
   fallback) and renders it;
3. dispatches each non-`inapp` channel via the gateway (resilience-wrapped, **degrades to a `failed` row** if
   the notifier is down — never throws into the relay); `inapp` needs no send (the row IS the inbox item);
4. records ONE delivery row per channel in its final state and writes its own outbox events.

The notification id is **derived deterministically** from `(outbox event id, recipient, channel)`, so a relay
re-delivery never double-records, and the gateway (which dedups on that id) never double-sends.

## Surface (v1, all under the `communication` flag)

- `GET /v1/notifications` — the caller's own inbox (keyset; `status`, `unreadOnly`). `POST /v1/notifications/:id/read`.
- `GET/PUT /v1/notifications/preferences`, `GET/PUT /v1/notifications/quiet-hours` — the caller's own settings.
- `GET /v1/notifications/events`, `GET /v1/notifications/templates`, `POST /v1/notifications/templates` —
  catalog browse + tenant template authoring (`notification.manage`).
- `POST /v1/notifications/delivery-callback` — the external notifier's delivery-status webhook (PUBLIC, trust
  via HMAC-SHA256 over the raw body against `NOTIFY_WEBHOOK_SECRET`; fail-closed if unconfigured).

## Threats considered (§4)

- **Tenant isolation / RLS** — `notifications` + `notification_templates` are RLS-protected; `tenant_id` binds
  every tenant query. The catalog is global (no tenant data). Preferences/quiet-hours are user-scoped, always
  filtered by `user_id`.
- **No IDOR** — the inbox + mark-read act only on `ctx.userId`; a non-owner read returns **404**. Template
  authoring writes only the caller's own `tenant_id` (platform defaults aren't editable here, Law 11).
- **Opt-out abuse** — disabling a mandatory event (OTP/dispute/payment) **throws** `CannotOptOutError`; an
  unknown event code is rejected. The fanout is **fail-closed**: an uncatalogued event sends nothing.
- **Webhook spoofing** — constant-time HMAC over the raw body; missing secret ⇒ refuse (fail-closed).
- **Cost / DoS** — bounded preference batch (≤200) and list `LIMIT`; one delivery row per channel (no write
  amplification); SMS `cost_minor` recorded for the cost-bomb monitor; gateway timeout + breaker + bulkhead.
- **No PII/secrets in logs** — the gateway adapters log channel + event only, never body/contact/OTP.

## Config

`NOTIFY_GATEWAY_URL` (absent ⇒ the noop gateway: dev accepts, prod warns + drops), `NOTIFY_GATEWAY_API_KEY`,
`NOTIFY_WEBHOOK_SECRET`. Pointing at the external product is config, not code (`gateway.provider.ts`).

## Messaging (chat + masked calls)

The second half of M13. **Conversations** (`order`/`requirement`/`dispute`/`booking`/`direct`/`support_ticket`)
hold participants; **messages** are append-only (partitioned), carrying body / voice / attachment with an
AI-transparency badge and an abuse `is_flagged` flag. Access is gated by **participant membership** resolved
server-side — a non-participant read returns **404** (no IDOR); `conversation_participants` has no `tenant_id`
and is always joined to `conversations` so membership can't leak across tenants. A locked thread refuses new
messages. Posting a message emits `comm.message_posted` carrying the *other* participants as `recipientUserIds`
— the same notification fanout turns that into a `chat.message_posted` push/in-app alert.

**Masked calls** (PRD §9.13) bridge two users through an external number-masking telephony provider
(`MASKING_PROVIDER` port, resilience-wrapped, degrade-not-die) so neither sees the other's number. We persist
**only** user ids + the provider's call ref + duration — **never raw phone numbers** (the provider owns the
directory). Initiation is idempotent; a call-status webhook (HMAC over the raw body against
`MASKING_WEBHOOK_SECRET`, fail-closed) records the duration.

Surface: `POST /v1/conversations` (open, Idempotency-Key), `GET /v1/conversations`, `GET /v1/conversations/:id`,
`POST /v1/conversations/:id/{read,lock}`, `POST /v1/conversations/:id/messages` (Idempotency-Key),
`GET /v1/conversations/:id/messages`, `POST /v1/conversations/messages/:id/flag`; `POST /v1/masked-calls`
(Idempotency-Key), `GET /v1/masked-calls`, `POST /v1/masked-calls/status-callback` (HMAC webhook).
Moderation (`message.moderate`) can lock threads + unflag after review.

## Config (messaging)

`MASKING_PROVIDER_URL` (absent ⇒ noop: dev returns a synthetic ref, prod drops), `MASKING_PROVIDER_API_KEY`,
`MASKING_WEBHOOK_SECRET`.

## Deferred (schema present, not built)

The smart-digest batching engine (`batchable` + `batched_into`); a DB-level failed-notification retry poller;
IVR/voice rendering; call recording retrieval (consent-gated `recording_media_id` is stored but not exposed).

## Tests

`__tests__/communication-domain.spec.ts` (render, state machine, channel resolution, quiet hours),
`notification.service.spec.ts` (fanout, gateway-degrade, fail-closed, deterministic id, mark-read 404),
`tenant-isolation.spec.ts` (CI gate: user/tenant binding, keyset, partition-bound updates, template fallback),
`communication.integration.spec.ts` (real Postgres + seeded catalog: fanout → channel rows → inbox → mark-read
→ opt-out suppression → cross-tenant RLS denial; runs when `DATABASE_URL` is set, else skipped).
