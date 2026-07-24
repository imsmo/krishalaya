-- ============================================================================
-- MIGRATION 0073 — TENANT BROADCAST CHANNEL TARGETING + OPT-IN AUDIENCE SNAPSHOT (DELTA-053, DEV-06)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md row 053): "Broadcast channel targeting + opt-in
-- audience snapshot (extends `tenant_broadcasts`)". Register's own gap description: "`tenant_broadcasts` is
-- channel-preference-aware but carries no per-channel/audience-consent model". Canon (read directly,
-- W429-tenant-whatsapp-broadcast.html):
--   • "Audience — honest math" panel: WhatsApp opt-in on file (2,412) / opted in to marketing (1,387) / this
--     broadcast reaches (1,387) — "reaches ONLY the 1,387 — never the rest... they simply have not opted into
--     marketing." This is the exact honesty-law shape (contract Law 12) the new columns below exist to store.
--   • History table: per-broadcast Template + provider_template_ref, Audience count, Status (queued/sending/
--     sent/failed — already the existing enum), Result ("1,384 delivered · 3 failed (number no longer on
--     WhatsApp)" / "612/1,387" in-flight progress) — i.e. per-broadcast, per-recipient outcome tracking that a
--     header-only row (today's `tenant_broadcasts`) cannot express; delivery counts must reconcile to individual
--     recipients, not just a rolled-up number, exactly the same "disputed lines never block the clean ones"
--     header+line reasoning DEV-05 used for `freight_invoices`/`freight_invoice_lines` (0070).
--   • Explicit banner naming this delta: "tenant_broadcasts is channel-preference-aware by schema comment — but
--     per-channel WhatsApp-only audience targeting and the per-broadcast opt-in snapshot shown above are
--     DELTA-053 (new this batch)."
--
-- WHY A HEADER+SNAPSHOT PAIR, NOT JUST NEW HEADER COLUMNS: a "snapshot" is inherently a SET of specific records
-- (who was actually targeted, and what happened to each), not merely a count — a count alone can't answer "did
-- user X receive this broadcast" (a real support-ticket question) or reproduce the exact 1,384/3 delivered/failed
-- split after the LIVE opt-in state has since changed (consent is mutable; the historical send list must not be).
-- `consents` (0003, purpose_code='marketing') and `notification_preferences` (0012, event_code='tenant.broadcast'
-- per 0048's own seed-routing comment) are the LIVE, mutable opt-in sources — this migration does NOT duplicate
-- that consent storage (Law 3/11: reuse existing dynamic master data, never fork a second consent mechanism); it
-- adds only the SEND-TIME MATERIALIZED SNAPSHOT of which users qualified, as user REFERENCES (never denormalized
-- phone numbers — Law 10 per the founder's explicit instruction: an audience snapshot must store `user_id`, not
-- PII. Grepped the filed shape and canon for any proposed phone/PII column: none found — no STOP-and-arbitrate
-- needed).
--
-- RLS DECISION: `tenant_broadcast_recipients` is TENANT-SCOPED (tenant_id NOT NULL, standard idempotent RLS
-- pass) — a broadcast recipient list belongs to exactly one tenant's send, matching `tenant_broadcasts` itself.
-- FK-CONVENTION: following the established repo rule for hot/partitioned tables (`ledger_entries.account_id`,
-- `risk_events.user_id`, `kcc_drawl_ledger.tenant_id`/`loan_id`, 0069 — "none declare a normal FK, even to
-- non-partitioned parents, for insert-throughput reasons"), `tenant_id`/`broadcast_id`/`user_id` below are all
-- plain `uuid NOT NULL`, APP-VALIDATED against `tenants.id`/`tenant_broadcasts.id`/`users.id` — no FK declared,
-- matching that exact precedent (this table is itself partitioned, same class as `kcc_drawl_ledger`/
-- `aeps_service_events`, not the bounded `freight_invoice_lines` shape that DOES carry FKs).
--
-- PARTITION CONSIDERATION (real decision, not boilerplate): a single broadcast's recipient list can be thousands
-- of rows (canon: 1,387 for one mid-size FPO's single send); at the platform's Year-3+ target scale (15,000
-- tenants, PRD NFRs) with even modest broadcast cadence this becomes an event-log-volume table, not a
-- bounded-per-cycle one (unlike DEV-05's `freight_invoices`, which is invoice-cycle-bounded) — same growth shape
-- as `notifications`/`risk_events`/`audit_log`, all of which are `PARTITION BY RANGE`. `tenant_broadcast_recipients`
-- is therefore `PARTITION BY RANGE (created_at)` with a composite `(id, created_at)` PK, following that exact
-- precedent; `ensure_partitions(3)` populates monthly children + a DEFAULT catch-all. The header `tenant_broadcasts`
-- itself stays UNPARTITIONED — one row per broadcast SEND (bounded, campaign-cadence volume, same shape as
-- `platform_announcements`), only its line-level snapshot is event-log-shaped.
--
-- LAW 2/10 CHECK: no money on this table (broadcasts are marketing sends, not payments) — N/A. No raw phone
-- number, Aadhaar, or other PII column anywhere below; `user_id` is the only identifying reference, matching the
-- founder's explicit Law 10 instruction for this delta.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Header extension: which channel, which approved template, when scheduled, and the honest-math denominator.
-- `recipient_count` (existing, 0048) KEEPS its meaning as "how many this broadcast reaches" (the numerator,
-- e.g. 1,387) — no redundant column added for that. `eligible_count` is the NEW denominator (e.g. 2,412, "opt-in
-- on file") the canon's own honest-math panel requires alongside it.
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_broadcasts
  ADD COLUMN IF NOT EXISTS channel varchar(15) NOT NULL DEFAULT 'whatsapp', -- whatsapp|sms|email|push (no CHECK — mirrors notification_templates.channel's own open vocabulary-by-comment convention, 0012)
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES notification_templates(id), -- marketing-category (notification_events.priority='promotional'), lifecycle_status='approved' only — enforced app-side at send time
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,      -- distinct from created_at (when authored) — when the send is scheduled/queued for (canon: "15 Jul, 08:30")
  ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0; -- total users with this channel's opt-in on file at send time (the honest-math denominator; recipient_count is the numerator)

CREATE INDEX idx_tenant_broadcasts_scheduled ON tenant_broadcasts(tenant_id, scheduled_at)
  WHERE status IN ('queued', 'sending');

-- ---------------------------------------------------------------------------
-- Opt-in audience snapshot: one row per user this specific broadcast targeted, materialized at send time.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_broadcast_recipients (
  id              uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL,          -- app-validated against tenants.id — no FK (partitioned/hot-table convention above)
  broadcast_id    uuid NOT NULL,          -- app-validated against tenant_broadcasts.id — no FK (same convention)
  user_id         uuid NOT NULL,          -- app-validated against users.id — no FK (same convention)
  delivery_status varchar(12) NOT NULL DEFAULT 'queued'
                  CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'failed')),
  failure_reason  varchar(200),           -- e.g. 'number no longer on WhatsApp' (canon's own example)
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CALL add_std_columns('tenant_broadcast_recipients');
CREATE UNIQUE INDEX uq_tenant_broadcast_recipients ON tenant_broadcast_recipients(broadcast_id, user_id, created_at);
CREATE INDEX idx_tenant_broadcast_recipients_broadcast ON tenant_broadcast_recipients(tenant_id, broadcast_id);
CREATE INDEX idx_tenant_broadcast_recipients_failed ON tenant_broadcast_recipients(tenant_id, broadcast_id)
  WHERE delivery_status = 'failed';

-- Partition FIRST (per DEV-05's own self-found-and-fixed defect: ensure_partitions must run BEFORE the RLS
-- DO-block below, or monthly children created afterward get no pg_policies row of their own).
CALL ensure_partitions(3);

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant table (and its partition children).
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
