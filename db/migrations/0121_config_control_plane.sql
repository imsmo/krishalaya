-- ============================================================================
-- MIGRATION 0121 — TARGETING THAT DOES NOT TARGET, AND A REGISTRY NO SURFACE CAN REACH (PC-56 ADMIN-11)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: `rules.plans` AND `rules.countries` ARE STORED, DISPLAYED, AND IGNORED
-- ---------------------------------------------------------------------------
-- W004's subtitle: "targeting rules: tenant_ids / plans / countries". The admin plane validates all three
-- (`rollout.ts` bounds them and charset-checks each), stores them in `feature_flags.rules`, and the console renders them.
-- **The evaluator reads one of them.** `apps/api/src/core/feature-flags/flags.service.ts` consults
-- `flag.rules.tenant_ids` and nothing else; `plans` and `countries` are typed in its row interface and never referenced.
--
-- So an operator can enable a flag for `countries: ['IN']`, see it listed as targeted, and have it serve every country
-- on the platform. **That is the shape Rule Zero exists to catch — a control that names a country and does not bound
-- one** — and it is worse than an absent feature, because the console teaches an operator that the bound is in force.
-- The fix is in code (this file adds only what the evaluator needs to resolve a tenant's plan and country in one read).
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: THE PLATFORM SETTINGS REGISTRY IS UNREACHABLE BY EVERY SURFACE
-- ---------------------------------------------------------------------------
-- `setting_definitions` has carried a `scope` column since 0002 with three values, and `scope='platform'` rows are
-- readable by nothing: the only listing query in the monorepo filters `WHERE d.scope = 'tenant'`
-- (`apps/api/.../tenant-settings.repository.ts`), and the tenant write path refuses a non-tenant scope by design. There
-- is no admin-api module, no console route, and no `settings.read`/`settings.manage` permission —
-- `grep -rn "setting_definitions" apps/admin-api/src apps/web-admin/src` returns nothing.
--
-- W103 describes the plane in one sentence: "Typed registry (setting_definitions). Platform values are the defaults;
-- tenant-scope keys can be overridden per tenant, locked keys are platform-scope. **A new setting is an INSERT, never a
-- migration — every edit is dry-run + checker.**" Every clause of that is buildable and none of it existed.
--
-- **THE MISSING LAYER IS A PLATFORM OVERRIDE.** Today a platform value can only be changed by editing
-- `default_value` — which rewrites history: the shipped default and the operator's current choice become the same
-- field, so "what did we ship" and "what did somebody set on 9 July" cannot both be answered. This file separates them.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: THE MOST DANGEROUS TOGGLE ON THE PLATFORM HAS NO SECOND PERSON
-- ---------------------------------------------------------------------------
-- W004: "Every toggle requires a reason and is **maker-checker gated for module-level flags**." The reason is enforced
-- (NOT NULL since 0036, `min(3)` in the DTO). The second person is enforced nowhere:
-- `grep -rn "SecondPerson" apps/admin-api/src/modules/flags-ops` returns nothing, while twelve other modules use the
-- shared helper. And there is no notion of a module-level flag at all — `feature_flags` has a key and no tier.
--
-- So one operator holding `flags.manage` can turn `module.listings` off for every tenant on the platform, or fire
-- `payments.kill_switch`, with a three-character reason. **FIFTEENTH maker-checker site**, and the asymmetry from
-- ADMIN-9 applies again with the sign flipped: switching a module OFF is the emergency direction and takes one person;
-- switching it back ON, or widening a rollout, is the permissive direction and takes two.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 121.1  FLAG TIERS — so "module-level" stops being a word in a subtitle
-- ---------------------------------------------------------------------------
ALTER TABLE feature_flags
  -- 'module'     — a whole capability for every tenant (module.listings). Widening it needs two people.
  -- 'experiment' — a percentage rollout of something new. One person, reasoned.
  -- 'kill_switch'— an emergency stop. One person to FIRE, two to release (see 121.3).
  ADD COLUMN tier varchar(20) NOT NULL DEFAULT 'experiment'
    CHECK (tier IN ('module', 'experiment', 'kill_switch'));

-- The existing keys tell you their own tier, and inferring it once here is honest where inferring it per-read would be
-- a rule three surfaces implement differently. Anything unrecognised stays 'experiment' — the tier that needs one
-- person — and that is the safe default only because the CHECKS above make a wrong guess visible rather than silent.
UPDATE feature_flags SET tier = 'module'      WHERE key LIKE 'module.%';
UPDATE feature_flags SET tier = 'kill_switch' WHERE key LIKE '%kill_switch%' OR key LIKE 'killswitch.%';

COMMENT ON COLUMN feature_flags.tier IS
  'What the flag governs, and therefore who may widen it. module/kill_switch flips toward MORE access need a second '
  'person (0121); experiment flips need one, reasoned. W004 says "maker-checker gated for module-level flags" and '
  'nothing had a tier to gate on.';

-- ---------------------------------------------------------------------------
-- 121.2  THE PLAN + COUNTRY THE EVALUATOR NEEDS, AS ONE INDEXED READ
-- ---------------------------------------------------------------------------
-- `rules.countries` can only be honoured if the evaluator can answer "what country is this tenant in" cheaply, on a
-- path that runs on every feature check. `tenants` carries `country_code`; the PLAN lives on `subscriptions`, one join
-- away, and a join per flag evaluation on a hot path is how a feature check becomes a latency problem.
--
-- A VIEW, not a table: a copy would need a writer and would be wrong between writes, and this platform has now found
-- three tables whose only writer was missing (0113, 0114, 0119). A view cannot go stale.
CREATE OR REPLACE VIEW tenant_flag_context AS
  SELECT t.id            AS tenant_id,
         t.country_code  AS country_code,
         p.code          AS plan_code
    FROM tenants t
    LEFT JOIN subscriptions s
      ON s.tenant_id = t.id AND s.status IN ('active', 'trialing') AND s.deleted_at IS NULL
    LEFT JOIN plans p ON p.id = s.plan_id
   WHERE t.deleted_at IS NULL;

COMMENT ON VIEW tenant_flag_context IS
  'The two facts a targeting rule needs about a tenant: country and current plan. A VIEW rather than a cached table '
  'because a copy needs a writer, and a plan/country that lags a flag decision would target the wrong tenants.';

GRANT SELECT ON tenant_flag_context TO kv_app, kv_readonly;

-- ---------------------------------------------------------------------------
-- 121.3  THE FIFTEENTH MAKER-CHECKER SITE — on the permissive direction only
-- ---------------------------------------------------------------------------
-- A proposal row rather than columns on `feature_flags`: a flag can have at most one open proposal, and the flag's own
-- row must keep describing what is CURRENTLY serving. Writing a pending value onto the live row is how a proposal
-- starts being served before anybody approved it.
CREATE TABLE feature_flag_proposals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  flag_key        varchar(80) NOT NULL REFERENCES feature_flags(key),
  -- What is being asked for. Only the permissive shapes need a proposal; a disable/kill is immediate.
  action          varchar(24) NOT NULL
                    CHECK (action IN ('enable', 'widen_rollout', 'widen_targeting', 'release_kill_switch')),
  proposed_value  jsonb NOT NULL,
  reason          text NOT NULL CHECK (length(reason) >= 20),
  proposed_by_admin_id uuid NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'approved', 'rejected', 'stale')),
  decided_by_admin_id uuid,
  decided_at      timestamptz,
  decision_reason text,
  -- **THE OBSERVED STATE, so a signature means something.** The proposer records what was serving when they asked; the
  -- applying transaction re-reads it and refuses if it moved. Without this, a proposal approved an hour later
  -- overwrites whoever changed the flag in between, and the checker's name sits on a diff that never existed. Same
  -- reasoning as 0116's `observed` on cell-map proposals, and stricter than 0114's payout drift, which reported.
  observed        jsonb NOT NULL,
  CONSTRAINT ck_ffp_maker_ne_checker CHECK (
    decided_by_admin_id IS NULL OR decided_by_admin_id <> proposed_by_admin_id
  ),
  CONSTRAINT ck_ffp_decision_evidence CHECK (
    status = 'open' OR (decided_at IS NOT NULL AND (status = 'stale' OR decided_by_admin_id IS NOT NULL))
  )
);
CALL add_std_columns('feature_flag_proposals');
-- One open proposal per flag: two competing requests to widen the same flag is a queue nobody can adjudicate, and the
-- second approver would not know they were racing.
CREATE UNIQUE INDEX uq_ffp_open_per_flag ON feature_flag_proposals(flag_key)
  WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX idx_ffp_queue ON feature_flag_proposals(created_at DESC, id) WHERE status = 'open' AND deleted_at IS NULL;

