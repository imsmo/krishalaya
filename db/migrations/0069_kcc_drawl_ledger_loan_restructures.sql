-- ============================================================================
-- MIGRATION 0069 — LENDER PAIR: kcc_drawl_ledger + loan_restructures
-- (DELTA-032, DELTA-033, DEV-05)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- GROUPING RATIONALE: founder brief for DEV-05 groups these as "0069 lender pair 032+033" — both are
-- partner/lender console tables (W205-224 realm, apps/web-partner/src/app/lender/*), both hang off the same
-- `loans` parent (0011_fintech_schemes.sql), both reviewed by the same lender-servicing founder pass in one
-- sitting. Schema backlog's own Tier-1 rationale line: "lender money paths (032/033)".
--
-- FK-TARGET VERIFICATION (Hard Rule 4 — stale doc numbers are not truth): the founder's brief guessed "loans/kcc
-- tables from migrations 0038+" — grep-verified today, the REAL location is `db/migrations/0011_fintech_schemes.sql`
-- (`loans`, `loan_repayments`, `loan_applications`, `financial_partners` all live there). No delta in this file
-- needed to STOP for a missing parent — `loans` exists and is the correct FK target for both tables below.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DELTA-032 — kcc_drawl_ledger (W217-partner-kcc-drawls)
-- Filed shape (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md): "`kcc_drawl_ledger`" — table name only; canon supplies
-- the column-level shape (read directly, W217-partner-kcc-drawls.html):
--   • table columns: Date | Entry (narrative) | Drawl | Repaid | Interest | Balance — three entry kinds
--     (drawl / repayment / interest applied), each row showing only the columns relevant to its kind, with a
--     running balance after each entry.
--   • "Interest applied (Jun — daily accrual on drawn balance: ₹1,60,000 × 12d + ₹2,20,000 × 13d @ 7%)" — the
--     exact accrual math is shown to the borrower, so the accrual basis (days × drawn balance × rate) must be
--     stored, not just the resulting interest amount → `accrual_basis` jsonb.
--   • "Drawl — seed + fertiliser (kharif kit)" / "Repayment — rabi wheat sale (harvest_settlement)" — free-text
--     narrative per entry, and repayment channel reuses the SAME vocabulary as `loan_repayments.channel`
--     (upi|milk_bill_deduction|harvest_settlement|cash_partner, 0011) → `repayment_channel`.
--   • Warning banner: "Drawls above ₹50,000 to non-supplier destinations get a purpose check... Supplier-direct
--     drawls skip the friction entirely" → `destination_kind` (supplier_direct|other) + `purpose_check_status`
--     state machine. The ₹50,000 threshold itself is a business rule, not a schema invariant — deliberately NOT
--     hardcoded as a CHECK constraint (a threshold change must never require a migration).
--   • Footer: "interest accrues on drawn balance only — never on the unused limit" and "append-only" (states
--     panel: "The ledger is append-only and safe. Retry.") — confirms LEDGER-class semantics (Law 2).
--
-- MONEY (Law 2): `amount_minor bigint` (signed: +drawl/+interest increase the drawn balance, -repayment decreases
-- it — same sign convention as `ledger_entries.amount_minor`) + explicit `currency_code`. `balance_after_minor`
-- is the running drawn-balance snapshot shown in the canon's own "Balance" column.
--
-- RLS DECISION: TENANT-SCOPED, RLS ON (via the idempotent tenant-isolation pass below) — NOT excluded like
-- `wallet_accounts`/`ledger_entries`/`ledger_transactions`/`reconciliation_runs`. Those three are excluded because
-- they are genuinely platform-shared physical tables where a single row's "tenant" isn't a clean concept (a
-- ledger_transaction can span a platform commission cut across tenants) — DEV-04's own QA finding documented this
-- as an application-layer query-discipline concern, not a blanket precedent to copy. `kcc_drawl_ledger` has no such
-- ambiguity: every row belongs to exactly one KCC loan, which belongs to exactly one tenant (`loans.tenant_id NOT
-- NULL`, 0011) — so this table gets the STRONGER protection (real DB-enforced RLS), matching `field_verifications`
-- (0066, DEV-04) rather than the wallet-exclusion precedent.
--
-- LEDGER-CLASS APPEND-ONLY PHYSICS (founder-explicit, Law 2 + contract §3.2): mirrors the `ledger_entries`/
-- `wallet_accounts` "history is physics, not policy" doctrine (0014_platform_ops_security.sql lines 152-158) —
-- `REVOKE UPDATE, DELETE ... FROM kv_app` at the foot of this file. Unlike `ledger_entries` (which also revokes
-- INSERT from kv_app, restricting writes to a separate `kv_wallet` role), this table has no dedicated lending
-- role carved out yet — inventing a new DB role is out of this schema-only delta's filed scope — so `kv_app`
-- keeps its default INSERT (needed for the lending module's own servicing writes) but loses UPDATE/DELETE
-- entirely: once an entry lands, it can never be mutated or removed, only ever appended to (Golden Law 2 for
-- code, "Money is append-only").
--
-- PARTITION CONSIDERATION: PARTITIONED — `PARTITION BY RANGE (created_at)`, composite `(id, created_at)` PK,
-- `bigserial` id — same physical shape as `ledger_entries` (0006) and `risk_events` (0003). Founder brief calls
-- this out explicitly as a "high-volume ledger table — real partition decision needed." Every KCC account can
-- accrue a DAILY interest-applied row across the platform's full KCC book (15,000-tenant Year-5 target, Rule
-- Zero/Law 11 scale honesty) — unbounded per-tenant growth over years, the same growth shape `ledger_entries`
-- itself has, not the bounded per-alert shape of `price_alert_triggers` (0059, NOT partitioned). Following the
-- established repo convention for hot/partitioned tables (`ledger_entries.account_id`, `risk_events.user_id`,
-- `shipment_events.shipment_id` — none declare a normal FK, even to non-partitioned parents, for insert-throughput
-- reasons), `loan_id`/`tenant_id` below are plain `uuid NOT NULL` — APP-VALIDATED against `loans.id`/`tenants.id`,
-- no FK declared, matching that exact precedent. `CALL ensure_partitions(3);` at the foot of this file creates the
-- current-month + 14-months-ahead partitions + a DEFAULT catch-all for this new partitioned table immediately
-- (the dynamic discovery mechanism in `ensure_partitions()`, 0014, covers it going forward via the existing
-- monthly cron/deploy-time call — this migration's own explicit CALL is only needed so a fresh apply can insert
-- into it right away, exactly the same self-sufficiency need any fresh-apply verification has).
-- ----------------------------------------------------------------------------
CREATE TABLE kcc_drawl_ledger (
  id                    bigserial,
  tenant_id             uuid NOT NULL,          -- app-validated against tenants.id — no FK (partitioned/hot-table convention above)
  loan_id               uuid NOT NULL,          -- app-validated against loans.id (product_kind_id='kcc') — no FK (same convention)
  entry_kind            varchar(12) NOT NULL CHECK (entry_kind IN ('drawl','repayment','interest')),
  amount_minor          bigint NOT NULL CHECK (amount_minor <> 0),  -- signed: +drawl/+interest, -repayment (Law 2)
  currency_code         char(3) NOT NULL DEFAULT 'INR',
  balance_after_minor   bigint NOT NULL,        -- running drawn-balance snapshot (canon "Balance" column)
  entry_date            date NOT NULL DEFAULT CURRENT_DATE,  -- business date shown in the ledger ("01 Jul"), distinct from created_at
  narrative             varchar(300) NOT NULL,  -- canon description text, e.g. 'Drawl — seed + fertiliser (kharif kit)'
  destination_kind      varchar(16) CHECK (destination_kind IN ('supplier_direct','other') OR destination_kind IS NULL),
  purpose_check_status  varchar(12) NOT NULL DEFAULT 'not_required'
                        CHECK (purpose_check_status IN ('not_required','pending','cleared','flagged')),
  repayment_channel     varchar(30),            -- upi|milk_bill_deduction|harvest_settlement|cash_partner (mirrors loan_repayments.channel, 0011)
  accrual_basis         jsonb,                  -- {days, rate_apr_bps, drawn_balance_minor} — interest transparency (canon shows exact daily-accrual math)
  ledger_txn_id         uuid,                   -- optional correlation to the real money ledger_transactions.id — no FK
                                                 -- (mirrors loans.origination_fee_txn_id's own loose-reference convention, 0011)
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_kcc_drawl_ledger_loan ON kcc_drawl_ledger(loan_id, created_at DESC);
CREATE INDEX idx_kcc_drawl_ledger_tenant ON kcc_drawl_ledger(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- DELTA-033 — loan_restructures (W221-partner-restructure)
-- Filed shape (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md): "`loan_restructures`" — table name only; canon
-- supplies the column-level shape (read directly, W221-partner-restructure.html):
--   • side-by-side terms table: Instalment (current/proposed), Holiday (months + interest-accrues-no-penalty
--     note), Tenor (current/proposed), Rate ("unchanged, restructure is not a repricing"), Total interest delta.
--   • NPA discipline panel: "90+ DPD without cure or restructure → NPA... the platform never helps hide it";
--     "A restructure entered to dodge NPA recognition fails the weather-evidence gate — clause needs the
--     district rainfall notification"; "One restructure per loan per cause — serial restructuring is a red
--     flag" → `evidence_media_id` (the district notification) + a partial-unique open-restructure guard below.
--   • Borrower acceptance flow: "Terms in Gujarati... voice read-out"; "24h think-it-over window"; "Acceptance
--     by OTP + voice · your checker countersigns · status → restructured" → `borrower_accept_otp_status` (STATUS
--     ONLY, mirrors `field_verifications.farmer_otp_signoff`'s Law 10 doctrine — the OTP value itself is never
--     stored here either) + `accept_cooling_off_until` + `checker_id`/`checker_approved_at` (maker-checker,
--     contract §3.1 read across from the design contract's checker doctrine).
--   • "Restructures recorded with full old→new terms · borrower gets the comparison PDF forever" →
--     `comparison_pdf_media_id`.
--
-- MONEY (Law 2): `old_instalment_minor`/`new_instalment_minor`/`total_interest_delta_minor` all `bigint` +
-- explicit `currency_code`. `rate_apr_bps` stored (not just displayed) so a future audit can prove the canon's own
-- claim ("unchanged, restructure is not a repricing") against real data, not a UI assertion (Golden Law 12, trust
-- surfaces render only verified truth).
--
-- RLS DECISION: TENANT-SCOPED, RLS ON via the idempotent pass below — same reasoning as kcc_drawl_ledger above
-- (every restructure belongs to exactly one loan, one tenant).
--
-- PARTITION CONSIDERATION: NOT partitioned — bounded, low-cardinality-per-tenant (the canon's own rule, "one
-- restructure per loan per cause," caps volume structurally; this is a case/proposal record, not a per-transaction
-- event stream) — same class as `field_verifications` (0066) and `business_kyc_profiles` (0058), not the
-- high-volume-event-log class. Uses `add_std_columns()` + the standard non-partitioned shape.
-- ----------------------------------------------------------------------------
CREATE TABLE loan_restructures (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  loan_id                   uuid NOT NULL REFERENCES loans(id),
  case_ref                  varchar(60),          -- collections case reference shown in canon breadcrumb (e.g. 'CASE-0041')
                                                   -- no FK: no dedicated collections_cases table exists yet (W220's own
                                                   -- backing table per SCREEN-DATA-CATALOG.md is "audit (contact log)",
                                                   -- not a case table) — inventing one is out of this delta's filed scope
  reason_code               varchar(20) NOT NULL DEFAULT 'weather_distress'
                            CHECK (reason_code IN ('weather_distress','other')),
  evidence_media_id         uuid REFERENCES media_assets(id),   -- district rainfall notification / other evidence doc
  old_instalment_minor      bigint NOT NULL,
  new_instalment_minor      bigint NOT NULL,
  old_tenor_months          smallint NOT NULL,
  new_tenor_months          smallint NOT NULL,
  rate_apr_bps              integer NOT NULL,     -- unchanged across old→new by canon doctrine; stored so that claim is auditable, not asserted
  holiday_months            smallint NOT NULL DEFAULT 0,
  holiday_starts_on         date,
  penal_interest_waived     boolean NOT NULL DEFAULT false,
  total_interest_delta_minor bigint NOT NULL,
  currency_code             char(3) NOT NULL DEFAULT 'INR',
  status                    varchar(16) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','mediation','accepted','checker_approved','activated','rejected','expired')),
  proposed_by               uuid REFERENCES users(id),      -- collections lead
  mediation_at              timestamptz,
  borrower_accept_otp_status varchar(16) NOT NULL DEFAULT 'pending'  -- STATUS ONLY, never the OTP itself (Law 10,
                            CHECK (borrower_accept_otp_status IN ('pending','sent','verified','disputed')),  -- mirrors field_verifications.farmer_otp_signoff, 0066)
  accept_cooling_off_until  timestamptz,          -- 24h think-it-over window
  accepted_at               timestamptz,
  checker_id                uuid REFERENCES users(id),      -- checker countersign (maker-checker)
  checker_approved_at       timestamptz,
  comparison_pdf_media_id   uuid REFERENCES media_assets(id),  -- "borrower gets the comparison PDF forever"
  version                   integer NOT NULL DEFAULT 0
);
CALL add_std_columns('loan_restructures');
CREATE INDEX idx_loan_restructures_loan ON loan_restructures(tenant_id, loan_id, created_at DESC);
-- one OPEN restructure process per loan at a time (canon: "One restructure per loan per cause — serial
-- restructuring is a red flag, not a tool") — queue de-dup, same pattern as uq_field_verifications_app_open (0066)
CREATE UNIQUE INDEX uq_loan_restructures_loan_open ON loan_restructures(tenant_id, loan_id)
  WHERE status NOT IN ('rejected','expired');

-- Pre-create partitions for kcc_drawl_ledger BEFORE the RLS pass below — matches 0014_platform_ops_security.sql's
-- own internal ordering (CALL ensure_partitions(3) precedes its RLS DO block there), so the DO block's per-table
-- scan (which has no special partition-awareness) enumerates every already-created monthly child individually and
-- gives EACH ONE its own explicit tenant_isolation policy row, not just the parent. [DEV-05 self-fix, pre-apply:
-- an earlier draft of this file called ensure_partitions() AFTER the RLS block — reproduced empirically against a
-- fresh embedded Postgres that this left every kcc_drawl_ledger_YYYY_MM child with NO pg_policies row of its own
-- (only accidentally mopped up by 0070's own later idempotent pass in that draft's ordering, which does not exist
-- as a mechanism to rely on — see 0071's aeps_service_events, the LAST migration in this batch, which had no such
-- accidental mop-up and genuinely failed verify-rls-coverage.js with 16 real gaps until this same fix was applied
-- there too). This migration was never applied to any shared/tracked database — plain file edit, not a mutation
-- of an applied migration (contract §7).
CALL ensure_partitions(3);

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant tables (loan_restructures gets a normal
-- policy; kcc_drawl_ledger — partitioned, but has a tenant_id column and appears in pg_tables like shipments/
-- risk_events/shipment_events do — gets the policy applied to the parent AND every already-created monthly child).
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

-- LEDGER-CLASS append-only physics for kcc_drawl_ledger (founder-explicit requirement) — mirrors the
-- "history is physics, not policy" doctrine (0014) for a table created after that migration's one-time list.
-- Applied AFTER the RLS pass above so it targets the parent relation (grants are not per-partition-child scoped
-- the way policies are; REVOKE on the partitioned parent applies to all its partitions transparently).
REVOKE UPDATE, DELETE ON kcc_drawl_ledger FROM kv_app;

-- [DEV-05 self-fix, pre-apply] `id bigserial` needs its own sequence USAGE grant: 0014's `GRANT USAGE ON ALL
-- SEQUENCES IN SCHEMA public TO kv_app` was a one-time grant over sequences existing AT THAT TIME, and 0014 set
-- `ALTER DEFAULT PRIVILEGES` for TABLES only, never SEQUENCES — so kv_app has no implicit USAGE on any sequence
-- created by a migration after 0014. kcc_drawl_ledger is the first new bigserial table since then; reproduced
-- empirically (a cross-tenant INSERT probe failed with "permission denied for sequence kcc_drawl_ledger_id_seq"
-- BEFORE the RLS WITH CHECK could even evaluate, masking the real proof). Grant here so the app can insert at all.
GRANT USAGE, SELECT ON SEQUENCE kcc_drawl_ledger_id_seq TO kv_app;
