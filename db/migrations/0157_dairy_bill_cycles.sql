-- 0157_dairy_bill_cycles.sql · PC-56 TENANT-6c-1 · W169 (Dairy payout cycles)
--
-- W169 IS A SCREEN ABOUT A NOUN THIS PLATFORM DOES NOT HAVE.
--
-- Every line of it is about a CYCLE: "Current cycle (01-15 Jul)", "Preview cycle 01-15 Jul (Wed close)",
-- "cycle closes Wed 15 Jul 23:59 -> bills previewed Thu morning -> approved Thu evening -> paid Fri 17 Jul",
-- "Last cycle disputes 2 / 309", "disputed pauses one bill, never the cycle". There has never been a cycle row.
-- `milk_bills` carries a bare `(period_start, period_end)` pair per member and nothing anywhere records that those
-- 312 pairs are ONE fortnight with one close instant, one payday and one state. So:
--
--   * TENANT-6a's counter board had to DERIVE the running window from `dairy_memberships.payment_cycle` (the mode of
--     a preference column) because there was nothing to read. TENANT-6b-2's quality desk derives it again, through
--     the same function on purpose. Two screens agreeing about a guess is still a guess.
--   * "Pays Fri 17 Jul" was unanswerable. No payday is stored, derived or configurable anywhere in this codebase.
--   * "Wed close" was unanswerable. No close instant exists, and `period_end` is a DATE — the moment a fortnight
--     shuts is 23:59 in the COOPERATIVE's timezone, which is a different instant in Gujarat and in Kenya (Rule Zero:
--     this platform ships to five countries by Y7, so a close derived in the platform's timezone is a defect the day
--     the second country signs). It is resolved here from `tenants.country_code -> countries.timezone`, because
--     **THERE IS NO `tenants.timezone` COLUMN ON THIS PLATFORM** — the finest granularity a tenant's location can be
--     traced to is its country. That is EXACT for every launch market (India, Bangladesh, Sri Lanka, Nepal and Kenya
--     are each a single zone) and WRONG the day a multi-zone country signs: `countries` already carries
--     'US' -> 'America/New_York', which would shut a Californian cooperative's fortnight at 21:00 local. NAMED, NOT
--     CLOSED — the fix is a nullable per-tenant timezone with a console field and a backfill, which is a wave. A
--     column added here with nothing to write it would be a dead column that looks like the problem is solved.
--
-- AND THE JOB THAT WAS SUPPOSED TO BUILD THE BILLS HAS NEVER RUN, TWICE OVER.
--
--   `MilkBillCycleCloseJob` has existed since the dairy module was built. `dairy.module.ts` says it "is instantiated
--   by apps/worker" — apps/worker instantiates nothing of the kind; its `JOBS` registry holds twelve pg-native jobs
--   and no dairy job, and by its own contract (`WORKER-RUNTIME.md`, "Deferred: domain-handler jobs") it CANNOT host
--   this one, because generating a bill needs the module's unit-of-work, outbox and idempotency. So TENANT-6a's
--   finding that W167's "312 milk_bills building" is zero bills on every tenant was not a data problem: nothing on
--   this platform has ever generated a milk bill except a human calling POST /dairy/milk-bills by hand.
--
--   AND IT WOULD HAVE CRASHED ON ITS FIRST BILL IF IT HAD RUN. The job passes `{ userId: 'system' }` into
--   `MilkBillService.generate`, whose `idem.remember` writes `idempotency_keys.user_id` — a uuid column. The
--   PgIdempotencyService header documents the sentinel and null-guards it, so this one survives; but the same actor
--   reaches `uow.run(..., { userId })`, and the job's claim query `findMembershipsToBill` has no tenant filter and no
--   cycle filter at all: it would have swept EVERY tenant's unbilled pours into one window chosen by the caller,
--   billing a monthly member on a fortnightly boundary. A job nobody registered was also a job nobody could run.
--
-- WHAT THIS MIGRATION DOES NOT DO, AND SAYS SO:
--   * The DEDUCTION still has no destination (see the COMMENT on `milk_bills.deductions` below). Until it has one,
--     `MilkBillService.pay` REFUSES to pay a bill that carries deductions rather than quietly keeping the money.
--   * `dispute_window_ends` is still written by nobody and `MilkBill.dispute()` is still called by nobody, so W169's
--     "24h dispute window" and "2 / 309 disputes" describe acts that do not exist. Named in COMMENTs, built in 6c-2.
--   * Preview and approve still take only `dairy.manage`: no `settlement.close`, no checker, no consent rule. Also
--     6c-2. This wave deliberately stops at `open -> closed`, and the status CHECK below admits only those two, so a
--     cycle cannot sit in a state no code can move it out of.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. THE CYCLE
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dairy_bill_cycles (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  payment_cycle      varchar(15) NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,

  -- The instant the fortnight shuts, resolved at insert from `tenants.country_code -> countries.timezone` (see the
  -- header: there is no per-tenant timezone column on this platform) and stored as an instant. Exclusive: the first
  -- moment of the day AFTER `period_end`, local. W169 renders it as
  -- "closes Wed 15 Jul 23:59", which is the same moment said inclusively — but 23:59:59 vs 23:59:59.999999 is a
  -- second of milk money a boundary test can argue about, and an exclusive bound cannot.
  closes_at          timestamptz NOT NULL,

  -- W169's "Pays Fri 17 Jul". A DATE, in the cooperative's own calendar: a payday is counted in whole days by the
  -- people waiting for it, not in the platform's timezone (the ruling 0148 made for `grace_until`).
  payday             date NOT NULL,

  status             varchar(16) NOT NULL DEFAULT 'open',
  closed_at          timestamptz,

  -- The generation RUN's own outcome. Deliberately NOT a copy of "how many bills are in draft / previewed / paid" —
  -- those are measured from `milk_bills.cycle_id` by the read that shows them, because a stored count is a second
  -- mechanism for a fact the bills already hold and the two would drift the first time a bill moved. What IS stored
  -- is the part nothing else records: a membership whose generation FAILED leaves no bill row behind, so without
  -- `bills_failed` the difference between "39 members did not pour" and "39 members' bills threw" is unrecoverable.
  bills_generated_at timestamptz,
  bills_generated    integer,
  bills_skipped      integer,
  bills_failed       integer,

  CONSTRAINT uq_dairy_bill_cycle UNIQUE (tenant_id, payment_cycle, period_start, period_end),
  CONSTRAINT ck_dairy_bill_cycle_kind CHECK (payment_cycle IN ('daily','weekly','fortnightly','monthly')),
  CONSTRAINT ck_dairy_bill_cycle_window CHECK (period_end >= period_start),
  -- A payday before the cycle shuts would pay for milk not yet poured.
  CONSTRAINT ck_dairy_bill_cycle_payday CHECK (payday >= period_end),
  -- Only the two states this wave's code can actually reach. 'previewed' / 'approved' / 'paid' arrive with the acts
  -- that produce them (TENANT-6c-2) — a vocabulary wider than the code is how a screen ends up showing a status
  -- nothing can leave.
  CONSTRAINT ck_dairy_bill_cycle_status CHECK (status IN ('open','closed')),
  -- Closed carries its instant; open cannot. A cycle that says "closed" with no time is a claim with no evidence.
  CONSTRAINT ck_dairy_bill_cycle_closed_stamp CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  -- Counts arrive together with the run that produced them, or not at all.
  CONSTRAINT ck_dairy_bill_cycle_generation CHECK (
    (bills_generated_at IS NULL) = (bills_generated IS NULL)
    AND (bills_generated_at IS NULL) = (bills_skipped IS NULL)
    AND (bills_generated_at IS NULL) = (bills_failed IS NULL)),
  CONSTRAINT ck_dairy_bill_cycle_counts CHECK (
    coalesce(bills_generated, 0) >= 0 AND coalesce(bills_skipped, 0) >= 0 AND coalesce(bills_failed, 0) >= 0),
  -- Bills are only ever generated for a cycle that has SHUT. Half a fortnight billed is a farmer paid for half the
  -- milk they poured, and the second half silently rolled into the next bill.
  CONSTRAINT ck_dairy_bill_cycle_generate_after_close CHECK (bills_generated_at IS NULL OR closed_at IS NOT NULL)
);
CALL add_std_columns('dairy_bill_cycles');