REVOKE ALL ON feature_flag_proposals FROM kv_app, kv_relay;
GRANT SELECT ON feature_flag_proposals TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 121.4  PLATFORM SETTING VALUES — separating "what we shipped" from "what we set"
-- ---------------------------------------------------------------------------
CREATE TABLE platform_setting_values (
  key           varchar(80) PRIMARY KEY REFERENCES setting_definitions(key),
  -- The platform's CURRENT value. `setting_definitions.default_value` keeps meaning the shipped default, so a reader can
  -- always answer both "what did we ship" and "what is set", and a revert has something to revert TO.
  value         jsonb NOT NULL,
  set_by_admin_id uuid NOT NULL,
  reason        text NOT NULL CHECK (length(reason) >= 20),
  -- The maker-checker evidence, on the row that serves. A money-path or security key cannot be set without both names,
  -- and `ck_psv_checker_when_required` refuses the write rather than trusting a service to remember.
  proposed_by_admin_id uuid,
  approved_by_admin_id uuid,
  requires_checker boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_psv_maker_ne_checker CHECK (
    approved_by_admin_id IS NULL OR proposed_by_admin_id IS NULL
    OR approved_by_admin_id <> proposed_by_admin_id
  ),
  CONSTRAINT ck_psv_checker_when_required CHECK (
    requires_checker = false OR (proposed_by_admin_id IS NOT NULL AND approved_by_admin_id IS NOT NULL)
  )
);
CALL add_std_columns('platform_setting_values');
REVOKE ALL ON platform_setting_values FROM kv_relay;
-- kv_app READS it: the runtime resolver's precedence becomes definition default → platform value → tenant override, and
-- the tenant API is what resolves a setting for a request. It may never WRITE one.
GRANT SELECT ON platform_setting_values TO kv_app, kv_readonly;

