-- =============================================================================================
-- 0148_billing_grace_state.sql · PC-56 TENANT-4d-4 — THE GRACE PERIOD BECOMES A STATE
-- =============================================================================================
-- W120's footnote, in full: "If a renewal payment fails, service enters a **grace period** — nothing
-- switches off for 7 days while we retry and notify you. Your members never feel a billing hiccup."
--
-- TENANT-4d-2 named that as a GAP-BACKEND and deliberately refused to schedule the SaaS billing cadence,
-- because doing so would have activated `GracePeriodJob` and started expiring subscriptions on the day
-- their period ended. This migration is why that refusal was right, and what it takes to lift it.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): NOTHING EVER ADVANCES A SUBSCRIPTION'S BILLING PERIOD
-- ---------------------------------------------------------------------------------------------
-- `Subscription.subscribe()` sets `current_period_end = nextPeriodEnd(now, cycle)` — and that is the ONLY
-- place in the monorepo it is ever computed. `SubscriptionRepository.update` can write the column, and the
-- only caller that passes a new value is `changePlan` (which keeps the period deliberately). grep for
-- `nextPeriodEnd(` across apps/: two hits in tenancy (the helper and `subscribe`), and three in
-- **memberships**, which does the right thing one module away — `UserMembership.renew()` advances the
-- period when a membership payment is confirmed.
--
-- So every tenant's `current_period_end` passes and never moves. Three things follow, and all three are
-- live today:
--   (a) `findDueToRenew` (`current_period_end <= now`) returns the SAME subscription on every tick for
--       ever. It raises exactly ONE invoice — the first period's — and from then on `existsForPeriod`
--       skips it, because the period tag never changes. A tenant is billed once and never again.
--   (b) `findDueToExpire` (`current_period_end < now`) matches EVERY live subscription within a month of
--       being created. Scheduling that job expires the entire platform, and it expires a tenant who paid
--       on time exactly as fast as one who never paid — because payment does not move the period.
--   (c) W120's "next debit 01 Aug" and any renewal date shown to a tenant are dates that will never
--       advance.
-- This is why 4d-2 refused to wire the cadence. The period must roll before a sweep may run.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: THE INVOICE KNOWS IT WAS PAID AND THE SUBSCRIPTION NEVER HEARS
-- ---------------------------------------------------------------------------------------------
-- `tenancy.saas_invoice_paid` is emitted by `SaasInvoiceService.applyPayment` (through the outbox, Law 4)
-- and **has no subscriber anywhere in the monorepo** — the only other match for the string is a metrics
-- counter. So the one event that should advance the billing period is written to the outbox, relayed, and
-- dropped. The join between "the bill is settled" and "the subscription continues" was never made.
-- This wave subscribes to it (event-driven, via the OutboxRelayRunner that already drains the registry).
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: `past_due` HAS EXISTED SINCE 0002 AND NOTHING HAS EVER WRITTEN IT
-- ---------------------------------------------------------------------------------------------
-- The enum has it; `subscription.state.ts` allows `active → past_due → active|cancelled|expired`;
-- `isLive` selects it; `findLiveForTenant` selects it; `plan-compare` reads it; TENANT-4d-1 made
-- `grantsQuota` honour it precisely so a tenant inside the grace period keeps its limits. Every consumer
-- was built. No producer ever was. `past_due` is the state W120's grace period is made of, and this
-- migration gives it the two columns it needs plus the writer (`Subscription.enterGrace`).
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: THE JOB NAMED FOR THE GRACE PERIOD DOES THE OPPOSITE OF ITS NAME
-- ---------------------------------------------------------------------------------------------
-- `jobs/grace-period.job.ts` moves live → EXPIRED the moment `current_period_end` passes. Its own header
-- says so ("it does NOT auto-charge a renewal"). With defect 1 that makes it a platform-wide kill switch.
-- After this wave the sweep may only expire a subscription whose GRACE has lapsed, and `expire()` refuses
-- while `grace_until` is in the future — one mechanism, guarded in the entity, not two code paths.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS WAVE DOES **NOT** CLAIM — "while we retry and notify you"
-- ---------------------------------------------------------------------------------------------
-- W120's footnote promises three things. This wave delivers ONE of them honestly and refuses to fake the
-- other two:
--   • "nothing switches off for 7 days" — BUILT (this migration + the state + the cadence).
--   • "while we RETRY" — **there is nothing to retry.** SaaS billing is invoice-based; there is no autopay
--     mandate for a subscription anywhere in the payments module (4d-2's named gap: the autopay plane has
--     no notion of a subscription or a SaaS invoice). A retry loop needs an instrument to retry against.
--     What the tenant can do is PAY the open invoice (W2428, built in 4d-2). So the console says "pay the
--     open invoice before <date>" and does NOT claim we are retrying anything.
--   • "and NOTIFY you" — the five tenancy events (`saas_invoice_issued`, `saas_invoice_paid`,
--     `saas_invoice_overdue`, `trial_ending`, `usage_limit_alert`) are in NO notification map row and have
--     no catalog code or templates, so nothing has ever notified a tenant about its billing. That is a
--     plane of its own (catalog rows, templates × 3 launch languages, and the question of who a tenant's
--     billing recipients are — the events carry `tenantId`, and `recipientKeys` reads user ids from the
--     payload). **TENANT-4d-5.** Until then the grace period is silent, and W120 says so rather than
--     claiming a notice nobody sends.
-- Also NOT wired here: `TrialExpiryJob` and `UsageLimitAlertsJob`, the two remaining dead classes. Each
-- needs its own diff (a trial that ends is a conversion decision; the usage alert is 4d-1's threshold and
-- belongs with the notification plane). Named, not smuggled in.
--
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 148.1  THE GRACE WINDOW, AS TWO COLUMNS ON THE SUBSCRIPTION
-- ---------------------------------------------------------------------------------------------
-- `grace_until` is a DATE, not a timestamp: the promise is "7 days", counted in days, and a tenant in
-- Gujarat and one in Dhaka must both get whole days rather than a window that expires mid-afternoon
-- because of the timezone the platform happens to run in (the hidden-timezone defect TENANT-4b found in a
-- wall-clock cut-off).
ALTER TABLE subscriptions ADD COLUMN grace_until      date;
ALTER TABLE subscriptions ADD COLUMN grace_started_at timestamptz;