COMMENT ON TABLE dairy_bill_cycles IS
  'PC-56 TENANT-6c-1. THE CYCLE W169 IS ENTIRELY ABOUT, WHICH DID NOT EXIST. Before this table a "cycle" was an '
  'implicit (period_start, period_end) pair repeated across 312 milk_bills rows, with no close instant, no payday, no '
  'state and no record that they were one thing — so TENANT-6a and 6b-2 both had to derive the running window from '
  'the MODE of dairy_memberships.payment_cycle, and "Pays Fri 17 Jul" / "Wed close" were unanswerable. One row per '
  '(tenant, payment cycle, window). The close instant is resolved from the tenant''s own timezone, the payday from a '
  'tenant setting: neither is a platform-wide constant, because a cooperative in Kenya shuts its fortnight at a '
  'different instant than one in Gujarat (Rule Zero).';

COMMENT ON COLUMN dairy_bill_cycles.closes_at IS
  'The EXCLUSIVE instant the window shuts: first moment of the day after period_end, resolved at insert from '
  'tenants.country_code -> countries.timezone. W169 says "closes Wed 15 Jul 23:59"; stored exclusively so a boundary '
  'is a comparison rather than an argument about how many nines. Frozen at insert deliberately — a cooperative whose '
  'country or timezone data changes must not retroactively move the close of a fortnight whose bills are already out. '
  'LIMITATION, STATED: the resolution is per COUNTRY. No tenants.timezone column exists, so two cooperatives in '
  'different zones of one country share a close instant — exact for every launch market, wrong for the US/Brazil/'
  'Australia class. A per-tenant timezone with a console field and a backfill is named, not built.';

