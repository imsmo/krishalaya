-- ==================================================================================================================
-- MIGRATION 0237 — PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE — an alert rule learns that a change which could make
-- an alert QUIETER is a PROPOSAL until a SECOND person confirms it. One new table (the proposals and how each ended), two
-- CHECKs that matter (the confirmer is never the proposer; a reason of at least ten characters), one partial unique index
-- (one open proposal per rule), two guard triggers, three pure helper functions; no flag, no backfill, no notification.
-- (OPS-5 Q3-A, applied by the lead on 2026-11-10 under the founder's instruction of that day: "if you need any help please
-- select recommended option or choose as per your thinking" — `survey_ops5.md` §2 F-1, §3 OPS5-B2, §5 item 1, §6 Q3: "a
-- change that could make an alert quieter needs a second person, recorded … a change that makes alerts louder applies at
-- once, recorded." Brief `wave-reports/brief_hotfix14.md` §D/§E. The founder may reopen Q3.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0236 are applied; nothing here edits them. 0086's
-- `ops_alert_rules` table and its grants, add_std_columns' `created_by`/`updated_by` (0001:71-72, never written by any code
-- until HOTFIX-14's first commit), 0192's `kv_session_user()` and 0201's breach trigger (which reads the ACTIVE
-- `cold_chain_breach` rules' recipients) are REUSED UNCHANGED; 0233/0234/0236's guard-trigger shape — the admin realm by
-- `kv_admin` or `pg_roles.rolsuper` (the 0203 rule), the session person by `kv_session_user()` — and 0225's explicit
-- REVOKE-then-narrow grant shape for a new table are copied.)
--
-- CORRECTION OF 0086:35, stated here and never by editing 0086 (survey C-9): 0086's comment says
--   device_silent → {"silentHours":12}
-- Since 0165 the threshold is in MINUTES — {"silentMinutes":720} — with the legacy hours key still read and converted
-- (`silentMinutesOf`, modules/logistics/domain/ops-alert.rules.ts). 237.4's `ops_alert_silent_minutes` mirrors that function.
--
-- CLASS — TRUST — CODEOWNERS, the founder's Law 9 review. This file moves no rupee and touches no ledger, wallet or money
-- column; it decides WHO MAY QUIET the alarm that tells people a cooler or a reefer is warming — including who the database
-- itself tells about a cold-chain breach (0201's `cold_chain_breach_on_reading`) and who the watch job tells about a silent
-- logger. The founder's Law 9 review of every line stands before merge, in the REFUSING direction only.
--
-- ==================================================================================================================
--
-- WHY. Until this hotfix one `logistics.manage` holder could pause a rule, remove the people on it, raise its threshold or
-- lengthen its cooldown in one unkeyed PATCH, overwritten in place, with no author, no prior version and no audit row
-- (survey F-1, C-3). Pausing the organisation's breach rules makes the next breach `alert_state = 'no_recipient'` — nobody is
-- told — and nothing recorded who made it so.
--
-- WHAT EXISTS AFTER THIS FILE
--   237.1  ops_alert_rule_changes — one row per PROPOSED change that could make a rule quieter:
--            tenant_id, rule_id → ops_alert_rules(id), before jsonb, after jsonb (the rule's movable fields, 237.4's
--            projection, key for key), reason text, proposed_by → users, proposed_at, confirmed_by → users, confirmed_at,
--            withdrawn_at, state 'proposed' | 'confirmed' | 'withdrawn'; add_std_columns.
--          CHECKs:
--            ck_oarc_reason_len          char_length(btrim(reason)) >= 10 — every proposal says why.
--            ck_oarc_confirmer_ne_proposer confirmed_by IS NULL OR confirmed_by <> proposed_by — never the same person.
--            ck_oarc_state_shape         the three legal shapes: proposed (no confirmation, not withdrawn) · confirmed
--                                        (confirmer and instant, not withdrawn) · withdrawn (an instant, no confirmation).
--          uq_ops_alert_rule_changes_open — UNIQUE (rule_id) WHERE state = 'proposed': one open proposal per rule.
--   237.2  RLS by the house loop (0086's, verbatim): the new table gets `tenant_isolation_ops_alert_rule_changes`. THE RLS
--          GATE COUNT RISES BY EXACTLY ONE (asserted in QA).
--   237.3  GRANTS (0225's shape): REVOKE ALL from kv_app, kv_relay, kv_readonly and PUBLIC — 0014/0018's default privileges
--          would hand kv_relay DELETE on every future table — then kv_app SELECT, INSERT, UPDATE (NO DELETE: a proposal and how
--          it ended is a record), kv_readonly SELECT. kv_relay: nothing (no handler reads it).
--   237.4  Pure helpers, IMMUTABLE, mirroring `classifyRuleChange` (ops-alert.rules.ts) field for field:
--            ops_alert_rule_state(ops_alert_rules) → jsonb  the projection {ruleName, threshold, recipientUserIds,
--                                                           channelHint, cooldownMinutes, isActive}
--            ops_alert_silent_minutes(jsonb) → numeric      `silentMinutesOf`
--            ops_alert_rule_is_quieter(old, new) → boolean   pause · a recipient removed · a longer cooldown · cold_chain_breach
--                minBreaches higher, windowHours SHORTER (the rule counts readings in the last N hours — a narrower window
--                counts fewer), a subjectType filter added or changed · device_silent minutes longer · maintenance_due
--                'any' → one flag, or one flag → the other. Defaults are the evaluator's (6 h, 1 breach, 720 min, 'any').
--   237.5  ops_alert_rules_hf14_guard (BEFORE UPDATE OR DELETE on ops_alert_rules, outside the admin realm):
--          UPDATE  tenant_id, kind, created_by and created_at never move; `deleted_at` is never set (a rule is paused, never
--                  deleted — no confirmed change can express a deletion). A QUIETER update is refused unless a change row for
--                  THIS rule, `confirmed` in THIS transaction (`confirmed_at = now()`, which is the transaction's start
--                  instant) by the person in this session, says exactly what the rule was (`before` = OLD's projection) and
--                  exactly what it becomes (`after` = NEW's projection).
--          DELETE  refused. kv_app holds no DELETE on ops_alert_rules (0014, 0086:94) — it gets 42501 before this trigger —
--                  but kv_relay holds DELETE through 0018's default privileges, and kv_relay bypasses RLS; the guard closes it.
--          A louder or neutral update (resume, a person added, a threshold tightened, a rename, a channel hint, the
--          evaluator's `last_evaluated_at`) passes untouched.
--   237.6  ops_alert_rule_changes_hf14_guard (BEFORE INSERT OR UPDATE on ops_alert_rule_changes, outside the admin realm):
--          INSERT  born `proposed` (no confirmation, not withdrawn); `proposed_by` is the person in THIS session (a session with
--                  no person — a job — cannot propose); the rule is this organisation's, and `before` is the rule as it is now.
--          UPDATE  id, tenant, rule, before, after, reason, proposer and proposed_at never move. A confirmed or withdrawn row is
--                  FINAL. proposed → confirmed: the confirmer is the person in this session and is not the proposer.
--                  proposed → withdrawn: only the proposer, in their own session.
--          The ADMIN REALM (kv_admin, or a superuser as pg_roles knows one — the 0203 rule) is exempt from both guards,
--          exactly as 0236's is: an operator repairing data by hand, a migration, and the test harness's own fixtures. The
--          CHECKs bind the admin realm too.
--   237.7  COMMENTs on the table and its columns naming the decision.
--
-- NO FLAG (Law 10 reasoning, the HOTFIX precedents): a refusal on a trust path is not a feature; a kill-switch on it would be
-- a switch that re-opens the door. The whole module still sits behind `logistics` OFF (seed 0009_feature_flags:27).
-- NO NOTIFICATION (brief §D): the second person is not told that a proposal waits; the words are proposed in the wave report.
-- NOTHING ON THE PARTNER AXIS (kv_partner, current_partner_id(), the partner definers) is touched.
--
-- OWNER: plain DDL; both guards and the helpers are SECURITY INVOKER — they read only the row, the session and (237.5/237.6)
-- the other table under the writing role's own RLS.
--
-- SHARDS: both tables carry tenant_id and live on the tenant's shard; a change row and its rule are always on the same shard
-- (the FK, and the INSERT guard's tenant match), so every shard runs this file unchanged and no cross-shard read exists.
--
-- REVERSAL (hand-run, never by the runner; revert the API's HOTFIX-14 code in modules/logistics FIRST — the service writes the
-- change rows, and with the guard gone a quieter PATCH would still answer 202 but nothing would stop a direct UPDATE):
--   DROP TRIGGER IF EXISTS ops_alert_rules_hf14_guard ON ops_alert_rules;
--   DROP FUNCTION IF EXISTS ops_alert_rules_hf14_guard();
--   DROP TRIGGER IF EXISTS ops_alert_rule_changes_hf14_guard ON ops_alert_rule_changes;
--   DROP FUNCTION IF EXISTS ops_alert_rule_changes_hf14_guard();
--   DROP TABLE IF EXISTS ops_alert_rule_changes;            -- the proposals and their outcomes go with it (the audit_log rows stay)
--   DROP FUNCTION IF EXISTS ops_alert_rule_is_quieter(ops_alert_rules, ops_alert_rules);
--   DROP FUNCTION IF EXISTS ops_alert_rule_state(ops_alert_rules);
--   DROP FUNCTION IF EXISTS ops_alert_silent_minutes(jsonb);
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 237.1  THE PROPOSALS
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE ops_alert_rule_changes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  rule_id       uuid NOT NULL REFERENCES ops_alert_rules(id),
  before        jsonb NOT NULL,
  after         jsonb NOT NULL,
  reason        text NOT NULL,
  proposed_by   uuid NOT NULL REFERENCES users(id),
  proposed_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid REFERENCES users(id),
  confirmed_at  timestamptz,
  withdrawn_at  timestamptz,
  state         varchar(12) NOT NULL DEFAULT 'proposed',
  CONSTRAINT ck_oarc_state CHECK (state IN ('proposed', 'confirmed', 'withdrawn')),
  CONSTRAINT ck_oarc_reason_len CHECK (char_length(btrim(reason)) >= 10),
  CONSTRAINT ck_oarc_confirmer_ne_proposer CHECK (confirmed_by IS NULL OR confirmed_by <> proposed_by),
  CONSTRAINT ck_oarc_state_shape CHECK (
       (state = 'proposed'  AND confirmed_by IS NULL     AND confirmed_at IS NULL     AND withdrawn_at IS NULL)
    OR (state = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (state = 'withdrawn' AND confirmed_by IS NULL     AND confirmed_at IS NULL     AND withdrawn_at IS NOT NULL)
  )
);
CALL add_std_columns('ops_alert_rule_changes');
CREATE UNIQUE INDEX uq_ops_alert_rule_changes_open ON ops_alert_rule_changes (rule_id) WHERE state = 'proposed';
CREATE INDEX idx_ops_alert_rule_changes_rule ON ops_alert_rule_changes (tenant_id, rule_id, proposed_at DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- 237.2  RLS — idempotent tenant-isolation pass (0066 / 0086 pattern, verbatim)
-- ------------------------------------------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------------------------------------------
-- 237.3  GRANTS — the narrowest (0225's shape: revoke the default privileges first)
-- ------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ops_alert_rule_changes FROM PUBLIC;
REVOKE ALL ON ops_alert_rule_changes FROM kv_app;
REVOKE ALL ON ops_alert_rule_changes FROM kv_relay;
REVOKE ALL ON ops_alert_rule_changes FROM kv_readonly;
GRANT SELECT, INSERT, UPDATE ON ops_alert_rule_changes TO kv_app;
GRANT SELECT ON ops_alert_rule_changes TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 237.4  THE DIRECTION OF A CHANGE, IN THE DATABASE (mirrors classifyRuleChange)
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops_alert_rule_state(r ops_alert_rules) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ruleName', r.rule_name, 'threshold', r.threshold, 'recipientUserIds', r.recipient_user_ids,
                            'channelHint', r.channel_hint, 'cooldownMinutes', r.cooldown_minutes, 'isActive', r.is_active)
$$;

CREATE OR REPLACE FUNCTION ops_alert_silent_minutes(t jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(t -> 'silentMinutes') = 'number' AND (t ->> 'silentMinutes')::numeric > 0
         AND (t ->> 'silentMinutes')::numeric = trunc((t ->> 'silentMinutes')::numeric) THEN (t ->> 'silentMinutes')::numeric
    WHEN jsonb_typeof(t -> 'silentHours') = 'number' AND (t ->> 'silentHours')::numeric > 0
         AND (t ->> 'silentHours')::numeric = trunc((t ->> 'silentHours')::numeric) THEN (t ->> 'silentHours')::numeric * 60
    ELSE 720 END
$$;

CREATE OR REPLACE FUNCTION ops_alert_rule_is_quieter(o ops_alert_rules, n ops_alert_rules) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ot jsonb := coalesce(o.threshold, '{}'::jsonb);
  nt jsonb := coalesce(n.threshold, '{}'::jsonb);
  numof CONSTANT text := 'number';
BEGIN
  -- a pause
  IF o.is_active AND NOT n.is_active THEN RETURN true; END IF;
  -- a person removed
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(o.recipient_user_ids, '[]'::jsonb)) x
              WHERE NOT coalesce(n.recipient_user_ids, '[]'::jsonb) ? x) THEN RETURN true; END IF;
  -- a longer cooldown
  IF n.cooldown_minutes > o.cooldown_minutes THEN RETURN true; END IF;
  IF n.kind = 'cold_chain_breach' THEN
    IF (CASE WHEN jsonb_typeof(nt -> 'minBreaches') = numof THEN (nt ->> 'minBreaches')::numeric ELSE 1 END)
     > (CASE WHEN jsonb_typeof(ot -> 'minBreaches') = numof THEN (ot ->> 'minBreaches')::numeric ELSE 1 END) THEN RETURN true; END IF;
    IF (CASE WHEN jsonb_typeof(nt -> 'windowHours') = numof THEN (nt ->> 'windowHours')::numeric ELSE 6 END)
     < (CASE WHEN jsonb_typeof(ot -> 'windowHours') = numof THEN (ot ->> 'windowHours')::numeric ELSE 6 END) THEN RETURN true; END IF;
    IF (CASE WHEN jsonb_typeof(nt -> 'subjectType') = 'string' AND nt ->> 'subjectType' <> '' THEN nt ->> 'subjectType' END) IS NOT NULL
       AND (CASE WHEN jsonb_typeof(nt -> 'subjectType') = 'string' AND nt ->> 'subjectType' <> '' THEN nt ->> 'subjectType' END)
           IS DISTINCT FROM (CASE WHEN jsonb_typeof(ot -> 'subjectType') = 'string' AND ot ->> 'subjectType' <> '' THEN ot ->> 'subjectType' END)
    THEN RETURN true; END IF;
  ELSIF n.kind = 'device_silent' THEN
    IF ops_alert_silent_minutes(nt) > ops_alert_silent_minutes(ot) THEN RETURN true; END IF;
  ELSE
    IF coalesce(nullif(CASE WHEN jsonb_typeof(nt -> 'alert') = 'string' THEN nt ->> 'alert' END, ''), 'any') <> 'any'
       AND coalesce(nullif(CASE WHEN jsonb_typeof(nt -> 'alert') = 'string' THEN nt ->> 'alert' END, ''), 'any')
           <> coalesce(nullif(CASE WHEN jsonb_typeof(ot -> 'alert') = 'string' THEN ot ->> 'alert' END, ''), 'any')
    THEN RETURN true; END IF;
  END IF;
  RETURN false;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 237.5  THE GUARD ON THE RULES — a quieter rule only through a change a second person confirmed in this transaction
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops_alert_rules_hf14_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  me    uuid := kv_session_user();
  realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);
BEGIN
  IF realm THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alert rule %: a rule is paused (with a second person), never deleted (0237)', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'alert rule %: its organisation, kind and author never move (0237)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'alert rule %: a rule is paused (with a second person), never deleted (0237)', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF ops_alert_rule_is_quieter(OLD, NEW) THEN
    IF me IS NULL OR NOT EXISTS (
         SELECT 1 FROM ops_alert_rule_changes c
          WHERE c.rule_id = NEW.id AND c.tenant_id = NEW.tenant_id AND c.state = 'confirmed'
            AND c.confirmed_at = now() AND c.confirmed_by = me AND c.confirmed_by <> c.proposed_by
            AND c.before = ops_alert_rule_state(OLD) AND c.after = ops_alert_rule_state(NEW)) THEN
      RAISE EXCEPTION 'alert rule %: a change that could make an alert quieter takes effect only when a second person confirms it (0237)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ops_alert_rules_hf14_guard ON ops_alert_rules;
CREATE TRIGGER ops_alert_rules_hf14_guard BEFORE UPDATE OR DELETE ON ops_alert_rules
  FOR EACH ROW EXECUTE FUNCTION ops_alert_rules_hf14_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 237.6  THE GUARD ON THE PROPOSALS — proposed in one's own name, confirmed by another, withdrawn by the proposer, then final
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops_alert_rule_changes_hf14_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  me    uuid := kv_session_user();
  realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);
  rule  ops_alert_rules;
BEGIN
  IF realm THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.confirmed_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'an alert rule change is born proposed, waiting for a second person (0237)' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NULL OR NEW.proposed_by IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'an alert rule change is proposed by the person in this session, in their own name (0237)' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO rule FROM ops_alert_rules r WHERE r.id = NEW.rule_id;
    IF rule.id IS NULL OR rule.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'an alert rule change names a rule of this organisation (0237)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.before IS DISTINCT FROM ops_alert_rule_state(rule) THEN
      RAISE EXCEPTION 'alert rule %: a proposal''s "before" is the rule as it is now (0237)', NEW.rule_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.before IS DISTINCT FROM OLD.before OR NEW.after IS DISTINCT FROM OLD.after OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'alert rule change %: what was proposed, by whom and why never moves (0237)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'proposed' THEN
    IF NEW.state IS DISTINCT FROM OLD.state OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
      RAISE EXCEPTION 'alert rule change %: a confirmed or withdrawn change is final (0237)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state = 'confirmed' THEN
    IF me IS NULL OR NEW.confirmed_by IS DISTINCT FROM me OR me = OLD.proposed_by THEN
      RAISE EXCEPTION 'alert rule change %: a second person confirms it, in their own session — never the proposer (0237)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state = 'withdrawn' THEN
    IF me IS NULL OR me IS DISTINCT FROM OLD.proposed_by THEN
      RAISE EXCEPTION 'alert rule change %: only the proposer withdraws it, in their own session (0237)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ops_alert_rule_changes_hf14_guard ON ops_alert_rule_changes;
CREATE TRIGGER ops_alert_rule_changes_hf14_guard BEFORE INSERT OR UPDATE ON ops_alert_rule_changes
  FOR EACH ROW EXECUTE FUNCTION ops_alert_rule_changes_hf14_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 237.7  WHAT IT MEANS
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE ops_alert_rule_changes IS
  'PC-56 HOTFIX-14 (0237, OPS-5 Q3-A, lead-applied 2026-11-10): a change to an alert rule that could make an alert quieter — '
  'a pause, a person removed, a threshold loosened, a longer cooldown — proposed by one logistics.manage holder and applied only '
  'when ANOTHER confirms it (ops_alert_rules_hf14_guard refuses the quieter UPDATE otherwise). Until then the rule is unchanged. '
  'One open proposal per rule; the proposer may withdraw; a confirmed or withdrawn row is final.';
COMMENT ON COLUMN ops_alert_rule_changes.before IS
  'PC-56 HOTFIX-14 (0237): the rule as it was when proposed (ops_alert_rule_state). A confirmation is refused if the rule has moved since.';
COMMENT ON COLUMN ops_alert_rule_changes.after IS
  'PC-56 HOTFIX-14 (0237): the rule as it becomes on confirmation, exactly (ops_alert_rule_state of the updated row).';
COMMENT ON COLUMN ops_alert_rule_changes.confirmed_by IS
  'PC-56 HOTFIX-14 (0237): the second person, never the proposer (ck_oarc_confirmer_ne_proposer), in their own session (the guard).';
