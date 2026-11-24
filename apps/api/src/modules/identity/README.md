# identity module (PRD M01)

The platform's identity, authentication, and dynamic-RBAC core. Follows the `listings`
blueprint (domain → dto → services → repositories → controllers, tenant-isolation + tests).

## What it owns
- **Users** — one global, phone-keyed identity per human (E.164). PII (Aadhaar/PAN/bank) is
  NEVER stored raw — only last-4 + external vault refs; `toPublic()` masks everything.
- **Dynamic RBAC** — roles, permissions, role→permission grants, `user_tenant_roles`
  (person × tenant × role, with approval gating), and per-staff permission overrides. All
  data, not code (Law 6) — a new role is an INSERT (db/seeds 0004).
- **KYC** — document submit + admin review (state machine), expiry tracking.
- **Addresses / bank accounts** — owner-scoped; bank accounts are tokenised (vault_ref).
- **Consents** — DPDP, append-only history. **Data-subject requests** — access/erasure/etc.
- **Sessions & devices**, **login events** (security trail), **risk scoring**.

## Authentication flow (phone-OTP first — rural-friendly)
1. `POST /v1/auth/otp` → OTP issued via Redis (hashed, rate-limited, lockout), sent over SMS.
2. `POST /v1/auth/verify` → register-or-login, bind device, open a session, mint a short-lived
   **access JWT** (carrying DB-resolved roles/perms) + an opaque **refresh token** (only its
   hash is stored).
3. `POST /v1/auth/refresh` → rotates the refresh token (theft-resistant) and re-resolves perms.
4. `POST /v1/auth/logout` (+ `?allDevices`) and `GET/DELETE /v1/auth/sessions` for session mgmt.

## Security properties (the bar)
- **Permissions come from the DB, never the client.** `core/rbac/RoleCacheService` resolves
  effective permissions (role grants ∪ staff GRANT − staff DENY; `super_admin` ⇒ `*`), caches
  them, and is invalidated on every role change — so a token reflects DB truth within its short TTL.
- **OTP**: hashed at rest, single-use, per-phone request rate limit + resend cooldown, verify
  attempt cap → lockout, constant-time compare, enumeration-safe responses.
- **Tokens**: HS256 access (15m) with iss/aud checks; refresh is high-entropy random, stored
  only as a salted hash, rotated each refresh, constant-time compared.
- **Tenant isolation**: `tenant_id` in every query on tenant-scoped tables + RLS (proven in the
  integration test). **Audit**: admin actions (role assign/approve/revoke, KYC review, status
  change, assisted-create) write append-only `audit_log` rows in the same transaction.
- **Mutations are idempotent** (Idempotency-Key required on create POSTs), atomic (UnitOfWork),
  and emit events via the outbox in-tx.

## Endpoints
`/v1/auth/*` · `/v1/users/*` (me + admin) · `/v1/rbac/*` (roles, permissions, assignments,
overrides) · `/v1/kyc/*` · `/v1/addresses/*` · `/v1/bank-accounts/*` · `/v1/consents/*`.

## Tests
Unit: user invariants + status/KYC state machines, OTP security (rate-limit/lockout/single-use),
token mint/verify + refresh hashing, value-object validation, tenant-isolation SQL contract.
Integration (`identity.integration.spec.ts`, real Postgres + RLS): OTP login → token → assign
role → next token carries the perm → refresh rotation → cross-tenant RLS. The integration DB is
built from the REAL `db/migrations` + `db/seeds` (via `test/integration-global-setup.js`); the
spec inserts only its two test tenants.

## Core hardening delivered alongside this module
`core/rbac/role-cache.service`, `core/auth/{token,otp,refresh-token}.service`, `core/audit/*`.

## DPDP erasure (PC-56 DPDP-1 · migration 0245)

**Erasure = irreversible de-identification of the person, not deletion of business records.** After the 90-day cooling-off the
worker's hourly `dpdp-erasure-cooling` job moves the request to `in_progress` and emits `identity.erasure_ready`; the
`ErasureReadyHandler` (outbox relay, kv_relay) runs it through ONE SECURITY DEFINER wall:

| Step | Function (0245) | kv_relay |
|---|---|---|
| lock + read | `kv_dsr_erasure_claim(dsr)` — status, cooling end, blocker **counts** | EXECUTE |
| blocked | `kv_dsr_erasure_block(dsr, reasons, tenant)` — status `blocked`, reasons, attempt; tells the person once per new set of reasons (`identity.erasure_blocked` → `dsr.erasure_blocked`, en/hi/gu) + audit | EXECUTE |
| erase | `kv_dsr_erasure_execute(dsr, tenant)` — re-checks every blocker (fails closed), applies the matrix, writes one `dsr_erasure_actions` row per class + one `audit_log` row (actor `system`, no PII), completes with `erasure_summary` | EXECUTE |

kv_relay gained **no table privilege**; kv_app cannot reach any of it. **No kill-switch** (Law 10, the 0214/0223 precedent): a
statutory right (DPDP s.12) has none — safety is the blockers, the cooling window and the database's own re-check.