COMMENT ON COLUMN dairy_bill_cycles.payday IS
  'W169''s "Pays Fri 17 Jul". period_end + the tenant setting dairy.cycle_payday_offset_days, resolved at insert. A '
  'DATE in the cooperative''s own calendar (0148''s ruling for grace_until): the promise is counted in whole days by '
  'the families waiting for it.';

COMMENT ON COLUMN dairy_bill_cycles.bills_failed IS
  'How many memberships errored in the last generation run. Kept because a failure leaves NO bill row, so it is the '
  'one part of the run that cannot be measured back from milk_bills afterwards — without it, "39 members did not '
  'pour" and "39 members'' bills threw" are the same silence. A cycle with bills_failed > 0 is retried by the next '
  'tick; generation is idempotent per (membership, period) via uq milk_bills.';

-- The cadence job's claim: cycles that have shut and still need bills. Partial so the sweep stays proportional to
-- work outstanding rather than to cycle history.
CREATE INDEX IF NOT EXISTS idx_dairy_cycle_needs_bills
  ON dairy_bill_cycles (closes_at)
  WHERE status = 'closed' AND deleted_at IS NULL
    AND (bills_generated_at IS NULL OR coalesce(bills_failed, 0) > 0);

-- W169's own read: this tenant's cycles, newest first.
CREATE INDEX IF NOT EXISTS idx_dairy_cycle_tenant_window
  ON dairy_bill_cycles (tenant_id, period_start DESC, payment_cycle)
  WHERE deleted_at IS NULL;

-- The open cycle whose window has just passed its close instant, per tenant.
CREATE INDEX IF NOT EXISTS idx_dairy_cycle_open_due
  ON dairy_bill_cycles (closes_at)
  WHERE status = 'open' AND deleted_at IS NULL;

ALTER TABLE dairy_bill_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dairy_bill_cycles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_dairy_bill_cycles ON dairy_bill_cycles;
CREATE POLICY tenant_isolation_dairy_bill_cycles ON dairy_bill_cycles
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- No `_uat` trigger is created here: `add_std_columns` above already creates `dairy_bill_cycles_uat`. Writing a second
-- DROP/CREATE for it would be two mechanisms for one fact, and the copy in the migration would be the one that goes
-- stale if the procedure ever changes.

-- Column-scoped UPDATE, in the spirit 0078/0080 established for the dairy money path: the application role may move
-- a cycle's STATE and record what a generation run did. It may not rewrite the window, the close instant or the
-- payday — those are the terms 312 families were shown, and a bug that edits them in place leaves no trace.
--
-- THE REVOKE BELOW IS NOT DECORATION, AND THIS IS A TRAP EVERY FUTURE MIGRATION SHOULD KNOW ABOUT.
-- This database carries ALTER DEFAULT PRIVILEGES granting kv_app INSERT+SELECT+UPDATE (and kv_relay INSERT+SELECT+
-- UPDATE+DELETE) on EVERY table created in `public`. Those grants land at CREATE TABLE time, before any GRANT written
-- here — and a TABLE-level UPDATE supersedes every column-level one. So `GRANT UPDATE (status, ...)` on a NEW table,
-- written on its own, changes NOTHING: the role already has UPDATE on all columns. This was caught by a live test
-- asserting the refusal, which passed the UPDATE it expected to be denied. 0078/0080's narrowing of `milk_collections`
-- worked only because those migrations REVOKE first, on a table that already existed.
REVOKE UPDATE, DELETE ON dairy_bill_cycles FROM kv_app;
GRANT SELECT, INSERT ON dairy_bill_cycles TO kv_app;
GRANT UPDATE (status, closed_at, bills_generated_at, bills_generated, bills_skipped, bills_failed,
              updated_at, updated_by) ON dairy_bill_cycles TO kv_app;