-- Both or neither. A `grace_until` with no start is a window nobody opened; a start with no end is a
-- window that never closes — and a subscription that never closes its grace window never expires, which
-- is the failure mode a tenant would never report.
ALTER TABLE subscriptions ADD CONSTRAINT ck_subscription_grace_pair
  CHECK ((grace_until IS NULL) = (grace_started_at IS NULL));

COMMENT ON COLUMN subscriptions.grace_until IS
  'PC-56 TENANT-4d-4: the date through which service continues after an unpaid period end (W120: "nothing switches off for 7 days"). Set when the subscription enters `past_due`; CLEARED when the renewal invoice is paid and the period rolls. A DATE, not a timestamp, because the promise is counted in whole days in the tenant''s own calendar rather than in the platform''s timezone. NULL means the subscription is not in a grace window — which is the normal state, not a missing value.';
COMMENT ON COLUMN subscriptions.grace_started_at IS
  'PC-56 TENANT-4d-4: when the grace window opened, kept alongside grace_until so "how long has this tenant been past due" is a stored fact rather than arithmetic on a date whose length is a setting that may since have changed.';

-- ---------------------------------------------------------------------------------------------
-- 148.2  THE INDEXES THE TWO SWEEPS NEED
-- ---------------------------------------------------------------------------------------------
-- The grace-expiry sweep: past-due subscriptions whose window has closed. Partial, so it costs nothing
-- for the 99.9% of subscriptions that are not past due.
CREATE INDEX idx_subscriptions_grace_lapsed
  ON subscriptions (grace_until)
  WHERE status = 'past_due' AND grace_until IS NOT NULL AND deleted_at IS NULL;

-- The period-end sweep (grace ENTRY and renewal billing): live subscriptions at/after their period end.
-- 0002 indexed nothing for this, so both jobs' finders were sequential scans over every subscription on
-- the platform — invisible at pilot scale and a full scan per tick at a million tenants (Law 8's spirit:
-- a bounded, prunable predicate, not a table sweep).
CREATE INDEX idx_subscriptions_period_end_live
  ON subscriptions (current_period_end)
  WHERE status IN ('trialing', 'active', 'past_due', 'paused') AND deleted_at IS NULL;