COMMENT ON TABLE platform_setting_values IS
  'The platform''s current value for a setting, kept apart from setting_definitions.default_value so the shipped '
  'default survives every change. Read by kv_app (precedence: default → platform value → tenant override), written '
  'only by the admin realm.';

-- ---------------------------------------------------------------------------
-- 121.5  WHICH KEYS ARE LOCKED, AND WHO MAY UNLOCK THEM
-- ---------------------------------------------------------------------------
-- W103 shows `payments.payout_hold_hours` and `security.session_max_hours` with "0 (locked)" tenant overrides and
-- "money-path settings require founder-level checker". `setting_definitions.scope` already distinguishes platform from
-- tenant, and it does NOT say whether a key is dangerous — `order.auto_confirm_hours` and `payments.payout_hold_hours`
-- are both tenant-scoped by shape and only one of them moves money.
ALTER TABLE setting_definitions
  ADD COLUMN risk_class varchar(20) NOT NULL DEFAULT 'ordinary'
    CHECK (risk_class IN ('ordinary', 'money_path', 'security')),
  -- Free text, deliberately: "why is this locked" is a sentence, and an enum of reasons would be a list somebody
  -- extends by guessing.
  ADD COLUMN lock_note text;

-- Classified by prefix, once, here. The alternative — a service that decides per read — is three surfaces disagreeing
-- about whether a key is money-path, which is the disagreement that matters most.
UPDATE setting_definitions SET risk_class = 'money_path'
 WHERE key LIKE 'payments.%' OR key LIKE 'payout%' OR key LIKE 'wallet.%' OR key LIKE 'settlement.%'
    OR key LIKE 'commission.%' OR key LIKE 'billing.%';