REVOKE ALL ON dairy_bill_cycles FROM kv_relay;

-- ---------------------------------------------------------------------------------------------------------------
-- 1d. THE SAME TRAP, CAUGHT ONE WAVE LATE, ON THIS PROGRAMME'S OWN PREVIOUS TABLE
-- ---------------------------------------------------------------------------------------------------------------
-- `milk_quality_reviews` was created by 0156 (PC-56 TENANT-6b-1) with `GRANT SELECT, INSERT, UPDATE ... TO kv_app` and
-- nothing said about kv_relay — so the default privileges above handed the RELAY role INSERT+UPDATE+DELETE on a table
-- carrying `amount_withheld_minor`, a money column. `ledger-privilege-boundary.integration.spec.ts` — a permanent P0
-- regression guard — asserts that NO relation matching the money-signal column regex holds kv_relay write grants
-- without an allow-listed reason, and it names `milk_quality_reviews`. Nothing in the dairy module gives kv_relay any
-- reason to touch that table: the review is written by the request tier, in the same transaction as the pour.
--
-- This is fixed here rather than deferred because it is THIS programme's own residue, one wave old.
--
-- IT IS NOT THE WHOLE FINDING. That guard also names ~45 other money-bearing relations created after 0079 — among them
-- coop_payout_runs, loan_disbursement_runs, cod_remittances, dbt_bounces, saas_invoices — each of which got kv_relay
-- write grants the same silent way, and the guard has evidently not been run since. Sweeping them is a wave of its own
-- (every one needs its code checked for a legitimate relay need before its grants are cut), and it is ESCALATED rather
-- than quietly widened here.
REVOKE ALL ON milk_quality_reviews FROM kv_relay;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. THE BILL'S CYCLE
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_bills ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES dairy_bill_cycles(id);

COMMENT ON COLUMN milk_bills.cycle_id IS
  'PC-56 TENANT-6c-1: the cycle this bill belongs to. NULLABLE on purpose — every bill that exists today was created '
  'by a human calling POST /dairy/milk-bills for an arbitrary period, and back-filling those into invented cycles '
  'would manufacture history. A NULL here means "billed outside any cycle", which W169 can state; it does not mean '
  '"unknown".';

CREATE INDEX IF NOT EXISTS idx_milkbills_cycle
  ON milk_bills (tenant_id, cycle_id, status)
  WHERE cycle_id IS NOT NULL AND deleted_at IS NULL;

-- W169's per-member rows: "Litres 204.5" against "13.6 L/day this cycle". `total_litres numeric(10,2)` cannot hold
-- what the pours actually weighed. Collections carry `weight_kg` to three decimals and the repository writes
-- `(milliKg / 1000).toFixed(2)` — so 204.526 kg of milk becomes 204.53 and, read back, 204,530 milli-kg. The bill
-- then disagrees with the sum of its own pours by up to 5 g per bill, forever, on the number a farmer checks first.
-- Widened rather than converted to an integer column: existing rows keep their meaning and the scale now matches the
-- source. (The float round-trip in the mapper — `Math.round(Number(total_litres) * 1000)` — is repaired in the same
-- wave; a wider column read through a double is still a guess.)
ALTER TABLE milk_bills ALTER COLUMN total_litres TYPE numeric(12,3);

COMMENT ON COLUMN milk_bills.total_litres IS
  'PC-56 TENANT-6c-1: widened from numeric(10,2) to (12,3) to match milk_collections.weight_kg. At two decimals the '
  'bill''s own litres could not equal the sum of the pours it settled, which is the first number a member checks.';