COMMENT ON INDEX idx_subscriptions_grace_lapsed IS
  'PC-56 TENANT-4d-4: serves the grace-expiry sweep (past_due with a closed window). Partial so it is tiny — a platform where this index is large has a collections problem, not an indexing one.';
COMMENT ON INDEX idx_subscriptions_period_end_live IS
  'PC-56 TENANT-4d-4: serves BOTH the renewal-billing finder and the grace-entry sweep. Before this wave neither had an index and both scanned every subscription row on every tick.';

-- ---------------------------------------------------------------------------------------------
-- 148.3  HOW LONG THE GRACE PERIOD IS — A SETTING, NOT A 7
-- ---------------------------------------------------------------------------------------------
-- W120 says 7 days. Seven is a number a co-operative's contract, a country's norms, or a platform
-- agreement may differ on, so it is a tenant-scoped setting whose shipped default is the number on the
-- screen (the pattern 0145 used for the usage-alert threshold, and for the same reason).
--
-- A malformed or out-of-range value falls back to the DEFAULT, never to zero: a grace period of zero days
-- switches a tenant off the instant their period ends, which is the exact behaviour this wave exists to
-- remove, and it would be reached by a typo.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
-- **PC-56 TENANT-4d-5 CHAIN REPAIR: `risk_class` WAS 'operational', WHICH 0121's CHECK FORBIDS.**
-- `setting_definitions.risk_class` is constrained to ('ordinary', 'money_path', 'security') by
-- 0121_config_control_plane.sql, so this row failed with
--     ERROR: new row for relation "setting_definitions" violates check constraint
--            "setting_definitions_risk_class_check"
-- and the runner's one-transaction-per-file rollback stopped the chain here. **The consequence is not
-- cosmetic: this setting definition has never existed in any database**, so the value this wave moved out
-- of code and into configuration was never configurable. 'ordinary' is the right class — this threshold
-- is neither a money path nor security copy — and a spec now asserts every migration's `risk_class`
-- against 0121's vocabulary, which is what would have caught it.
SELECT 'billing.grace_days', 'int', 'tenant', 'ordinary', '7'::jsonb,
       'Days a tenant''s service continues after an unpaid period end before the subscription expires (W120: "nothing switches off for 7 days"). A value outside 1..90 falls back to 7 rather than to 0, because 0 would switch a tenant off the moment their period ended — the behaviour PC-56 TENANT-4d-4 removed — and would be reached by a typo. 0 is deliberately NOT a way to disable the grace period: use the `saas_billing_grace` flag for that.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'billing.grace_days');

-- ---------------------------------------------------------------------------------------------
-- 148.4  THE FLAGS (Law 10) — both default OFF
-- ---------------------------------------------------------------------------------------------
-- The grace state itself. With this ON, an unpaid period end moves the subscription to `past_due` with a
-- window instead of leaving it silently past its end date. OFF is the behaviour before this wave: nothing
-- writes `past_due`, so nothing enters a window, so `expire()`'s new guard never fires and the sweep
-- behaves exactly as it did — which is what makes this flag a real kill switch rather than a label.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'saas_billing_grace',
       'PC-56 TENANT-4d-4: an unpaid period end enters a GRACE window (subscription → past_due, grace_until = period end + billing.grace_days) instead of the subscription sitting past its end date; the sweep may then only expire a subscription whose window has closed. OFF keeps the pre-wave behaviour, in which nothing writes past_due at all.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'saas_billing_grace');

-- The cadence. Separate from the state on purpose: the sweep is what makes anything happen on a clock,
-- and a founder must be able to turn the clock off without unwinding the state machine (and vice versa).
-- **THIS IS THE FLAG THAT LIFTS 4d-2's REFUSAL.** With it ON the billing cycle runs: raise the renewal
-- invoice at period end, mark owing invoices overdue, open a grace window, and expire only a window that
-- has closed. With it OFF nothing is scheduled, which is exactly where 4d-2 left the platform.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'saas_billing_cadence',
       'PC-56 TENANT-4d-4: run the SaaS billing cycle on a schedule (renewal invoice at period end -> overdue sweep -> grace entry -> expire a lapsed window). OFF means no tick does anything, which is the state TENANT-4d-2 deliberately left the platform in because expiring subscriptions before the period could roll would have switched off every paying tenant.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'saas_billing_cadence');
