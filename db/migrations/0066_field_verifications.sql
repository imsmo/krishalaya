-- ============================================================================
-- MIGRATION 0066 — FIELD VERIFICATIONS (gov site-visit capture, DELTA-040, DEV-04)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): Development_Program/DESIGN_DRIVEN_SCHEMA_BACKLOG.md row DELTA-040 —
--   "field_verifications table (officer_id, geotag, measured_values, walk_trace, farmer_otp_signoff)"
--   Canon cite: DP2_TRACKER.md:777; SCREEN-DATA-CATALOG.md:10857-10859 — screens W335 (gov-verification-queue),
--   W336 (gov-verification-case), W337 (gov-verification-visit). Column names below are copied from the filed
--   shape verbatim (officer_id, geotag, measured_values, walk_trace, farmer_otp_signoff); the canon screens
--   themselves (read directly, W337) supply the field-level detail used to size each column:
--     • W337 step 1: 3 geotagged photos per visit, each with lat/lng + capture time (rounded ~1km for display,
--       full precision checked server-side) → geotag is a jsonb ARRAY of {media_id, lat, lng, captured_at}.
--     • W337 step 2 "Measured coverage": GPS walk result (ha) vs approved (ha), walk trace attached, and the
--       farmer-facing recomputed instalment arithmetic shown before signing → measured_values jsonb captures
--       {measured_ha, approved_ha, recomputed_amount_minor, currency_code}; walk_trace is a media reference
--       (the GPS track file), kept as its own column per the filed shape's own naming.
--     • W337 step 4 "Farmer sign-off … pending OTP": "OTP goes to the FARMER's registered phone … No OTP, no
--       submission." The farmer can also dispute the measurement right there ("the dispute path opens right
--       here, and the disagreement rides with the record").
--     • W335/W337 "Officer-of-record only": only the assigned officer's device may capture; a supervisor can
--       reassign, and the reassignment is recorded — reassigned_from captures that trail.
--
-- [QA-FIX 2026-07-23]: shape-fidelity three-way compare (backlog ↔ DDL ↔ canon) found W336's own denied-state
-- copy (two occurrences: "Reassignment is the supervisor's action, recorded with a reason") renders a REASON for
-- the reassignment that reassigned_from alone doesn't carry (it only names WHO reassigned, not WHY). Added
-- reassignment_reason (text) below — trivially additive, migration still unapplied/PR-stage, fixed pre-merge
-- per contract §7 ("no silent invention" cuts both ways: a canon-rendered field the DDL is missing is a defect
-- too, not just an invented one). No other field-vocabulary gaps found in this three-way compare.
--
-- PII CARE (Law 10 / contract §3.10): the farmer's OTP is NEVER stored raw or hashed on this table — mirrors
-- the ekyc_sessions pattern (0050_ekyc_sessions.sql), which stores only a STATE MACHINE, never the credential
-- itself. `farmer_otp_signoff` is a STATUS enum only (pending → sent → verified | disputed); the OTP challenge
-- and its verification happen through the identity module's existing OTP channel (auth.otp, seeded in
-- db/seeds/core/0007) — only the resulting outcome state lands here. geotag coordinates are stored at full
-- precision (server-side check against the parcel polygon needs it) but are NEVER rendered full-precision to
-- any client — the canon's own "shown rounded to about 1 kilometre" rule is an APPLICATION-layer masking rule
-- on top of this column, not a schema concern; noted here so a future reader doesn't assume the column implies
-- an unmasked-render entitlement.
--
-- RLS DECISION: TENANT-SCOPED (tenant_id NOT NULL, standard tenant_isolation policy via the idempotent RLS pass
-- below) — same class as business_kyc_profiles (0058) / ekyc_sessions (0050). Rationale: a field verification
-- always hangs off a scheme_applications row, which is itself tenant-owned (scheme_applications.tenant_id NOT
-- NULL, 0011); the officer operates inside that tenant's context. The additional "own beat only" / "own taluka"
-- narrowing the W335 canon describes (field officer vs supervisor vs district coordinator) is an RBAC/scope
-- concern layered in the application/service layer on top of tenant RLS, not a second database-level dimension
-- — no beat/taluka table exists yet to FK against, and inventing one is out of this delta's filed scope.
--
-- PARTITION CONSIDERATION: NOT partitioned. This is a bounded, low-cardinality-per-tenant operational table (one
-- row per scheme-application site visit, not a high-frequency event/log stream) — unlike risk_events/price_alert
-- history, it does not grow with request volume. Revisit only if a future tenant runs verification visits at a
-- scale that changes this assumption (no such signal today).
-- ============================================================================

CREATE TABLE field_verifications (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  application_id      uuid NOT NULL REFERENCES scheme_applications(id),
  officer_id          uuid NOT NULL REFERENCES users(id),        -- filed shape column; officer-of-record (W335/W337)
  reassigned_from     uuid REFERENCES users(id),                 -- supervisor reassignment trail (W337 "recorded")
  reassignment_reason text,                                      -- [QA-FIX 2026-07-23] W336 (denied states, both copies):
                                                                  -- "Reassignment is the supervisor's action, recorded
                                                                  -- with a reason" — canon renders a reason for the
                                                                  -- reassignment that had no backing column; added here
                                                                  -- (trivially additive, migration still unapplied/PR-stage)
  status              varchar(20) NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','in_progress','pending_otp','submitted','synced','disputed')),
  scheduled_for       date,
  geotag              jsonb NOT NULL DEFAULT '[]',                -- filed shape column; [{media_id,lat,lng,captured_at}]
  measured_values     jsonb NOT NULL DEFAULT '{}',                -- filed shape column; {measured_ha,approved_ha,recomputed_amount_minor,currency_code}
  walk_trace          uuid REFERENCES media_assets(id),           -- filed shape column; GPS walk-trace track file
  farmer_otp_signoff  varchar(16) NOT NULL DEFAULT 'pending'       -- filed shape column; STATUS ONLY, never the OTP itself (Law 10)
                      CHECK (farmer_otp_signoff IN ('pending','sent','verified','disputed')),
  otp_verified_at     timestamptz,
  dispute_reason      text,                                        -- farmer disagreement, if farmer_otp_signoff='disputed'
  submitted_at        timestamptz,
  synced_at           timestamptz,                                 -- offline-capture sync landing time (W337 "syncs from the road")
  version             integer NOT NULL DEFAULT 0                   -- optimistic lock
);
CALL add_std_columns('field_verifications');
CREATE INDEX idx_field_verifications_officer ON field_verifications(tenant_id, officer_id, status);
CREATE INDEX idx_field_verifications_application ON field_verifications(tenant_id, application_id);
-- at most one non-terminal visit per application (queue de-dup; W335 list is "waiting" visits)
CREATE UNIQUE INDEX uq_field_verifications_app_open ON field_verifications(tenant_id, application_id)
  WHERE status NOT IN ('synced','disputed');

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant table.
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
