-- ============================================================================
-- MIGRATION 0126 — AN UPGRADE CHARGES NOTHING, AND A DOWNGRADE TAKES EFFECT THE SAME SECOND (PC-56 TENANT-1d)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: AN UPGRADE IS FREE. NOT MIS-BILLED — FREE.
-- ---------------------------------------------------------------------------
-- W119 (Compare & Upgrade) prints an invoice, line by line:
--
--   Professional, 13–31 Jul (19 days prorated)          ₹12,257
--   Unused Growth credit, 13–31 Jul (rounded in your favour)  −₹5,516
--   Due now (INR, excl. GST)                             ₹6,741
--   GST 18%                                              ₹1,213
--   Total due — invoiced on upgrade, due in 7 days       ₹7,954
--   "This action is recorded · plan change · idempotent — a double click cannot charge twice"
--
-- `SubscriptionService.changePlan` does this:
--
--     sub.changePlan(plan.id, plan.priceFor(sub.toProps().billingCycle));
--     await this.repo.update(tx, sub);
--     await this.audit.write(tx, { ... action: 'subscription.plan_changed' ... });
--
-- It swaps the plan id and the price on the subscription row, writes an audit line, and **bills nothing at all**. No
-- invoice, no charge, no credit, no proration. `grep -rln "prorat" apps packages` returns NOTHING across the monorepo.
--
-- So a tenant on Starter (₹2,999) can move to Professional (₹19,999) on day two of a cycle, get every Professional
-- capability immediately, and be invoiced ₹0 for the difference. The next renewal bills the new price, so the platform
-- silently forgoes the remainder of the cycle on **every upgrade it ever processes**. At 15,000 tenants by Y3 that is not
-- a rounding error, and it is invisible: there is no failed payment, no dunning row, no anomaly — just revenue that was
-- never invoiced.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: A DOWNGRADE TAKES EFFECT IMMEDIATELY, AND W119 SAYS IT MUST NOT
-- ---------------------------------------------------------------------------
-- "Upgrades apply immediately with to-the-day proration; **downgrades apply at period end — no clawbacks mid-cycle**."
-- And: "Downgrade takes effect 01 Aug."
--
-- `changePlan` has one path. A downgrade lands the same second as an upgrade, which is wrong twice over: the tenant
-- loses capability they have already paid for until the period end, and the platform owes a refund it has no mechanism
-- to compute or pay. The canon's rule is the correct one and it is also the simpler one — a scheduled change needs a
-- pending pointer, not a clawback engine.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: "IDEMPOTENT — A DOUBLE CLICK CANNOT CHARGE TWICE" IS TRUE OF NOTHING
-- ---------------------------------------------------------------------------
-- The screen promises it in those words. `changePlan` takes no idempotency key, and two clicks in the same second on a
-- money-moving action would today produce two audit rows and (once billing exists) two invoices. This file gives the
-- change its own idempotent identity so the promise can be kept by construction rather than by the button being
-- disabled in a browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 126.1  THE SCHEDULED CHANGE — a pending pointer, not a clawback engine
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions
  -- Where a DOWNGRADE waits until the period end. NULL = nothing scheduled, which is the overwhelmingly common state.
  ADD COLUMN pending_plan_id uuid REFERENCES plans(id),
  ADD COLUMN pending_price_minor bigint CHECK (pending_price_minor IS NULL OR pending_price_minor >= 0),
  ADD COLUMN pending_effective_date date,
  -- Why it is pending, in the words the tenant was shown. A scheduled change with no reason on it is an unpleasant
  -- surprise on the first of the month.
  ADD COLUMN pending_reason varchar(300),
  -- **THE THREE COLUMNS MOVE TOGETHER OR NOT AT ALL.** A pending plan with no date would never apply; a date with no
  -- plan would apply nothing. Either is a scheduled change that silently does not happen, which is the failure mode a
  -- tenant discovers when their bill does not change.
  ADD CONSTRAINT ck_sub_pending_complete CHECK (
    (pending_plan_id IS NULL AND pending_effective_date IS NULL AND pending_price_minor IS NULL)
    OR (pending_plan_id IS NOT NULL AND pending_effective_date IS NOT NULL AND pending_price_minor IS NOT NULL));

