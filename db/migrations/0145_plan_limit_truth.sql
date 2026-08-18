-- =============================================================================================
-- 0145_plan_limit_truth.sql · PC-56 TENANT-4d-1 — THE PLAN'S LIMITS, MEASURED AND ENFORCED
-- =============================================================================================
-- W118 (Plan & usage) draws four meters — "Members 1,284 / 5,000 · 26% of plan limit", "Staff seats 7 / 10",
-- "API calls (month) 1,84,200 / 5,00,000", "Storage 18.4 / 50 GB" — and states the rule under them: "at 90%
-- of any limit you get a console + email notice; at 100% new additions pause (existing operations never
-- do)". W115 (onboarding: choose plan) offers three plans, a 14-day trial and a price lock.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): THE METERS AND THE ENFORCEMENT SPEAK DIFFERENT VOCABULARIES, SO
--                          NEITHER SIDE MEETS THE OTHER AND NOTHING W118 DRAWS IS ENFORCED.
-- ---------------------------------------------------------------------------------------------
-- THIRTEEN modules call `QuotaService.assertWithinLimit(tenantId, metric)` before their write, with metric
-- codes of their own: labour_bookings, land_parcels, service_offerings, warehouses, export_shipments,
-- insurance_claims, insurance_policies, farming_contracts, scheme_applications, loan_applications,
-- max_listings_month, equipment_assets, animals.
-- THREE limit codes are seeded, in db/seeds/rules/0201_plans_limits_features.sql: max_farmers,
-- max_orders_month, max_languages.
-- The intersection is EMPTY.
--
-- And `quota.service.pg.ts` reads: `if (lim.rowCount === 0) return;  // no limit configured ⇒ unlimited`.
-- That fail-open is right in itself — a missing limit must not block a tenant's work — but it means all
-- thirteen gates return immediately, every time, for every tenant and every plan. Thirteen quota checks
-- that cannot fire, and three plan limits that nothing checks. Neither half is broken on its own; the join
-- between them was never made.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: it does not seed limit rows for those thirteen metrics.
-- Choosing what a Starter tenant may do 100 or 1,000 times a month is a PRICING decision that belongs to
-- the founder and the revenue playbook, not to a parity wave — and seeding a number would silently begin
-- refusing writes for live tenants. Recorded as a founder decision, with the exact list above so the
-- decision can be made once and seeded once.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: TWO OF W118's FOUR METERS CANNOT BE READ AT ALL, AND ONE IS THE WRONG SHAPE
-- ---------------------------------------------------------------------------------------------
--   Members      -> `max_farmers` IS seeded (100 / 5,000 / 50,000 / -1 per tier). Nothing counts members
--                   against it and nothing enforces it. This wave makes it real (defect 3).
--   Staff seats  -> no limit code, and NOT COUNTABLE FROM DATA: `roles` has `scope` (platform|tenant) and
--                   no notion of which tenant roles occupy a paid SEAT. The classification is a fact about
--                   what the product sells, so this wave declares it in code (as TENANT-3c-2 declared
--                   charge surfaces and TENANT-4a declared account writers) and says on the screen that a
--                   column would be better once pricing defines a seat.
--   API calls    -> no limit code, no counter, and no metering middleware writes one. `not_measured`.
--   Storage      -> no limit code and no counter. Also `not_measured`.
--
-- AND THE SHAPE PROBLEM, which matters more than any single missing row: `usage_counters` is keyed
-- (tenant_id, metric_code, PERIOD) and accumulated with `used_value = used_value + EXCLUDED.used_value`.
-- That models a FLOW (orders this month, API calls this month). Members and staff seats and storage are
-- STOCKS: they go down as well as up. A stock accumulated into a monthly counter drifts the moment a member
-- leaves, and the drift is invisible — the meter would read 1,284 for ever while the roster showed 1,190.
-- So this wave counts stocks LIVE from their own table and reads only flows from `usage_counters`, and the
-- domain says which is which so a future metric cannot be filed under the wrong one by accident.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: "AT 90% A NOTICE" IS A JOB DEFAULT OF 80%, AND "AT 100% NEW ADDITIONS PAUSE" IS NOWHERE
-- ---------------------------------------------------------------------------------------------
-- `UsageLimitAlertsJob.run(limit = 2000, thresholdPct = 0.8)`: the screen promises 90% and the job fires at
-- 80%. A tenant told "you will hear from us at 90%" hears at 80% — harmless, and still a promise the
-- product does not keep, so the threshold becomes a SETTING (Law 6) whose default is the number on the
-- screen. The pause at 100% does not exist anywhere: adding a member calls no quota gate at all.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: A TRIALING TENANT ESCAPES EVERY LIMIT
-- ---------------------------------------------------------------------------------------------
-- `subscription.state.ts`: `grantsQuota(s) => s === 'active'`. W115 sells "14 days free" ON A CHOSEN PLAN —
-- a trial of Growth is a trial of Growth's limits, not of unlimited everything. Today the only tenants a
-- limit could apply to are those already paying, which is exactly backwards for abuse: a fresh trial is the
-- cheapest place to mine a platform. Fixed in the domain (code, not schema) so a trial carries the limits
-- of the plan it is a trial of; recorded here because the fix is invisible in the schema.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 5: W115's PLAN CHOICE DOES NOT EXIST — EVERY SIGNUP LANDS ON ONE PLATFORM DEFAULT
-- ---------------------------------------------------------------------------------------------
-- W115 is "Step 3 of 4 · Choose plan" with three cards and three "Start trial on X" buttons.
-- `TenantSignupService` reads `signup.trial_plan_code` from platform settings and calls
-- `repo.trialPlan(tx, policy.trialPlanCode, countryCode)`: the tenant's choice is not a parameter of
-- signup. Every co-operative on the platform is trialing whichever plan the platform picked. The API now
-- accepts an optional plan code, validated against PUBLIC ACTIVE plans for the tenant's country, behind a
-- flag — because opening a public unauthenticated endpoint to a new field is a change that deserves one.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT IS ALREADY RIGHT AND IS THEREFORE NOT TOUCHED
-- ---------------------------------------------------------------------------------------------
-- The PRICE LOCK W118 prints ("Growth (v3, price-locked)") is real: 0002 gives `plans` a `version` with
-- `UNIQUE (code, version, country_code)` and a comment saying old tenants keep old versions, and
-- `subscriptions.plan_id` points at that exact versioned row — so a price change is a new plan row and a
-- live subscription keeps pointing at the one it signed. Proven live in this wave rather than assumed, and
-- the version is now printed on the screen instead of being a claim about a column nobody read.
-- The 14-day trial is real too (`signup.trial_days`, and a malformed setting falls back to the published
-- default rather than to zero — 0130's rule).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 145.1  THE NOTICE THRESHOLD BECOMES THE NUMBER ON THE SCREEN, AND A TENANT CAN MOVE IT
-- ---------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'plans.usage_alert_threshold_pct', 'int', 'tenant', 'operational', '90'::jsonb,
       'Percentage of a plan limit at which a tenant is notified (W118: "at 90% of any limit you get a console + email notice"). The alert job used a hardcoded 80. A value outside 1..100 falls back to 90 rather than to 0, because a threshold of 0 would alert on every metric for every tenant for ever.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'plans.usage_alert_threshold_pct');

-- ---------------------------------------------------------------------------------------------
-- 145.2  THE INDEX THE LIVE STOCK COUNTS NEED
-- ---------------------------------------------------------------------------------------------
-- Members and staff seats are counted live from `user_tenant_roles` (see defect 2). At 75M households the
-- count must not be a scan of every role row on the platform.
CREATE INDEX IF NOT EXISTS idx_utr_tenant_live
  ON user_tenant_roles (tenant_id, role_id) WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_utr_tenant_live IS
  'PC-56 TENANT-4d-1: serves the live member and staff-seat counts W118 meters. These are STOCKS (they go down as well as up) and are therefore counted from their own table rather than accumulated into usage_counters, which models monthly FLOWS and would drift the moment a member left.';

-- ---------------------------------------------------------------------------------------------
-- 145.3  THE FLAGS (Law 10) — both default OFF, because both change behaviour a tenant would feel
-- ---------------------------------------------------------------------------------------------
-- The pause: with this ON, adding a member to a tenant at 100% of its plan's member limit is REFUSED by
-- name (existing operations are never touched — W118's own words). OFF keeps today's behaviour, in which
-- the limit is displayed and nothing enforces it.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'plan_limit_enforcement',
       'PC-56 TENANT-4d-1: enforce the plan member limit when a member is added (W118: "at 100% new additions pause"). OFF displays the meter without enforcing it, which is the behaviour before this wave.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'plan_limit_enforcement');

-- The choice: with this ON, signup accepts a plan code (W115's three cards). OFF keeps every signup on the
-- platform's configured trial plan.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'signup_plan_choice',
       'PC-56 TENANT-4d-1: signup accepts an optional plan code chosen by the tenant (W115 step 3 of 4), validated against public active plans for their country. OFF keeps the single platform-configured trial plan.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'signup_plan_choice');
