-- ============================================================================
-- MIGRATION 0071 — AEPS SERVICE EVENTS (DELTA-045, DEV-05)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md): "`aeps_service_events` table (AePS service log;
-- commission stays bank-side)". Canon detail (read directly, W390-ops-aeps-home.html, W391-ops-aeps-withdrawal.html,
-- W392-ops-aeps-exceptions.html):
--   • W390: "aeps_enabled: true" surfaced from `ambassador_profiles.aeps_enabled` (0013_growth_intelligence.sql —
--     already exists, confirmed) — "a kiosk without it never shows these screens (absence, not locks)". 118
--     AePS transactions, ₹2,86,400 disbursed, avg ₹2,427.12/txn. "Commission accrues BANK-SIDE, not to
--     ambassador_earnings — commission is the bank's ledger; this platform records the service event only
--     (DELTA-045 aeps_service_events)" — the table is a LOG, never a money-moving primitive of its own.
--   • W391 (withdrawal): customer + masked bank details ("Bank of Baroda a/c XXXXXX••27", "Aadhaar
--     XXXX-XXXX-••41"), amount requested, ₹10,000 per-transaction cap (NPCI/bank-set, not hardcoded here — a
--     business rule that can change without a migration), up-to-3 finger-retry rule, "no OTP fallback", balance
--     before/after (bank-reported, informational only — the money itself never touches a Krishalaya ledger).
--   • W392 (exceptions log): every non-straight-through scan in order — device-not-RD-certified (BLOCKS, kiosk
--     auto-switches to backup certified device), finger-fail×3 (money stays untouched, retry with a different
--     finger, escalate to nearest bank mitra/branch), bank-server-down (auto-retried, money untouched).
--   • W393 (receipt, referenced but not itself a DELTA row): "receipt = promise's twin; masks verbatim" — the
--     bank/NPCI reference number (RRN) is what a receipt reconciles against → `npci_rrn`.
--
-- FK-TARGET VERIFICATION: the kiosk actor is an ambassador — `ambassador_profiles` (0013_growth_intelligence.sql,
-- NOT partitioned, already carries `aeps_enabled boolean` — confirmed existing, no new column needed there).
-- The AePS CUSTOMER (Jashoda Ben R. on W391) is a walk-in bank customer using HER OWN bank account via Aadhaar +
-- fingerprint — she may or may not already be a Krishalaya platform `users` row (AePS doesn't require platform
-- registration, only an Aadhaar-linked bank account) — `customer_user_id` is therefore NULLABLE, mirroring
-- `ambassador_visits.visited_user_id`'s own "NULL = prospect not yet onboarded" doctrine (0047_ambassador_visits_targets.sql).
--
-- PII CARE (Law 10 / contract §3.10 — AePS touches Aadhaar-adjacent biometric flows): NO raw Aadhaar, NO
-- fingerprint template/image, ever. Mirrors the `ekyc_sessions` masking doctrine (0050) exactly:
--   • `aadhaar_last4` — last four digits ONLY (same shape as `ekyc_sessions.last4`); the canon's own kiosk-screen
--     render masks even further down to the last TWO digits ("XXXX-XXXX-••41") — that stricter on-screen mask is
--     an APPLICATION-layer rendering rule on top of this column (same reasoning DEV-04 documented for
--     `field_verifications.geotag`: full-precision storage, always-masked render, two different concerns).
--   • `account_last4` — mirrors `bank_accounts.account_last4` (0003) — never a full account number.
--   • The fingerprint itself is NEVER captured by this platform at all (W390's own doctrine banner: "Your
--     fingerprint travels encrypted from this device to your bank via NPCI/UIDAI — Krishalaya never sees it,
--     never stores it, and could not replay it if it wanted to") — there is deliberately NO column for it, not
--     even masked; this is an absence, not a masking exercise.
--   • No OTP column either (AePS explicitly has "no OTP fallback" per canon) — nothing to mask there.
--
-- MONEY (Law 2): `amount_minor` is `bigint` (NULL for `balance_enquiry`, required in practice for `cash_withdrawal`
-- at the app layer — not a NOT NULL column here since `mini_statement`/`balance_enquiry` legitimately carry no
-- amount) + explicit `currency_code`. The ₹10,000 per-transaction cap is a bank/NPCI-set business rule shown "before
-- you start" (W391) — deliberately NOT a CHECK constraint (a cap that can change without a schema migration).
-- `balance_after_minor` is bank-reported and informational ONLY — this table never becomes a second source of
-- truth for the customer's actual bank balance, and (per the filed shape's own words) commission/settlement stays
-- entirely on the bank's side, never touching `wallet_accounts`/`ledger_entries` — no ledger_txn_id correlation
-- column is added here (unlike kcc_drawl_ledger, 0069) because there genuinely is no Krishalaya money movement
-- to correlate against; inventing one would misrepresent the doctrine this delta exists to encode.
--
-- RLS DECISION: TENANT-SCOPED, RLS ON via the idempotent pass below — every kiosk event happens under exactly one
-- tenant's kiosk (`tenant_id NOT NULL`), same reasoning as kcc_drawl_ledger (0069).
--
-- PARTITION CONSIDERATION: PARTITIONED — `PARTITION BY RANGE (occurred_at)`, composite `(id, occurred_at)` PK,
-- `bigserial` id — founder brief calls this out explicitly as a "high-volume event table — real partition
-- decision needed," same class as `risk_events`/`shipment_events`/`ledger_entries` (unbounded growth: every AePS
-- kiosk transaction across the eventual ambassador network, Rule Zero/Law 11 scale honesty — this is NOT the
-- bounded-per-alert shape of `price_alert_triggers`, 0059). Following the same hot-table FK convention as 0069,
-- `tenant_id`/`ambassador_id`/`customer_user_id` are plain `uuid` — app-validated, no FK declared. `CALL
-- ensure_partitions(3);` at the foot of this file gives it immediate current+future partitions the same way 0069
-- does for `kcc_drawl_ledger`.
--
-- APPEND-ONLY (partial, NOT full LEDGER-class): the service OUTCOME fields (status/exception/amount/etc.) are
-- never mutated once written — but `synced_at` legitimately gets a later UPDATE when the kiosk's offline-first
-- device syncs its locally-recorded event log to the platform backend (the "✓ synced 2 min ago" chip on W390) —
-- this is a RECORD-sync of an already-real bank transaction, not a queued MONEY action (Golden Law 6 concerns the
-- money action itself, which already happened in real time against the bank via NPCI; the kiosk syncing its own
-- activity log afterwards is content, not money, exactly the Law 6 carve-out for non-money queued state). Mirrors
-- the `outbox_events` restricted-column-update precedent (0014: `GRANT UPDATE (status, published_at) ON
-- outbox_events TO kv_app;`) — `REVOKE UPDATE ... GRANT UPDATE (synced_at) ...` below.
-- ============================================================================