COMMENT ON COLUMN milk_bills.deductions IS
  'PC-56 TENANT-6c-1 · A DEDUCTION WITH NO DESTINATION. Shape is [{type, amount_minor}] where `type` is a FREE-TYPED '
  'STRING (dto: z.string().min(1).max(40)) — no vocabulary table, no seed, no reference to the loan, advance or '
  'policy it is supposedly repaying (Law 6). And MilkBillService.pay posts ONE ledger movement, of the NET, from the '
  'cooperative to the farmer: the deducted amount is simply never paid and never posted anywhere, so a "loan_emi" '
  'line reduces a family''s milk money by Rs 300 and reduces no loan by anything. The farmer pays that EMI twice. '
  'W169 promises "feed credit + loan EMI + insurance - each line itemised" and "Deductions above 25% of gross need '
  'the member''s fresh consent"; both are unbuilt. Until the destination exists, pay() REFUSES a bill carrying '
  'deductions (DEDUCTION_HAS_NO_DESTINATION) rather than quietly keeping the money — TENANT-6c-2 builds the '
  'destination and the consent gate.';

COMMENT ON COLUMN milk_bills.dispute_window_ends IS
  'PC-56 TENANT-6c-1 · WRITTEN BY NOBODY. W169: "member sees every pour + every deduction, 24h dispute window", and '
  'W169''s tiles count "Last cycle disputes 2 / 309". The column has a READER — apps/mobile disputeWindowOpen() — and '
  'no writer anywhere: MilkBill.generate defaults it to null, the DTO has no field for it, and update() does not '
  'touch it, so the window is closed for every bill that has ever existed. MilkBill.dispute() is likewise called by '
  'no service and no route: a member cannot raise a dispute through this platform at all. Both are TENANT-6c-2, '
  'together with the preview act that would set the window.';

COMMENT ON COLUMN milk_bills.payout_id IS
  'PC-56 TENANT-6c-1 · NEVER WRITTEN. W169 promises "Pays Fri 17 Jul - with ambassador weekly run - one bank trip"; '
  'MilkBillService.pay credits each farmer''s in-platform wallet one bill at a time and sets no payout, so there is '
  'no batch, no bank trip and no single instrument behind 312 payments. The dairy module header calls bank '
  'disbursement deferred; W169''s "one bank trip" is the claim that deferral contradicts.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. THE PAYDAY, AS A TENANT'S OWN DECISION (Law 6)
-- ---------------------------------------------------------------------------------------------------------------
-- W169 shows a fortnight closing Wed 15th and paying Fri 17th. Stored as an OFFSET IN DAYS from the close rather
-- than a weekday, because "Friday" is this cooperative's habit and not a law of milk: a monthly cycle closing on the
-- 31st pays on the 2nd, and a daily cycle may pay same-day. A hardcoded 2 would be exactly the string Law 6 exists
-- to stop.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.cycle_payday_offset_days', 'int', 'tenant', 'money_path', '2'::jsonb,
       'Days after a milk cycle''s period_end that members are paid. W169: fortnight closes Wed 15 Jul, pays Fri 17 '
       'Jul — two days for preview, dispute and approval. 0 pays on the closing day itself.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.cycle_payday_offset_days');

-- ---------------------------------------------------------------------------------------------------------------
-- 4. THE FLAG (Law 10)
-- ---------------------------------------------------------------------------------------------------------------
-- Registering the cadence job CHANGES WHAT HAPPENS ON A CLOCK: a tenant that has never had a bill generated
-- automatically would wake up to 312 drafts. That is the correct end state and it is not a change to make on a
-- treasury's behalf, so it ships OFF and is checked per tenant inside the job. OFF means exactly today's behaviour:
-- no cycle rows, no automatic bills, and the boards keep deriving the window from membership preferences and saying
-- so. What is no longer possible is the silent version, where a job exists, is documented as running, and does not.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_cycle_close',
   'PC-56 TENANT-6c-1: open and close dairy_bill_cycles on a cadence and generate each closed cycle''s draft milk '
   'bills. OFF means no cycle rows are created for the tenant and nothing generates bills on a clock — which is what '
   'this platform has always done, because MilkBillCycleCloseJob was registered nowhere and could not have run in '
   'apps/worker if it had been. ON means every closed cycle''s members get a draft bill from their own unbilled, '
   'unheld pours, idempotently. Draft bills move no money: preview, approve and pay stay human acts.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

COMMIT;
