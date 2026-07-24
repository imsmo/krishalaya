-- ============================================================================
-- MIGRATION 0067 — MODERATION/RISK PLATFORM TABLES: blocklists, risk_rules, appeals
-- (DELTA-021, DELTA-022, DELTA-024, DEV-04)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- GROUPING RATIONALE: these three deltas are grouped into one migration (contract §4 batch-sizing note: "no
-- batch exceeds ~4 migrations… still land one migration PR at a time even inside one batch" — grouping here is
-- about ONE reviewable file, not multiple PRs) because the schema backlog's own Tier-1 rationale line groups
-- them verbatim: "moderation safety (021/022/024)" — all three are admin/moderation console tables (W089-W098
-- realm, apps/web-admin/src/app/moderation/*), all three share the identical RLS-scope answer (platform, see
-- below), and all three are reviewed by the same founder pass in one sitting.
--
-- RLS DECISION (all three tables): PLATFORM-SCOPED — NO tenant_id column, matching the established precedent in
-- 0043_cells_ops.sql ("PLATFORM/god-mode (no tenant_id column) ⇒ the idempotent RLS pass skips them; operated
-- only by the RLS-bypassing kv_admin role, every action audited") and 0002_tenancy_billing.sql's feature_flags
-- (also no tenant_id, platform config). Because these tables have no tenant_id column, the idempotent
-- tenant-isolation DO-block at the end of this file (same block every migration since 0014) naturally SKIPS
-- them — v_tables_without_rls (0014_platform_ops_security.sql) only flags tables that HAVE a tenant_id column
-- and lack a policy, so these three do not appear as a coverage gap. Justification per table:
--   • platform_blocklists (DELTA-021): register's own words — "platform blocklists table" (device/IP/phone-hash
--     fraud-ring blocks), explicitly distinct from the existing tenant/user-scoped `user_blocks` (chat safety,
--     0015_audit_additions.sql) which stays as-is. A device/IP/phone-hash block is a platform-wide fact by
--     definition — a blocked device is blocked everywhere, not per-tenant.
--   • risk_rules (DELTA-022): register's own words — "risk_rules config table" — replaces the module-constant
--     event weights (`risk_events.weight`, itself already platform-scoped/nullable-tenant per 0003) with a
--     configurable row; scoring is a platform-wide policy, not a per-tenant one.
--   • appeals (DELTA-024): the W097 canon's OWN filed column list (quoted verbatim below) does not include a
--     tenant_id — appeals are reviewed by platform moderation staff across tenants, matching the same
--     cross-tenant operating model as blocklists/risk_rules above.
-- Access control for all three is RBAC-gated in the application layer (permissions named directly in the canon:
-- `risk.rules`, `risk.act`, `moderation.appeals`) plus the checker/maker-checker pattern the screens themselves
-- require (W095 "Submit change (checker)", W096 "Add block (checker)") — not a second RLS dimension.
--
-- PARTITION CONSIDERATION: none of the three need partitioning at this size — blocklists/appeals are
-- moderation-volume (hundreds, per the canon's own footer counts: "113 platform blocks", "7 pending appeals"),
-- risk_rules is a tiny config table (one row per event code). Revisit only if platform-wide block/appeal volume
-- reaches event-log scale (unlike risk_events, which already IS partitioned for exactly that reason).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DELTA-021 — platform_blocklists (W096-admin-blocklists)
-- Canon cite: SCREEN-DATA-CATALOG.md:10510. Canon columns read directly from W096-admin-blocklists.html:
--   tabs "device / ip_range / phone_hash" (identifier_type); table "Added / Identifier (hashed) / Origin /
--   Reason / Expiry / Attempts blocked"; footer alert: "Every block has an expiry or a review date — indefinite
--   blocks without review are prohibited. Identifiers stored hashed; raw device IDs/IPs never displayed after
--   entry." — identifier_hash is a SHA-256 (or equivalent) of the raw value; the RAW device id/IP/phone is
--   NEVER stored on this table (Law 10 / DPDP minimisation, same doctrine as business_kyc_profiles's masked
--   GSTIN/PAN, 0058).
-- ----------------------------------------------------------------------------
CREATE TABLE platform_blocklists (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  identifier_type   varchar(16) NOT NULL CHECK (identifier_type IN ('device','ip_range','phone_hash')),
  identifier_hash   varchar(128) NOT NULL,       -- SHA-256 of the raw device id / IP-CIDR / phone — RAW NEVER STORED
  origin_ref        varchar(60),                 -- risk cluster / dispute reference shown in canon, e.g. 'RSK-CL-0711-01'
  reason            varchar(300) NOT NULL,
  expires_at        timestamptz,                 -- NULL only when review_at is set — see CHECK below
  review_at         timestamptz,                 -- indefinite blocks MUST carry a review date (canon rule, enforced)
  attempts_blocked  integer NOT NULL DEFAULT 0,
  status            varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','lifted')),
  audit_note        text NOT NULL,               -- mandatory confirm-dialog note (W096 "Add block (checker)")
  checked_by        uuid REFERENCES users(id),   -- checker / second signer (maker-checker)
  CONSTRAINT chk_platform_blocklists_expiry_or_review CHECK (expires_at IS NOT NULL OR review_at IS NOT NULL)
);
CALL add_std_columns('platform_blocklists');
-- at most one ACTIVE block per identifier (re-blocking an already-active identifier is a no-op/extend, not a new row)
CREATE UNIQUE INDEX uq_platform_blocklists_active ON platform_blocklists(identifier_type, identifier_hash) WHERE status = 'active';
CREATE INDEX idx_platform_blocklists_type_added ON platform_blocklists(identifier_type, created_at DESC);

-- ----------------------------------------------------------------------------
-- DELTA-022 — risk_rules (W095-admin-risk-rules)
-- Canon cite: SCREEN-DATA-CATALOG.md:10509. Canon columns read directly from W095-admin-risk-rules.html's
-- "Event weights" table: event_code, Weight, Fired 30d (a live COUNT against risk_events, not stored here),
-- Notes; plus the dry-run/checker workflow ("Submit change (checker)", "every change is dry-run against
-- yesterday's population before it can ship"). Scope note: the canon's "Band thresholds" panel (trusted/
-- standard/caution/restricted/blocked) is NOT flagged backend-pending anywhere in the canon (only the event-
-- weights table carries the DELTA-022 banner) — so band thresholds are intentionally NOT schema'd here; that
-- would be inventing a shape the canon never filed as a gap.
-- ----------------------------------------------------------------------------
CREATE TABLE risk_rules (
  event_code      varchar(60) PRIMARY KEY,       -- same code space as risk_events.event_code (0003) — no FK: risk_events is
                                                  -- PARTITION BY RANGE(created_at) with a composite (id,created_at) PK, so a
                                                  -- normal FK target isn't available; event_code is a shared vocabulary key.
  weight          smallint NOT NULL,              -- current LIVE weight — the risk-scoring service reads this instead of
                                                  -- the module constant once wired (wiring itself is out of this migration's
                                                  -- scope: DEV-04 = schema only, per the founder's batch order).
  notes           varchar(300),
  is_active       boolean NOT NULL DEFAULT true,
  proposed_weight smallint,                       -- in-flight dry-run proposal (W095 "Submit change (checker)")
  proposed_by     uuid REFERENCES users(id),
  proposed_at     timestamptz,
  checked_by      uuid REFERENCES users(id),      -- checker who approved a weight change
  checked_at      timestamptz
);
CALL add_std_columns('risk_rules');

-- Seed the 4 stored event weights + 1 computed-bonus row shown in the W095 canon table verbatim, so the config
-- table starts in sync with today's module constants (same numbers the canon itself renders) rather than empty.
INSERT INTO risk_rules (event_code, weight, notes) VALUES
  ('same_ip_bidding', -30, 'per cluster, not per bid'),
  ('fake_listing', -40, 'confirmed only, never on flag alone'),
  ('duplicate_kyc', -35, 'same PAN/Aadhaar across accounts'),
  ('dispute_lost', -12, 'decays 50% after 6 months'),
  ('clean_history_bonus', 8, 'computed at scoring time (not a stored event) · +2/quarter, cap +8 · monthly')
ON CONFLICT (event_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- DELTA-024 — appeals (W097-admin-appeals)
-- Canon cite: SCREEN-DATA-CATALOG.md:10511. FILED SHAPE — copied verbatim from the W097 canon's own
-- backend-pending banner (W097-admin-appeals.html): "appeals table (id, subject_ref, appellant,
-- original_action_ref, assigned_to ≠ original_reviewer, status upheld|overturned, decided_at)". The canon's own
-- table view adds: SLA left (sla_due_at), the original action's description + reference, and (per the tabs)
-- a 'pending' interim status before the upheld|overturned outcome — status therefore has 3 values, not 2; the
-- filed shape's "upheld|overturned" describes the DECISION outcome, not the full lifecycle. No human-facing
-- reference-number generator (e.g. next_doc_number, 0001_foundation.sql §0.8) is added here — that mechanism is
-- keyed by tenant_id (which this platform-scoped table intentionally has none of) and generating one is an
-- app-layer display concern for a future build batch, not part of this filed shape.
-- ----------------------------------------------------------------------------
CREATE TABLE appeals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject_ref           varchar(120) NOT NULL,        -- filed shape column; e.g. 'listing:LST-2026-083907'
  subject_action        varchar(60) NOT NULL,          -- e.g. 'listing_removed','review_hidden','account_restricted'
  appellant             uuid NOT NULL REFERENCES users(id),  -- filed shape column ("appellant")
  original_action_ref   uuid,                          -- filed shape column; ref to the originating risk_event/moderation
                                                        -- action id — no formal FK (risk_events is partitioned; a normal
                                                        -- FK target isn't available across partitions, same reasoning as
                                                        -- risk_rules.event_code above)
  original_reviewer_id  uuid REFERENCES users(id),
  assigned_to           uuid REFERENCES users(id),      -- filed shape column; CHECK below enforces "≠ original_reviewer"
  status                varchar(12) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','upheld','overturned')),  -- filed shape enum + pending interim state
  sla_due_at            timestamptz NOT NULL,           -- canon: "SLA 48h"
  decision_reason       text,                            -- shown to the appellant even when upheld (canon: "every closed
                                                          -- appeal shows its reasoning to the appellant — even upheld ones")
  decided_at            timestamptz,                     -- filed shape column
  CONSTRAINT chk_appeals_reviewer_neq CHECK (assigned_to IS NULL OR original_reviewer_id IS NULL OR assigned_to <> original_reviewer_id)
);
CALL add_std_columns('appeals');
CREATE INDEX idx_appeals_status_sla ON appeals(status, sla_due_at) WHERE status = 'pending';
CREATE INDEX idx_appeals_appellant ON appeals(appellant, created_at DESC);

-- RLS — re-run the idempotent tenant-isolation pass. All three tables above have NO tenant_id column, so this
-- pass correctly SKIPS them (see the RLS DECISION note at the top of this file) — kept here only for the
-- convention every migration since 0014 follows, in case a future migration in this same file ever adds a
-- tenant-scoped table that needs it.
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
