-- ============================================================================
-- MIGRATION 0123 — A PUBLIC SINK THAT VERIFIES AND FORGETS, A CIRCUIT NOBODY OUTSIDE THE POD CAN SEE, AND A
-- KEY REGISTRY TWO MIGRATIONS OLD THAT NO CODE HAS EVER TOUCHED (PC-56 ADMIN-11c)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: FOUR UNAUTHENTICATED PUBLIC SINKS VERIFY A SIGNATURE AND THROW THE BYTES AWAY
-- ---------------------------------------------------------------------------
-- W106 states it as a property of the platform: "**Raw payloads stored pre-processing (inbound_webhooks,
-- partitioned) — replayable, audit-grade. Failed signatures are ignored, never processed.**" And it shows an inbound
-- log with a signature verdict per callback, plus a headline count of "inbound signature failures 24h · all from one
-- stale Gupshup secret".
--
-- `inbound_webhooks` was created in migration 0015. `grep -rln "inbound_webhooks" apps packages --include=*.ts`
-- returns NOTHING. Not a reader, not a writer, not a test.
--
-- Meanwhile the sinks themselves are good: `payment-webhooks.controller.ts` verifies an HMAC over `req.rawBody`,
-- `delivery-webhook.controller.ts` does a constant-time compare and fails closed when the secret is unconfigured. They
-- verify correctly **and then the request is gone.** Which means:
--
--   • a REJECTED signature leaves no trace at all. The one event that most needs a record — somebody signing with the
--     wrong secret, or forging — is the one this platform cannot see. "All from one stale Gupshup secret" is a
--     diagnosis that requires exactly the rows nobody writes.
--   • an ACCEPTED payment callback leaves only its EFFECT. When Razorpay says "we told you at 15:03" and this platform
--     has no capture, there is nothing to compare. **That is a money dispute with no evidence on our side**, and the
--     gateway's word against ours.
--   • nothing is replayable. A processing bug means the events are lost, not re-runnable.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: THE CIRCUIT-BREAKER COLUMN CANNOT BE FILLED FROM WHERE THE CONSOLE STANDS
-- ---------------------------------------------------------------------------
-- W007 shows a Circuit column (closed / half-open / open) and a Fallback column ("voice-OTP (active)"), with
-- "circuit breakers + fallbacks live (degrade, never die)" as the subtitle. The breakers ARE live and correct
-- (`core/resilience/circuit-breaker.ts`) — and they are **in-memory, per-process, inside apps/api**. The console reads
-- admin-api, a different process with a different pool; it could not see a breaker's state even if there were one pod,
-- and at scale there are many. `msg91 half-open` is one pod's opinion.
--
-- **SO THE HONEST FIX IS NOT TO SCRAPE A STATE, IT IS TO PUBLISH THE TRANSITIONS.** A breaker's state changes rarely by
-- construction (that is what a failure threshold is for), so a row per transition per instance is cheap — it is not a
-- hot-path write, and this file would refuse one that was. What an operator actually needs is in the transitions
-- anyway: W007's own alert reads "msg91 degraded since 13:40 IST", "razorpay circuit open after 12 consecutive 5xx" —
-- a time and a count, which is a transition record, not a gauge.
--
-- **AND p95 LATENCY AND ERROR RATE STILL HAVE NO SOURCE.** Nothing persists a per-call sample; `metrics.inc()` feeds a
-- Prometheus registry scraped out-of-band, which admin-api does not read. Those two columns are rendered as ABSENT
-- rather than approximated from what this file adds — a consecutive-failure count at the moment a breaker opened is not
-- an error rate, and printing it as one would be the defect this programme has found six times. ADMIN-11c-Q1.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: `api_keys` HAS EXISTED SINCE MIGRATION 0002 AND NO CODE HAS EVER TOUCHED IT
-- ---------------------------------------------------------------------------
-- W106: "Cross-tenant oversight of tenant-owned keys and endpoints (PRD §36)", with "Active keys 412 across 186
-- tenants" as its first figure and "keys are tenant-created from their console" in its empty state.
--
-- `grep -rn "[^_]api_keys\b" apps packages --include=*.ts` returns NOTHING — and neither does a search of the seeds.
-- There is no issuance route, no gateway that authenticates one of these keys, no `last_used_at` stamp, no revoke, and
-- no tenant console screen. The table, its `key_hash` column and its partial index have been carried by twenty-one
-- migrations without a single row ever being written by this platform.
--
-- **AND THERE IS A LIVE KEY PLANE — A DIFFERENT ONE.** PC-55 A10 built `partner_api_keys`: hashed, scoped,
-- rate-limited, `last_used_at` stamped once a minute, revocable, and enforced by a real guard. So the oversight screen
-- this wave builds covers BOTH registries and says which is which, because a console that showed one number over both
-- would be reporting a live partner integration and a dormant table as the same fact. Naming the empty one is the
-- point: it is a promise in the schema that no realm has kept.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ALREADY TRUE, AND IS NOT REBUILT HERE
-- ---------------------------------------------------------------------------
-- OUTBOUND webhooks are real and good: `webhook_endpoints` + `webhook_deliveries` (partitioned), enqueued in-tx by the
-- fanout handler, delivered by `apps/worker/src/jobs/webhook-delivery.job.ts` under the leader lock with AES-256-GCM
-- secret unwrapping, an HMAC-SHA256 Stripe-style signature, an 8-second timeout, exponential backoff and a hard stop
-- at 8 attempts, with SSRF enforced at registration and https re-checked before the request. W106's "retry backlog"
-- and "96.8% delivery success" read that table directly. Nothing about it needed changing, and this file changes
-- nothing about it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 123.1  THE BREAKER TRANSITION LOG — the only honest source for W007's Circuit column
-- ---------------------------------------------------------------------------
CREATE TABLE provider_circuit_events (
  id            bigserial,
  -- The resilience dependency key ('razorpay', 'msg91', 'opensearch', 'wallet'). NOT an FK to
  -- `integration_providers`: some dependencies are internal (opensearch, wallet) and are not third-party providers at
  -- all, and a foreign key would either exclude them or force fake registry rows for infrastructure.
  dep           varchar(60) NOT NULL,
  -- Resolved where a mapping exists, so the console can group by provider. Deliberately nullable.
  provider_code varchar(60) REFERENCES integration_providers(code),
  from_state    varchar(10) NOT NULL CHECK (from_state IN ('closed', 'open', 'half_open')),
  to_state      varchar(10) NOT NULL CHECK (to_state IN ('closed', 'open', 'half_open')),
  -- W007's alert sentence is "razorpay circuit open after 12 consecutive 5xx" — the count AT THE MOMENT IT OPENED.
  -- This is not an error rate and this file does not pretend it is one.
  consecutive_failures integer CHECK (consecutive_failures IS NULL OR consecutive_failures >= 0),
  -- **WHICH POD SAID SO.** A breaker is per-process, so without this column a reader would see one pod's opinion
  -- presented as the platform's — and with it the console can say "3 of 8 instances have this breaker open", which is
  -- the true shape of a distributed circuit and the one an operator can act on.
  instance_id   varchar(80) NOT NULL,
  app           varchar(30) NOT NULL DEFAULT 'api',
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- The console's live view: what is open now, newest first, per dependency.
CREATE INDEX idx_pce_dep ON provider_circuit_events(dep, occurred_at DESC);
-- The incident view: every opening across all dependencies in a window.
CREATE INDEX idx_pce_opened ON provider_circuit_events(occurred_at DESC) WHERE to_state = 'open';

-- kv_app INSERTS (apps/api owns the breakers) and reads back nothing: a transition log the writing process can also
-- rewrite is a log that proves nothing about the writing process. kv_admin reads only — the same rule 0119, 0120 and
-- 0121 applied to their evidence tables.
REVOKE ALL ON provider_circuit_events FROM kv_relay;
REVOKE UPDATE, DELETE, TRUNCATE ON provider_circuit_events FROM kv_app, kv_admin;
GRANT INSERT, SELECT ON provider_circuit_events TO kv_app;
GRANT USAGE, SELECT ON SEQUENCE provider_circuit_events_id_seq TO kv_app;
GRANT SELECT ON provider_circuit_events TO kv_readonly;
-- No RLS: a circuit breaker is platform infrastructure with no tenant dimension. Stated because every other table
-- kv_app writes in this codebase has one, and its absence here should read as a decision rather than an omission.

-- ---------------------------------------------------------------------------
-- 123.2  THE DECLARED DEPENDENCY MAP — so W007's Fallback column names something real
-- ---------------------------------------------------------------------------
-- `withFallback()` takes the fallback as a per-call-site ARGUMENT, so there is nowhere to read "msg91 falls back to
-- voice-OTP" from. This table is that declaration — and it is labelled DECLARED everywhere it is rendered, because a
-- declaration is a statement of intent about code, not an observation of it.
CREATE TABLE provider_dependencies (
  dep           varchar(60) PRIMARY KEY,
  provider_code varchar(60) REFERENCES integration_providers(code),
  display_name  varchar(120) NOT NULL,
  category      varchar(40) NOT NULL,
  -- The strategy in the words W007 uses: 'queue + retry', 'voice-OTP', 'cached (≤6h stale)', 'manual review queue'.
  -- NULL = there is no fallback, which is a meaningful value and not a missing one.
  fallback_strategy varchar(120),
  -- **A MONEY CALL MUST NEVER HAVE A FALLBACK** — `ResilienceService.run` throws when `money: true` is passed with one,
  -- because a failed debit must fail rather than silently "succeed". Recorded here so the console can show that the
  -- blank in the Fallback column is a RULE and not an omission, and so the CHECK below can hold the two consistent.
  is_money      boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_pd_money_has_no_fallback CHECK (is_money = false OR fallback_strategy IS NULL)
);
CALL add_std_columns('provider_dependencies');

REVOKE ALL ON provider_dependencies FROM kv_relay;
GRANT SELECT ON provider_dependencies TO kv_app, kv_readonly;

-- Seeded from the dependency keys that actually appear in `resilience` call sites and the fallbacks those call sites
-- pass. Read out of the code, not invented — a row here for a dependency nothing calls would be this table telling the
-- same lie the screen was telling.
INSERT INTO provider_dependencies (dep, provider_code, display_name, category, fallback_strategy, is_money) VALUES
  ('razorpay',   'razorpay', 'Razorpay — payments + payouts',      'payment',    NULL,                 true),
  ('razorpayx',  'razorpay', 'RazorpayX — payouts',                'payment',    NULL,                 true),
  ('wallet',     NULL,       'Wallet service (internal)',          'internal',   NULL,                 true),
  ('msg91',      'msg91',    'MSG91 — DLT SMS / OTP',              'sms',        'voice-OTP',          false),
  ('opensearch', NULL,       'OpenSearch (internal)',              'internal',   'database query',     false),
  ('agmarknet',  'agmarknet','Agmarknet — mandi price feed',        'government', 'cached (≤6h stale)', false)
ON CONFLICT (dep) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 123.3  INBOUND EVIDENCE — the columns a receipt needs to be evidence
-- ---------------------------------------------------------------------------
ALTER TABLE inbound_webhooks
  -- **A SIGNATURE VERDICT IS THREE-VALUED AND THE THIRD VALUE MATTERS.** `signature_ok` already exists and is nullable;
  -- what it could not say is WHY. "No signature header at all" is a different event from "a signature that did not
  -- match": the first is usually a misconfigured caller, the second is a stale secret or a forgery, and W106's whole
  -- diagnosis ("all from one stale Gupshup secret") depends on telling them apart.
  ADD COLUMN signature_reason varchar(40)
    CHECK (signature_reason IS NULL OR signature_reason IN
      ('ok', 'absent', 'mismatch', 'secret_unconfigured', 'unsupported_provider', 'unparseable')),
  -- The size of what arrived, and whether what is stored is all of it. **AN UNAUTHENTICATED SINK IS AN UNBOUNDED WRITE
  -- PATH**: recording a rejected payload is exactly what this migration is for, and it is also how a stranger fills
  -- this table. The recorder caps the stored bytes and sets `truncated` — so the row is honest about being partial
  -- rather than silently short, which for a replay would be the worst of both.
  ADD COLUMN raw_bytes     integer CHECK (raw_bytes IS NULL OR raw_bytes >= 0),
  ADD COLUMN truncated     boolean NOT NULL DEFAULT false,
  -- Who sent it. An inet, not a string: the question asked of this column is "was it in the provider's range".
  ADD COLUMN source_ip     inet,
  -- Ties the row to the request in the logs and to the audit trail.
  ADD COLUMN request_id    varchar(64),
  -- The delivery id the provider itself used, where it sends one (Razorpay's `x-razorpay-event-id`). This is what makes
  -- "you told us twice" and "we processed it twice" separable.
  ADD COLUMN provider_event_id varchar(150);

-- The failure worklist W106's headline counts: rejected signatures, newest first, per provider.
CREATE INDEX idx_inwh_sig_failed ON inbound_webhooks(provider_code, created_at DESC)
  WHERE signature_ok = false;
-- Provider-side dedup lookups.
CREATE INDEX idx_inwh_provider_event ON inbound_webhooks(provider_code, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- **THE 0014 TRAP AGAIN.** `inbound_webhooks` was created in 0015 — one migration AFTER the ALTER DEFAULT PRIVILEGES
-- that silently grants kv_app SELECT/INSERT/UPDATE on everything new — so apps/api has held UPDATE on this evidence
-- table for a hundred migrations without needing it. It needs INSERT (the recorder) and UPDATE of the processing
-- status; it must never be able to DELETE a receipt, and neither must the admin realm.
REVOKE ALL ON inbound_webhooks FROM kv_relay;
REVOKE DELETE, TRUNCATE ON inbound_webhooks FROM kv_app, kv_admin;
REVOKE INSERT, UPDATE ON inbound_webhooks FROM kv_admin;   -- the god-mode realm READS this evidence, never writes it
GRANT INSERT, UPDATE, SELECT ON inbound_webhooks TO kv_app;
GRANT SELECT ON inbound_webhooks TO kv_readonly;

-- **AND THE PAYLOAD IS PII.** A Razorpay capture carries the payer's contact and email; a delivery callback carries a
-- phone number. This is a raw-payload archive with no tenant column and no erasure hook, so its retention has to be a
-- fact recorded somewhere a reviewer will find it rather than a habit.
COMMENT ON COLUMN inbound_webhooks.payload IS
  'Raw provider callback body, stored PRE-processing so a receipt exists whether or not the signature verified (0123). CONTAINS PII (payer contact/email, phone numbers): 90-day retention, enforced by the retention job; a DSR erasure cannot reach it by subject id, which is recorded as ADMIN-11c-Q3 rather than pretended otherwise.';

-- ---------------------------------------------------------------------------
-- 123.4  THE REVOKE CHAIN W106 DESCRIBES
-- ---------------------------------------------------------------------------
-- "Revoking kv_live_f7e1… takes effect within 60s at the gateway. The tenant is notified with a re-issue path;
-- scheduled jobs using this key will fail closed. Reason * ... This action is recorded · api_keys.revoked_at · tenant
-- notified." `revoked_at` exists. The REASON and the ACTOR did not, and a revocation with neither is an outage whose
-- cause nobody can look up.
ALTER TABLE api_keys
  ADD COLUMN revoked_reason varchar(300),
  ADD COLUMN revoked_by_admin_id uuid,
  -- **THE REALM-IDENTITY PROBLEM, ELEVENTH OCCURRENCE.** `revoked_by_admin_id` carries no FK: platform operators live
  -- in `platform_operators` in the ADMIN database (0118), a different database from this one, so the reference is
  -- recorded and cannot be enforced. Stated rather than left for a reader to notice.
  ADD CONSTRAINT ck_api_keys_revocation_recorded CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL) NOT VALID;
-- NOT VALID because a row revoked before this migration (there are none — nothing has ever written this table — but
-- the shape must be right for the day something does) would otherwise block the migration.

-- The oversight list's own query: keys by tenant, newest first, revoked ones visible.
CREATE INDEX idx_api_keys_oversight ON api_keys(tenant_id, created_at DESC);

-- The tenant-facing half of "the tenant is notified with a re-issue path". Rides the notification spine, with
-- `user_can_opt_out = false`: being told that an integration credential was revoked is not a preference, it is the
-- reason their jobs started failing.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('api_key.revoked', 'API key revoked', 'critical', '["email","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
  ('api_key.revoked', 'key_prefix', 'api_keys.key_prefix',    'kv_live_f7e1', true),
  ('api_key.revoked', 'reason',     'api_keys.revoked_reason', 'unused for 100 days', true)
ON CONFLICT (event_code, name) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
  ('api_key.revoked', 'inapp', 'en', NULL, 'API key {{key_prefix}} was revoked',
   'API key {{key_prefix}} has been revoked by the platform. Reason: {{reason}}. Any integration or scheduled job using it will now fail closed. Create a replacement key in your console and update your integration.',
   NULL, true),
  ('api_key.revoked', 'email', 'en', NULL, 'Your Krishalaya API key was revoked',
   'API key {{key_prefix}} has been revoked by the platform. Reason: {{reason}}. Any integration or scheduled job using it will now fail closed. Create a replacement key in your console and update your integration.',
   NULL, true)
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

-- 0122 versioned template wording: these two rows need their version 1, or they resolve to nothing and the notice this
-- migration exists to send would be recorded as `no_template`. **A SEEDED TEMPLATE THAT SKIPS VERSIONING IS SILENT**,
-- which is exactly the failure the previous wave's send-time gate introduced by design — so the gate has to be fed.
INSERT INTO notification_template_versions (
  template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
  provider_template_ref, body_sha256, lifecycle, needs_second_person, approved_at, reason)
SELECT t.id, NULL, t.event_code, t.channel, t.language_code, 1, t.subject, t.body, NULL,
       encode(digest(t.body, 'sha256'), 'hex'), 'approved', true, now(),
       'Seeded with 0123 alongside the api_key.revoked event: platform-authored security copy, approved on insert.'
  FROM notification_templates t
 WHERE t.event_code = 'api_key.revoked' AND t.tenant_id IS NULL
ON CONFLICT (template_id, version_no) DO NOTHING;

UPDATE notification_templates t
   SET serving_version_id = v.id
  FROM notification_template_versions v
 WHERE v.template_id = t.id AND v.version_no = 1
   AND t.event_code = 'api_key.revoked' AND t.serving_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- 123.5  PARTITIONS
-- ---------------------------------------------------------------------------
-- `provider_circuit_events` is `PARTITION BY RANGE (occurred_at)` and the console reads it on every load.
-- `ensure_partitions()` (0014, SECURITY DEFINER since 0053, privilege-syncing since 0077) discovers partitioned tables
-- dynamically, so this is a no-op where partitions exist and a repair where they do not — the 0069/0115 precedent. It
-- also propagates the grants above to each child, which matters here because 0077 established that a new partition is a
-- brand-new relation and does NOT inherit the parent's privileges: without this call, kv_app's INSERT would land on a
-- parent it may write and a child it may not, and the first breaker to trip would fail its own recording.
CALL ensure_partitions(3);

-- ---------------------------------------------------------------------------
-- 123.6  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO LATENCY OR ERROR-RATE STORE.** W007's p95 and 1h error-rate columns have no source and are rendered as absent.
-- A per-call sample table on the path to every external dependency is a write per outbound call, which at this
-- platform's target scale is a self-inflicted wound; the right shape is an in-process rollup flushed periodically, and
-- that is a build of its own. ADMIN-11c-Q1.
--
-- NO ACTIVE HEALTH PROBE. W007 says "health probes every 30s" and nothing probes anything. A prober that calls a
-- payment gateway every thirty seconds is a design decision with a bill attached (and, for KYC providers, a compliance
-- question), so it is named rather than assumed. ADMIN-11c-Q2.
--
-- NO ERASURE HOOK ON `inbound_webhooks`. The payload is PII and has no subject id, so a DSR erasure cannot reach it;
-- retention is the only control, and it is now written on the column. ADMIN-11c-Q3.
--
-- NO KEY ISSUANCE. `api_keys` gains a revoke chain and oversight, and it still has no issuer — W106's own empty state
-- says "keys are tenant-created from their console" and that console screen does not exist in apps/web-tenant. Building
-- issuance from the GOD-MODE realm would be the wrong realm for it (Law 11: the platform does not create a tenant's
-- credentials), so the gap is named and the console says which registry is live. ADMIN-11c-Q4.
--
-- NO WEBHOOK SECRET ROTATION. W106's inbound log references "stale secret — rotation ticket PRV-0713-02 open", and
-- provider secrets live in AWS Secrets Manager by reference (`integration_credentials.secret_ref`), so a rotation is an
-- act in another system. What this file makes possible is knowing a secret is stale, which is the half that was
-- missing. ADMIN-11c-Q5.
