-- ============================================================================
-- MIGRATION 0095 — SCHEDULED PLATFORM REPORTS (closes PC-56 ADMIN-1-Q9)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- WHAT THIS IS FOR. The canon (W1894-1900) asks for "schedule this report by email". PC-56 ADMIN-1d deferred it with a
-- reason: a schedule button that silently never fires is the worst possible version of the feature, and firing needs
-- three things — a scheduler, a stored schedule, and a DELIVERY RECORD. The scheduler already exists (apps/worker runs
-- leader-locked interval jobs). This migration adds the other two.
--
-- THE DELIVERY RECORD IS THE POINT, NOT THE SCHEDULE. Anyone can store a cron expression. What makes this trustworthy
-- is that every run writes a row saying what was produced, for whom, and WHETHER IT ACTUALLY WENT OUT — including the
-- honest case where it did not, because this platform has no email provider yet (there is an SMS sender in
-- core/auth and nothing for email). So a run ends in `computed` or `provider_pending`, never in a silent success. The
-- console shows the run history, so "I never got the Monday report" is answerable from data instead of from a guess.
--
-- DESIGN NOTES
--   • PLATFORM-SCOPED, no tenant_id and no RLS: these are OUR internal reports about the whole book. A per-tenant
--     scheduled report is a different feature (it would be tenant data, and would need RLS), and conflating them would
--     put cross-tenant figures behind a tenant-scoped policy — the worst place for a mistake.
--   • `next_run_at` IS THE QUEUE. The worker claims due rows with FOR UPDATE SKIP LOCKED and pushes `next_run_at`
--     forward BEFORE producing the report, so a crash mid-report cannot re-send the same digest in a loop. At-most-once
--     for a digest is the right default: a missed weekly summary is an annoyance, a mail-loop is an incident.
--   • CADENCE IS AN ENUM, NOT CRON. Three options a human can reason about. A cron string in an admin form is a
--     support ticket generator ("* * * * 1" fired every minute all Monday), and nobody needs minute-level digests.
--   • RECIPIENTS ARE TEXT EMAILS, capped, and validated in the service. They are internal ops addresses, not users, so
--     there is deliberately no FK to `users`: the finance mailbox is not a person with a login.
-- ============================================================================

CREATE TYPE scheduled_report_cadence AS ENUM ('daily', 'weekly', 'monthly');
-- `computed` = the numbers were produced and stored; `provider_pending` = ...and could not be delivered because no
-- email provider is configured in this deploy. Both are SUCCESSFUL COMPUTATION with different delivery truth.
CREATE TYPE scheduled_report_run_status AS ENUM ('computed', 'sent', 'provider_pending', 'failed');

CREATE TABLE scheduled_reports (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  report        varchar(40) NOT NULL,                  -- mirrors the export vocabulary (revenue | invoices | tenants…)
  cadence       scheduled_report_cadence NOT NULL,
  -- hour of day (0-23) in IST, the platform's operating timezone. Stored as an int, not a timestamp: "every Monday at
  -- 07:00" is a rule, and storing it as a moment would drift with daylight-saving reasoning in other countries later.
  hour_ist      smallint NOT NULL DEFAULT 7 CHECK (hour_ist BETWEEN 0 AND 23),
  -- for weekly: 1=Monday..7=Sunday (ISO). NULL for daily/monthly; monthly runs on the 1st.
  weekday_iso   smallint CHECK (weekday_iso IS NULL OR weekday_iso BETWEEN 1 AND 7),
  recipients    text[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 20),
  is_active     boolean NOT NULL DEFAULT true,
  -- THE QUEUE. NULL means "never scheduled" and the worker computes the first one; the service sets it on create.
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  notes         text
);
CALL add_std_columns('scheduled_reports');

-- weekly needs a weekday; daily and monthly must not carry one (a stale weekday on a monthly schedule is a lie a
-- reader would act on)
ALTER TABLE scheduled_reports ADD CONSTRAINT ck_sched_report_weekday CHECK (
  (cadence = 'weekly' AND weekday_iso IS NOT NULL) OR (cadence <> 'weekly' AND weekday_iso IS NULL)
);
-- the worker's claim index: active schedules whose time has come, oldest first
CREATE INDEX idx_sched_reports_due ON scheduled_reports (next_run_at)
  WHERE is_active AND deleted_at IS NULL;

CREATE TABLE scheduled_report_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  schedule_id     uuid NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  status          scheduled_report_run_status NOT NULL,
  -- what was produced: the report's own numbers, small enough to keep (a digest, not a dataset)
  summary         jsonb NOT NULL DEFAULT '{}',
  row_count       integer NOT NULL DEFAULT 0,
  recipients      text[] NOT NULL DEFAULT '{}',        -- who it was FOR (copied, so editing the schedule cannot rewrite history)
  -- why it did not go out, in words. Non-null exactly when the status is not 'sent'.
  detail          text,
  -- the period the digest covered, so two runs of the same schedule are distinguishable and a re-run is detectable
  period_start    date,
  period_end      date
);
CALL add_std_columns('scheduled_report_runs');
CREATE INDEX idx_sched_report_runs_schedule ON scheduled_report_runs (schedule_id, ran_at DESC);
-- one run per (schedule, period): the worker is idempotent, so a retry after a crash cannot double-send a digest
CREATE UNIQUE INDEX uq_sched_report_run_period ON scheduled_report_runs (schedule_id, period_start, period_end)
  WHERE deleted_at IS NULL AND period_start IS NOT NULL;

-- 'sent' must not carry a failure reason, and everything else must explain itself
ALTER TABLE scheduled_report_runs ADD CONSTRAINT ck_sched_run_detail CHECK (
  (status = 'sent' AND detail IS NULL) OR (status <> 'sent' AND length(btrim(COALESCE(detail, ''))) >= 3)
);

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- Neither table is tenant data, so no RLS — but the defaults would hand kv_app INSERT on the platform's own internal
-- reporting schedule. Revoke, then grant deliberately: admin-api manages them, the worker runs them.
REVOKE ALL ON scheduled_reports, scheduled_report_runs FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON scheduled_reports TO kv_admin;
GRANT SELECT, INSERT, UPDATE ON scheduled_report_runs TO kv_admin;
-- the worker claims due schedules and writes runs (it connects as kv_relay)
GRANT SELECT, UPDATE ON scheduled_reports TO kv_relay;
GRANT SELECT, INSERT ON scheduled_report_runs TO kv_relay;
GRANT SELECT ON scheduled_reports, scheduled_report_runs TO kv_readonly;