-- The worker's sweep: which subscriptions have a change due today. Partial, so it costs nothing on the 99.9% with none.
CREATE INDEX idx_sub_pending_due ON subscriptions(pending_effective_date)
  WHERE pending_plan_id IS NOT NULL;

COMMENT ON COLUMN subscriptions.pending_effective_date IS
  'When a scheduled DOWNGRADE applies — always the current period end (0126). W119: "downgrades apply at period end — no clawbacks mid-cycle". Before this migration a downgrade applied the same second, so a tenant lost capability they had paid for and the platform owed a refund it could not compute.';

-- ---------------------------------------------------------------------------
-- 126.2  THE RECORD EVERY PLAN CHANGE LEAVES
-- ---------------------------------------------------------------------------
CREATE TABLE subscription_plan_changes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  from_plan_id    uuid NOT NULL REFERENCES plans(id),
  to_plan_id      uuid NOT NULL REFERENCES plans(id),
  -- upgrade | downgrade | lateral. Stored rather than derived, because it is derived from the PRICES AT THE TIME and
  -- a plan's price can be edited afterwards: re-deriving this in a year could relabel a historical upgrade as a
  -- downgrade, which is the same class of error 0122 fixed for template wording.
  direction       varchar(10) NOT NULL CHECK (direction IN ('upgrade', 'downgrade', 'lateral')),
  -- Immediate for an upgrade, the period end for a downgrade.
  effective_date  date NOT NULL,
  applied_at      timestamptz,                        -- NULL while a downgrade waits

  -- ---- the arithmetic, in minor units, every component kept ----------------
  -- **THE INPUTS ARE STORED, NOT JUST THE ANSWER.** A tenant who queries an invoice in March wants to know how 19 days
  -- became ₹12,257, and recomputing it then would use today's plan price and today's calendar. Law 2: bigint minor
  -- units throughout, never a float, never a rate multiplied client-side.
  days_in_period      integer NOT NULL CHECK (days_in_period > 0),
  days_remaining      integer NOT NULL CHECK (days_remaining >= 0),
  from_price_minor    bigint NOT NULL,
  to_price_minor      bigint NOT NULL,
  new_plan_charge_minor bigint NOT NULL DEFAULT 0 CHECK (new_plan_charge_minor >= 0),
  unused_credit_minor   bigint NOT NULL DEFAULT 0 CHECK (unused_credit_minor >= 0),
  -- charge − credit, floored at zero. **A NEGATIVE NET IS NEVER A CHARGE AND NEVER A SILENT REFUND**: it means the
  -- credit exceeded the new plan's remainder, which on a downgrade is normal and is why downgrades are scheduled
  -- instead of billed. Recorded as zero with the components intact so the reader can see why.
  net_due_minor       bigint NOT NULL DEFAULT 0 CHECK (net_due_minor >= 0),
  tax_bp              integer NOT NULL DEFAULT 0 CHECK (tax_bp >= 0 AND tax_bp <= 10000),
  tax_minor           bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_due_minor     bigint NOT NULL DEFAULT 0 CHECK (total_due_minor >= 0),
  currency_code       char(3) NOT NULL REFERENCES currencies(code),

  -- The invoice this change raised, where it raised one. A downgrade raises none.
  invoice_id      uuid REFERENCES saas_invoices(id),

  -- **THE IDEMPOTENCY THE SCREEN PROMISES, ENFORCED BY A UNIQUE INDEX RATHER THAN BY A DISABLED BUTTON.** "idempotent —
  -- a double click cannot charge twice" is W119's own sentence, and a browser is the wrong place to keep it.
  idempotency_key varchar(120) NOT NULL,

  -- What the tenant was over, if anything, at the moment of the change. W119: "you have 1,284 members and 7 staff — over
  -- Starter's limits (500 / 2). Existing members are never removed; you just can't add more until within limits."
  -- Recorded AT THE TIME because the counts move daily and the warning a tenant accepted is part of the decision.
  limit_breaches  jsonb NOT NULL DEFAULT '[]',
  actor_user_id   uuid REFERENCES users(id),
  reason          varchar(300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CALL add_std_columns('subscription_plan_changes');

CREATE INDEX idx_spc_sub ON subscription_plan_changes(subscription_id, created_at DESC);
CREATE INDEX idx_spc_pending ON subscription_plan_changes(effective_date) WHERE applied_at IS NULL;

-- Append-only for the app; the platform realm reads it and cannot rewrite it. A billing history the billed party can
-- edit is not a billing history — the same rule 0119, 0120, 0121 and 0123 applied to their evidence tables.
REVOKE ALL ON subscription_plan_changes FROM kv_relay;
REVOKE DELETE, TRUNCATE ON subscription_plan_changes FROM kv_app, kv_admin;
REVOKE INSERT, UPDATE ON subscription_plan_changes FROM kv_admin;
GRANT SELECT, INSERT, UPDATE ON subscription_plan_changes TO kv_app;
GRANT SELECT ON subscription_plan_changes TO kv_readonly;

-- RLS: this carries `tenant_id`, so 0014's idempotent sweep will pick it up. Stated because a reader who checks the
-- grants and not the policy would think a tenant could read another tenant's plan history.
ALTER TABLE subscription_plan_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_plan_changes ON subscription_plan_changes
  FOR ALL
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- 126.3  THE TAX RATE AS A SETTING, NOT A CONSTANT
-- ---------------------------------------------------------------------------
-- W119 prints "GST 18%". **18 IS AN INDIAN NUMBER AND THIS PLATFORM GOES TO BANGLADESH IN Y6.** A constant would be a
-- shortcut that blocks a country — rule zero, in one line of code. It is a platform setting (ADMIN-11's registry) with
-- `risk_class = 'money_path'`, so changing it takes two administrators.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES (
  'billing.tax_bp', 'int', 'platform', 'money_path', '1800'::jsonb,
  'Tax applied to SaaS invoices, in basis points (1800 = 18%, India GST). Per-country rates are a future refinement (TENANT-1d-Q2); this is the platform default.',
  'This multiplies every tenant invoice. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 126.4  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO CLAWBACK, EVER.** W119 is explicit ("no clawbacks mid-cycle") and it is right: money already collected for a
-- period the tenant has partly used is not the platform's to reclaim unilaterally. A downgrade is scheduled; the credit
-- for the unused remainder is expressed by the tenant keeping the plan they paid for until the period ends.
--
-- NO PER-COUNTRY TAX TABLE. One platform-wide rate today, named as such (TENANT-1d-Q2). A per-country table is real work
-- (place of supply, reverse charge, registration thresholds) and inventing half of it here would produce numbers a
-- finance team cannot file.
--
-- NO PAYMENT COLLECTION ON UPGRADE. The invoice is raised with a 7-day due date, exactly as W119 says ("invoiced on
-- upgrade, due in 7 days"), and ADMIN-1's dunning plane already owns what happens if it goes unpaid. Charging a card on
-- upgrade would also contradict W113's promise: "no card on file, so nothing can be charged by surprise".
--
-- NO RETRO-INVOICING OF UPGRADES ALREADY PROCESSED FOR FREE. The audit query for the founder's decision:
--   SELECT a.tenant_id, a.entity_id, a.created_at, a.new_value
--     FROM audit_log a
--    WHERE a.action = 'subscription.plan_changed'
--      AND NOT EXISTS (SELECT 1 FROM subscription_plan_changes c WHERE c.subscription_id = a.entity_id::uuid);
-- Every row it returns is a plan change that moved capability and billed nothing. Whether to invoice retrospectively is
-- a commercial decision, not a migration's.