CREATE TABLE aeps_service_events (
  id                  bigserial,
  tenant_id           uuid NOT NULL,            -- app-validated against tenants.id — no FK (partitioned/hot-table convention, see above)
  ambassador_id       uuid NOT NULL,            -- app-validated against ambassador_profiles.id (aeps_enabled=true) — no FK
  customer_user_id    uuid,                     -- NULLABLE: walk-in bank customer may not be a platform user (mirrors
                                                 -- ambassador_visits.visited_user_id, 0047)
  service_kind        varchar(20) NOT NULL DEFAULT 'cash_withdrawal'
                      CHECK (service_kind IN ('cash_withdrawal','balance_enquiry','mini_statement')),
  bank_name           varchar(120),             -- customer's OWN bank (e.g. 'Bank of Baroda') — never Krishalaya's
  account_last4       varchar(4),               -- masked; mirrors bank_accounts.account_last4 (0003) — never the full account no
  aadhaar_last4       varchar(4),               -- masked; mirrors ekyc_sessions.last4 (0050) doctrine — NEVER raw Aadhaar,
                                                 -- NEVER any fingerprint material (Law 10)
  amount_minor        bigint,                   -- NULL for balance_enquiry; Law 2 minor units where applicable
  currency_code       char(3) NOT NULL DEFAULT 'INR',
  balance_after_minor bigint,                   -- bank-reported, informational only (commission/settlement stays bank-side)
  status              varchar(16) NOT NULL DEFAULT 'success'
                      CHECK (status IN ('success','failed','declined','blocked')),
  exception_code      varchar(30)
                      CHECK (exception_code IN ('device_not_rd_certified','finger_fail','bank_server_down','cap_exceeded','bank_declined')
                             OR exception_code IS NULL),
  attempt_no          smallint NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 3),  -- 3-attempt dignity rule (W391/W392)
  device_certified    boolean NOT NULL DEFAULT true,   -- RD-certified device check result at time of txn
  npci_rrn            varchar(40),              -- bank/NPCI reference number (receipt reconciliation, W393)
  escalation_note      varchar(200),            -- nearest bank mitra/branch name+distance on 3-strike fail (W392)
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  synced_at           timestamptz,              -- kiosk offline-first sync landing time (W390 "✓ synced 2 min ago")
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX idx_aeps_events_ambassador ON aeps_service_events(ambassador_id, occurred_at DESC);
CREATE INDEX idx_aeps_events_tenant_status ON aeps_service_events(tenant_id, status, occurred_at DESC);
CREATE INDEX idx_aeps_events_exceptions ON aeps_service_events(tenant_id, occurred_at DESC) WHERE exception_code IS NOT NULL;

-- Pre-create partitions for aeps_service_events BEFORE the RLS pass below — same self-fix as 0069
-- (kcc_drawl_ledger): calling ensure_partitions() before the idempotent RLS DO block means the block's per-table
-- scan enumerates every already-created monthly child individually and gives each one its own explicit
-- tenant_isolation policy row, matching 0014_platform_ops_security.sql's own internal ordering. This migration
-- was never applied to any shared/tracked database — plain file edit, not a mutation of an applied migration.
CALL ensure_partitions(3);

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant table (partitioned parent — the CALL
-- above means every already-created monthly child is enumerated and policy-covered individually too).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;

-- Restricted-column-update physics (mirrors outbox_events, 0014): the service-outcome fields are write-once;
-- only the offline-sync landing timestamp is ever updated after insert. Applied AFTER the RLS pass, targeting
-- the parent relation (grants apply transparently to all its partitions).
REVOKE UPDATE, DELETE ON aeps_service_events FROM kv_app;
GRANT UPDATE (synced_at) ON aeps_service_events TO kv_app;

-- [DEV-05 self-fix, pre-apply] same sequence-grant gap as kcc_drawl_ledger (0069) — `id bigserial` needs its own
-- USAGE grant since 0014's blanket sequence grant + ALTER DEFAULT PRIVILEGES never covered sequences created by
-- a later migration.
GRANT USAGE, SELECT ON SEQUENCE aeps_service_events_id_seq TO kv_app;
