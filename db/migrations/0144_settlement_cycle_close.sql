-- =============================================================================================
-- 0144_settlement_cycle_close.sql · PC-56 TENANT-4c — THE SETTLEMENT CYCLE, WHICH DID NOT EXIST
-- =============================================================================================
-- W147 (Settlements) and W148 (Statements) are the per-seller cycle and the document it produces:
-- "Per-seller settlement cycles: gross sales - commission - tax = net paid. Every cycle produces a
-- statement the member can hold in their hand." · "Current cycle (01-15 Jul) ... closes 15 Jul 23:59" ·
-- "Close current cycle - needs settlement.close + checker - generates 186 statements and queues payouts
-- atomically" · "Statement numbers are gapless per tenant - a missing number is an audit finding, so
-- there are none."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): THERE IS NO CYCLE. STATEMENTS ARE GENERATED NIGHTLY OVER YESTERDAY.
-- ---------------------------------------------------------------------------------------------
-- `grep -rn "settlement_cycle" db/` returns nothing: no cycle table, no period, no open/closed state, no
-- close. What actually runs is `SettlementStatementsCadenceJob`, which takes `previousUtcDayWindow()` and
-- calls `SettlementStatementService.generate(tenant, seller, from, to)` for every seller with open lines.
-- So the platform issues ONE STATEMENT PER SELLER PER DAY, and W148's "STMT-2026-0630-084 · 16-30 Jun" is
-- a fortnightly document this codebase has never produced.
--
-- WORSE THAN A MISSING FEATURE, AND THIS IS THE PART A REVIEW WOULD MISS: generation CONSUMES the lines.
-- `linkToStatement` stamps `settlement_lines.statement_id`, and the aggregate reads only lines where
-- `statement_id IS NULL`. A nightly daily-window generator therefore makes a cycle statement IMPOSSIBLE —
-- by the 15th, every line of the cycle has already been rolled into fourteen daily statements, so a
-- "close the cycle" button would aggregate zero lines and refuse. The two designs cannot coexist, which is
-- why 0144 introduces the cycle as the authoritative period and puts the change behind a flag.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: `settlement.close` IS A STRING ON A SCREEN
-- ---------------------------------------------------------------------------------------------
-- W147 names it twice ("needs settlement.close + checker"; "Cycle close needs settlement.close + checker;
-- sellers see only their own statement"). It is seeded in NO file — the promise-with-no-grant class again
-- (0120's `analytics.read`, TENANT-2a's QC verbs, 0139's `order.refund`, 0143's absent maker key). An
-- access review of who may close a settlement cycle returns an empty set today, and reads as though the
-- control exists because two screens name it.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: "GENERATES 186 STATEMENTS AND QUEUES PAYOUTS ATOMICALLY" CANNOT BE HONOURED AT SCALE
-- ---------------------------------------------------------------------------------------------
-- One transaction that writes 186 statements is fine. One that writes 100,000 is a transaction holding
-- locks for minutes on the money tables of a platform that intends 100K+ FPOs — and a single failure at
-- row 99,000 rolls back the lot, so the tenant's month cannot be closed at all. Promising atomicity here
-- CAPS SCALE, which Rule Zero forbids regardless of how good it looks on the screen.
--
-- What is achievable, and what this migration builds instead:
--   • EXACTLY ONCE PER SELLER PER CYCLE — enforced by a unique index, not by a service comment;
--   • A CYCLE THAT CANNOT BE CLOSED TWICE — one open cycle per (tenant, period), one close per cycle;
--   • RESUMABLE, BOUNDED GENERATION — the cycle carries expected/generated counts, reaches `closed` only
--     when every seller has a statement, and a crash resumes rather than restarting;
--   • A VISIBLE COUNT — the screen says "184 of 186 generated" instead of implying an instant that never
--     happened. An operator who can see the remainder is better served than one told a comfortable lie.
-- And payouts are NOT queued by the close: they queue as they always have, and TENANT-4b's approval gate
-- governs when they leave. Two overlapping approvals over one movement of money would be a control nobody
-- could reason about.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT IS ALREADY RIGHT, AND IS THEREFORE NOT TOUCHED
-- ---------------------------------------------------------------------------------------------
-- The gapless numbering W148 stakes an audit claim on is real. `next_doc_number` (0001) increments a
-- counter ROW with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so concurrent allocations serialise on
-- that row's lock and a rolled-back transaction returns the counter with it: no gaps, no duplicates, and
-- `UNIQUE (tenant_id, statement_no)` behind it. Probed live in this wave rather than assumed. One precision
-- the screen owes its reader: the series is per (tenant, doc_type, PERIOD), so numbering restarts each
-- period — gapless WITHIN a period, unique across the tenant.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 144.1  THE CYCLE
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_cycles (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  period_start          date NOT NULL,
  period_end            date NOT NULL,                 -- inclusive; the cycle closes at the end of this day
  status                varchar(20) NOT NULL DEFAULT 'open',
  -- The close is an ACT by a person, then a second person (W147). Same vocabulary as 0139/0141/0143 so an
  -- operator who has learned one maker-checker screen has learned all five.
  requested_by          uuid REFERENCES users(id),
  requested_at          timestamptz,
  decided_by            uuid REFERENCES users(id),
  decided_at            timestamptz,
  decision_note         text,
  -- The counts that make progress honest instead of atomic-by-assertion.
  sellers_expected      integer,
  statements_generated  integer NOT NULL DEFAULT 0,
  gross_minor           bigint NOT NULL DEFAULT 0,
  net_minor             bigint NOT NULL DEFAULT 0,
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT ck_settlement_cycle_period CHECK (period_start <= period_end),
  CONSTRAINT ck_settlement_cycle_status CHECK (status IN ('open', 'pending_close', 'closing', 'closed', 'rejected')),
  -- A DECISION CARRIES ITS DECIDER, and a rejection carries its reason at the same 20-character floor as
  -- every other note in this programme. NOTE THE ORDER: the note column is asserted NOT NULL *first*,
  -- because `status <> 'rejected' OR char_length(...) >= 20` evaluates to NULL for a NULL note and
  -- A CHECK THAT EVALUATES TO NULL PASSES — the defect 0139 shipped with and a live apply caught.
  CONSTRAINT ck_settlement_cycle_decision CHECK (
    status NOT IN ('closing', 'closed', 'rejected')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT ck_settlement_cycle_note CHECK (
    status <> 'rejected'
    OR (decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20)
  ),
  -- THE CHECKER IS NOT THE REQUESTER. Both columns asserted NOT NULL first, same reason as above.
  CONSTRAINT ck_settlement_cycle_maker_ne_checker CHECK (
    decided_by IS NULL
    OR (requested_by IS NOT NULL AND decided_by <> requested_by)
  ),
  -- A cycle in the close plane was requested by somebody: a `closed` row with no requester would be a
  -- close nobody performed, which is the status-recording-an-act-nobody-performed class.
  CONSTRAINT ck_settlement_cycle_requested CHECK (
    status = 'open' OR (requested_by IS NOT NULL AND requested_at IS NOT NULL)
  ),
  -- `closed` means every seller the cycle expected has a statement. The status cannot outrun the work.
  CONSTRAINT ck_settlement_cycle_closed_complete CHECK (
    status <> 'closed'
    OR (sellers_expected IS NOT NULL AND statements_generated >= sellers_expected AND closed_at IS NOT NULL)
  )
);

-- ONE cycle per tenant per period, and at most ONE cycle a tenant can be working on at a time: two open
-- cycles over overlapping days would let the same settlement line be claimed by two statements.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_cycle_period
  ON settlement_cycles (tenant_id, period_start, period_end) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_cycle_live
  ON settlement_cycles (tenant_id) WHERE status IN ('open', 'pending_close', 'closing') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_cycle_tenant_status
  ON settlement_cycles (tenant_id, status, period_end DESC) WHERE deleted_at IS NULL;

-- Isolation: a cycle is a tenant document. RLS with an explicit write check (the worker roles hold
-- BYPASSRLS per 0018, so a generation job is unaffected), and a closed cycle is never deleted.
ALTER TABLE settlement_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_cycles_read ON settlement_cycles;
CREATE POLICY settlement_cycles_read ON settlement_cycles FOR SELECT USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS settlement_cycles_insert ON settlement_cycles;
CREATE POLICY settlement_cycles_insert ON settlement_cycles FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS settlement_cycles_update ON settlement_cycles;
CREATE POLICY settlement_cycles_update ON settlement_cycles FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON settlement_cycles TO kv_app;
REVOKE DELETE, TRUNCATE ON settlement_cycles FROM kv_app;

COMMENT ON COLUMN settlement_cycles.sellers_expected IS
  'PC-56 TENANT-4c: how many sellers had un-statemented lines in the period when the close was APPROVED. The cycle reaches closed only once statements_generated reaches it, so "186 of 186" on W147 is a fact rather than W147''s claim of atomicity - which one transaction cannot honour for a tenant with 100,000 sellers (Rule Zero).';

-- ---------------------------------------------------------------------------------------------
-- 144.2  THE STATEMENT IS EXACTLY ONE PER SELLER PER CYCLE — IN THE SCHEMA, NOT IN A COMMENT
-- ---------------------------------------------------------------------------------------------
-- `SettlementStatementService.generate` guards this with `findForPeriod` plus a FOR UPDATE over the lines,
-- which does serialise two concurrent runs. That is a correct argument about today's code, and it is not a
-- guarantee: the next writer of a statement (a repair script, an admin tool, a re-import) inherits nothing
-- from it. A unique index does.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_statement_seller_period
  ON settlement_statements (tenant_id, seller_user_id, period_start, period_end);

-- The tenant-wide statements list W148 draws (348 statements, newest first, keyset). The only indexes on
-- this table were the PK and UNIQUE (tenant_id, statement_no) — a finance console listing every statement
-- for a tenant had no index to serve it.
CREATE INDEX IF NOT EXISTS idx_settlement_statement_tenant_created
  ON settlement_statements (tenant_id, created_at DESC, id DESC);

ALTER TABLE settlement_statements ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES settlement_cycles(id);
CREATE INDEX IF NOT EXISTS idx_settlement_statement_cycle ON settlement_statements (cycle_id) WHERE cycle_id IS NOT NULL;
COMMENT ON COLUMN settlement_statements.cycle_id IS
  'PC-56 TENANT-4c: the cycle whose close produced this statement. NULL for every statement issued before this wave - those came from the nightly previous-day job, so their period is a DAY, and the console says so rather than presenting them as cycle statements.';

-- ---------------------------------------------------------------------------------------------
-- 144.3  THE KEY W147 NAMES TWICE AND NO FILE SEEDS
-- ---------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('settlement.close', 'Close a settlement cycle (request or approve)', 'M05')
ON CONFLICT (code) DO NOTHING;

-- roles is a PLATFORM table with no tenant_id column (TENANT-4a learned that from a live apply, after a
-- fully green unit suite). Predicate matches 0139's, which is the one that has actually run.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'settlement.close' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 144.4  THE CYCLE LENGTH IS A SETTING, NOT A HARDCODED FORTNIGHT (Law 6 + Rule Zero)
-- ---------------------------------------------------------------------------------------------
-- W147's example cycle is 01-15 Jul. A dairy federation bills fortnightly, an FPO trading grain may bill
-- monthly, and a tenant in another country may bill on neither. The length is the tenant's decision, and
-- the platform records which one was in force.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'settlements.cycle_length', 'string', 'tenant', 'money_path', '"fortnightly"'::jsonb,
       'How long a settlement cycle runs: fortnightly (1st-15th, 16th-end) or monthly. Decides the period a cycle close aggregates and the period a statement number belongs to.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'settlements.cycle_length');

-- ---------------------------------------------------------------------------------------------
-- 144.5  THE FLAG (Law 10) — because the two generation designs cannot coexist
-- ---------------------------------------------------------------------------------------------
-- OFF: the nightly previous-day job keeps running (the pilot's behaviour; a seller keeps seeing daily
-- statements). ON: generation is driven by an APPROVED cycle close, and the nightly job stands down so it
-- cannot consume a cycle's lines mid-period. Two things hold either way: `settlement.close` is a real
-- permission with a real checker rule, and a REJECTED cycle never generates anything.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'settlement_cycles',
       'PC-56 TENANT-4c: statements are generated by an approved cycle close (W147/W148) instead of by the nightly previous-day job. OFF keeps the pilot''s daily generation - the two cannot both run, because generation consumes the settlement lines.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'settlement_cycles');