**Blockers** (a non-zero count holds the erasure; money is never zeroed): `open_orders` (buyer or seller, not completed/cancelled/
refunded) · `wallet_balance` (any own wallet account ≠ 0 — withdrawable or held) · `open_disputes` · `active_loans` · `pending_payouts`
· `listings_under_auction` · `sole_partner_admin` · `authority_membership`. A blocked request is re-driven every hour by the same
worker job (also any `in_progress` request with no event in flight) and completes by itself when clear. An unknown figure blocks
(`unknown:<key>`). Customers' views keep `status: in_progress` for a blocked request and add `blockedReasons`.

**Idempotent / resumable:** everything commits with the relayed event or not at all; a completed request is a no-op; a crash rolls
back and the hourly re-drive starts again.

### The matrix (source of truth: `domain/erasure.rules.ts` `ERASURE_MATRIX`; the integration spec holds the SQL to it)

**Deleted** — rows that exist only about the person: `sessions` (refresh tokens), `devices`, `push_devices`, `login_events`,
`fido2_credentials`, `idempotency_keys`, `ekyc_sessions`, `notification_preferences`, `user_quiet_hours`, `weather_prefs`,
`saved_searches`, `saved_items`, `price_alerts` + `price_alert_triggers`, `auction_watchers`, `user_blocks` (as blocker), `carts` +
`cart_items`, `notifications` (content included), `risk_scores`, `credit_scores` (unless a loan application relied on one),
`media_links` to purged listing photos.

**De-identified (row kept, personal fields removed)** —
`users` → tombstone: phone `erased:<id>` (unique, non-reversible; `phone` widened to 64), name / email / DOB / gender / photo /
Aadhaar + PAN refs nulled, status `soft_deleted` · `tenant_session_revocations` cut-off written for every organisation (old access
tokens refused) · `user_tenant_roles` / `partner_memberships` / `desk_members` / `user_memberships` deactivated · `user_totp`
disabled, `user_recovery_codes` retired (never deleted — their guards) · `addresses` (line1 → `[erased]`, the rest nulled; orders
point at them) · `user_phone_changes` (→ sentinel) · `kyc_documents` (number, issuer, provider payload, reject reason nulled;
retired; subject/type/evidence are immutable by 9a's guard) · `business_kyc_profiles` · `bank_accounts` (vault token destroyed
on our side, UPI/last4/IFSC/holder nulled, retired — payouts point at them) · `messages` / `dispute_messages` / `disputes.description`
→ `[erased]` · `reviews` (text → `[erased]`, tags cleared, **stars + sub-ratings kept**; their seller replies → `[erased]`) ·
`support_csat_responses.comment`, `support_tickets.subject`, `moderation_reports.details` · `listings` (archived; description,
location, AI metadata nulled; title → `[erased]` and photos purged **unless the listing is part of an order**) · role profiles
(`worker_profiles`, `sardar_profiles`, `vet_profiles`, `drone_pilots`, `ambassador_profiles`, `instructors`) · `ambassador_visits`,
`land_parcels`, `animals`, `mgnrega_job_cards`, `vet_bookings` (symptom text/voice) · draft `scheme_applications` · own DPDP export
jobs · `payments.webhook_payload` (gateway body: phone / email / VPA) · `staff_invites` / `partner_invites` phone on used invites
(→ `+10000000000`, admitted by a clause injected into their guards only for an erased person) · `setup_call_requests` masked tail +
notes · `cold_chain_breaches.buyer_decision_reason` · `risk_events.meta`.

**Kept as legal record, unchanged** (they hold ids and amounts; an opaque id is not personal data once the users row is a
tombstone): `ledger_entries`, `ledger_transactions`, `wallet_accounts` (zero balance), `audit_log`, `consents` (the consent LOG is
the evidence of lawful processing) — `blocked_by_law`; `orders`, `trade_invoices`, `payouts`, `settlement_statements`,
`cold_chain_logs`, `webhook_deliveries` — `archived` (kept until their retention rule). Every other table that references
`users(id)` (≈220, `ERASURE_REFERENCE_ONLY`) holds only the id as an actor / party / member and is kept; the coverage gate fails
on a users-referencing table that is in neither list.

**Media:** the person's photo, KYC scans, chat voice/attachments, vet voice notes and never-ordered listing photos are
soft-deleted (never presigned again — `MediaRepository.getVisible` filters `deleted_at`) and **storage deletion is recorded as
PENDING** (`media_assets.storage_purge_requested_at` / `storage_purge_reason`): the platform has no S3 delete path yet. Files another
party relies on (dispute exhibits, proof-of-delivery) are excluded.

**Known limits (stated, not hidden):** no storage purge job; no provider-side bank-token deactivation call; free text the person
typed into OTHER people's records (e.g. a buyer's order `cancel_note`, a loan application's `purpose_text`, a submitted scheme
application's form) is kept with the record; tenant contact fields that are not linked by user id (`tenants.owner_*`,
`tenant_applications.contact_*`) are not reached; the posture cut-off binds within its 30 s cache.