UPDATE setting_definitions SET risk_class = 'security'
 WHERE key LIKE 'security.%' OR key LIKE 'auth.%' OR key LIKE 'session%';

COMMENT ON COLUMN setting_definitions.risk_class IS
  'money_path and security keys need a second administrator (W103: "money-path settings require founder-level '
  'checker"). scope says WHO can override a key; this says how dangerous changing it is, and they are different '
  'questions — order.auto_confirm_hours and payments.payout_hold_hours are both tenant-scoped and only one moves money.';

-- ---------------------------------------------------------------------------
-- 121.6  THE CHANGE HISTORY — one table for both objects, because the question is one question
-- ---------------------------------------------------------------------------
-- `feature_flag_changes` (0036) already records flag flips well. Settings need the same, and "what changed in platform
-- configuration last Tuesday" is a question an operator asks across BOTH — so this table takes either, with a CHECK
-- that exactly one target is named. A single polymorphic column pair would make "which flag" unanswerable by index.
CREATE TABLE platform_config_changes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  setting_key   varchar(80) REFERENCES setting_definitions(key),
  action        varchar(30) NOT NULL
                  CHECK (action IN ('defined', 'retyped', 'value_set', 'value_reverted', 'locked', 'unlocked',
                                    'proposed', 'approved', 'rejected')),
  old_value     jsonb,
  new_value     jsonb,
  reason        text NOT NULL,
  actor_admin_id uuid NOT NULL,
  -- The second name, when there was one. NULL on a single-person act, which is legitimate for an ordinary key and is
  -- exactly what a reviewer scans this column for.
  checker_admin_id uuid,
  -- The blast radius AT THE TIME. W103's audit note reads "ripples to all 2,847 tenants (0 overrides — platform-locked
  -- key)", and that count is only true on the day it was written: recording it later would mean re-deriving a number
  -- from a tenant list that has changed.
  tenants_affected integer CHECK (tenants_affected IS NULL OR tenants_affected >= 0),
  overrides_shadowing integer CHECK (overrides_shadowing IS NULL OR overrides_shadowing >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pcc_target CHECK (setting_key IS NOT NULL),
  CONSTRAINT ck_pcc_maker_ne_checker CHECK (checker_admin_id IS NULL OR checker_admin_id <> actor_admin_id)
);
CREATE INDEX idx_pcc_key ON platform_config_changes(setting_key, created_at DESC, id);
CREATE INDEX idx_pcc_recent ON platform_config_changes(created_at DESC, id);

REVOKE ALL ON platform_config_changes FROM kv_app, kv_relay;
-- Append-only, and revoked from kv_admin too: a configuration history the configuring realm can edit is a history that
-- proves nothing about the configuring realm. Same rule as 0119's action log and 0120's receipts.
REVOKE UPDATE, DELETE, TRUNCATE ON platform_config_changes FROM kv_admin;
GRANT SELECT ON platform_config_changes TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 121.7  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO DRY-RUN RESULT TABLE.** W103 shows a dry run ("Payouts released earlier 4,182 · Value moved sooner ₹2,84,16,500")
-- and this file stores no dry-run output, because a stored dry run is a number that ages: approving on Thursday a dry
-- run computed on Monday would show a blast radius that has moved. The proposal carries `observed`, the dry run is
-- computed when the approval screen is opened, and ADMIN-11-Q1 owns the per-key impact queries beyond the counts this
-- wave computes (tenants affected, overrides shadowed).
--
-- NO SETTING-DEFINITION DELETE. A definition with tenant overrides cannot be deleted without orphaning them, and
-- `tenant_settings.key` FKs to it. Deprecation is a lock plus a note, which is what "never a migration" implies: the
-- registry only grows.
--
-- NO CHANGE TO `setting_definitions.default_value` SEMANTICS. It stays the shipped default, for ever. That is the whole
-- reason 121.4 exists.
