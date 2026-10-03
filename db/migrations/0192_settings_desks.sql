-- ==================================================================================================================
-- MIGRATION 0192 — PC-56 TENANT-13b · SETTINGS & DESKS
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0002, 0014, 0018, 0121, 0139, 0143, 0144, 0157, 0158,
-- 0160, 0161, 0130, 0182, 0191 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (brief_t13b.md, 2026-10-03): TENANT MAKER-CHECKER WITH PLATFORM FLOORS, EFFECTIVE NEXT MIDNIGHT IST
-- WITH MEMBER NOTICE · TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE.
--
-- WHAT WAS WRONG (survey_t13.md):
--   F-4  one tenant_admin could raise `disputes.refund_checker_threshold_minor` to 2^53 and approve every refund alone, set
--        `governance.quorum_bp` to 0, or lift the payout checker — the only tenant write path checked scope and type, never
--        risk_class, and the audit recorded which key changed but not to what;
--   F-14 the console wrote `languages.enabled/default` SETTINGS while every consumer (cms pages, banners, notification
--        templates, courses) reads `tenant_languages`, which had no writer;
--   F-15 six tenant keys have no consumer; `group_lot.max_extension_hours` did not exist; `order.auto_confirm_hours` was
--        `ordinary` though the canon calls it trust-affecting;
--   F-16 no before/after, no reason, no history;
--   F-17 kv_app (and the BYPASSRLS kv_relay) held INSERT/UPDATE on eight global registries no apps/api code writes —
--        `setting_definitions` among them, so a `scope`/`risk_class` flip would have unlocked F-4 platform-wide;
--   F-18 desks did not exist.
--
-- WHAT THIS FILE DOES
--   192.1  setting_definitions — `member_notice`, `tenant_min` / `tenant_max` (the PLATFORM FLOOR a tenant may tighten
--          within, never loosen past), `floor_note` (why that floor), `deprecated_at` / `deprecated_note`. The 13 money /
--          security keys get their floors; `order.auto_confirm_hours` → `security` + member notice; `group_lot.
--          max_extension_hours` (int 48, ordinary, floor 1–48) is registered — its consumer is 11c's extend act.
--          `languages.enabled` / `languages.default` are deprecated (their store is `tenant_languages`).
--   192.2  helpers — `next_midnight_ist(ts)`, `kv_session_user()` (a uuid or NULL — never a cast error on 'system'),
--          `kv_is_tenant_admin(tenant, user)` (an active, unsuspended tenant_admin holder).
--   192.3  tenant_setting_proposals — the maker-checker carrier. Born `proposed` by a tenant_admin; CONFIRMED by a
--          DIFFERENT active tenant_admin (trigger — the wall), which fixes `effective_at` = the next 00:00 Asia/Kolkata;
--          APPLIED by the job at/after that instant; REFUSED with a reason; EXPIRED after 7 days unconfirmed. The value
--          is checked against the floor IN THE TRIGGER too (the service names the refusal; the database is the floor
--          under it). Append-only once confirmed; no DELETE.
--   192.4  tenant_setting_history — append-only before/after for EVERY tenant setting write (direct ordinary writes and
--          applied proposals), with actor(s), reason, proposal id.
--   192.5  tenant_settings — THE KEY-AWARE WALL. RLS cannot tell keys apart, so a trigger does: a write by kv_app (or
--          kv_relay) to a key whose risk_class is money_path / security, or which carries a member notice, is refused
--          unless the transaction cites (app.setting_proposal_id) a CONFIRMED, DUE proposal for the same tenant, key and
--          value. kv_relay loses INSERT / UPDATE / DELETE on tenant_settings (it never wrote it — grep in the 13b report).
--   192.6  tenant_languages — kv_app may DELETE (removing a language from the enabled set is a set change; the audit row
--          carries before/after); one primary per tenant (partial unique index); the deprecated settings are BACKFILLED
--          into it; kv_relay loses its writes (no relay writer).
--   192.7  desks — `desk_templates` (platform lookup, the canon's seven), `desks`, `desk_permissions` (soft-removed, never
--          deleted), `desk_members` (soft-removed), `desk_change_proposals` (create / edit / disable / enable /
--          install_templates; confirmer ≠ proposer by trigger). A desk's existence, status and permission rows change ONLY
--          inside the transaction that confirms a proposal (app.desk_proposal_id + confirmed_at = now()). Members are a
--          direct audited act. Permission `desk.manage` (tenant_admin; also seed 0004).
--   192.8  notification catalogue `tenant.setting_effective` (push + in-app; copy in seed 0007, names in seed 0024).
--   192.9  F-17 — REVOKE INSERT, UPDATE, DELETE on the eight global registries FROM kv_app and kv_relay (admin-api, as
--          kv_admin, is the only writer of each — grep in the report).
--   192.10 indexes.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 192.1  setting_definitions — member notice, platform floors, deprecation
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS member_notice   boolean NOT NULL DEFAULT false;
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS tenant_min      jsonb;
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS tenant_max      jsonb;
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS floor_note      text;
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS deprecated_at   timestamptz;
ALTER TABLE setting_definitions ADD COLUMN IF NOT EXISTS deprecated_note text;
ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS ck_sd_floor_tenant_only;
ALTER TABLE setting_definitions ADD CONSTRAINT ck_sd_floor_tenant_only
  CHECK ((tenant_min IS NULL AND tenant_max IS NULL) OR scope = 'tenant');
ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS ck_sd_floor_shape;
ALTER TABLE setting_definitions ADD CONSTRAINT ck_sd_floor_shape
  CHECK ((tenant_min IS NULL OR jsonb_typeof(tenant_min) IN ('number', 'string'))
     AND (tenant_max IS NULL OR jsonb_typeof(tenant_max) IN ('number', 'string')));
ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS ck_sd_floor_explained;
ALTER TABLE setting_definitions ADD CONSTRAINT ck_sd_floor_explained
  CHECK ((tenant_min IS NULL AND tenant_max IS NULL) OR (floor_note IS NOT NULL AND length(floor_note) >= 20));
COMMENT ON COLUMN setting_definitions.member_notice IS
  'PC-56 TENANT-13b (0192): a change to this key is TRUST-AFFECTING (canon W186 "auto-confirm, approval … apply from next midnight with a member notice"). It always goes through tenant_setting_proposals (checker) and, when applied, every active member of the tenant is told (tenant.setting_effective).';
COMMENT ON COLUMN setting_definitions.tenant_min IS
  'PC-56 TENANT-13b (0192): the PLATFORM FLOOR — the lowest value a tenant may propose (number keys), or, for a string key with tenant_min = tenant_max, the only value. NULL = no floor on that side. Checked by the service (refused by name) AND by trg_tsp_moves.';
COMMENT ON COLUMN setting_definitions.tenant_max IS
  'PC-56 TENANT-13b (0192): the highest value a tenant may propose (see tenant_min).';
COMMENT ON COLUMN setting_definitions.floor_note IS
  'PC-56 TENANT-13b (0192): why the floor sits where it does — which direction is safer for members, or why no sensible floor exists and the floor is the platform default (brief A2).';

-- The keys seed core/0008 defines. Seeds run AFTER migrations, so on an empty database these rows do not exist yet when
-- this file runs: they are UPSERTED here with the seed's own default/description (the seed's ON CONFLICT DO NOTHING then
-- keeps this file's classification), and on an existing database only the columns this wave owns are updated.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, member_notice, tenant_min, tenant_max, floor_note, lock_note) VALUES
  ('order.auto_confirm_hours', 'int', 'tenant', 'security', '2', 'Hours before unconfirmed order auto-cancels', true, '2', '2',
   'No consumer reads this key yet (no auto-confirm exists — survey F-15), so no direction can be judged safer: the floor is the platform default on both sides (brief A2) until the order module wires it.',
   'Trust-affecting (canon W186): faster auto-confirm releases escrow before a buyer has looked. Two administrators, from next midnight, with a member notice.'),
  ('order.quality_window_hours', 'int', 'tenant', 'ordinary', '24', 'Dispute window after delivery (perishable: override 6)', true, NULL, NULL, NULL, NULL),
  ('listing.approval_required', 'bool', 'tenant', 'ordinary', 'false', 'New listings need admin approval', true, NULL, NULL, NULL, NULL),
  ('review.enabled', 'bool', 'tenant', 'ordinary', 'true', 'Reviews enabled', false, NULL, NULL, NULL, NULL),
  ('delivery.free_above_minor', 'int', 'tenant', 'ordinary', '39900', 'Free delivery threshold (₹399)', false, NULL, NULL, NULL, NULL),
  ('payout.min_threshold_minor', 'int', 'tenant', 'ordinary', '50000', 'Minimum payout (₹500)', false, NULL, NULL, NULL, NULL),
  ('languages.enabled', 'json', 'tenant', 'ordinary', '["en"]', 'Enabled storefront languages (codes; subset of platform-active, capped by plan max_languages)', false, NULL, NULL, NULL, NULL),
  ('languages.default', 'string', 'tenant', 'ordinary', '"en"', 'Default storefront language code', false, NULL, NULL, NULL, NULL)
ON CONFLICT (key) DO UPDATE SET
  risk_class    = EXCLUDED.risk_class,
  member_notice = EXCLUDED.member_notice,
  tenant_min    = EXCLUDED.tenant_min,
  tenant_max    = EXCLUDED.tenant_max,
  floor_note    = EXCLUDED.floor_note,
  lock_note     = COALESCE(EXCLUDED.lock_note, setting_definitions.lock_note);

UPDATE setting_definitions
   SET deprecated_at = COALESCE(deprecated_at, now()),
       deprecated_note = 'PC-56 TENANT-13b (0192, F-14): every consumer (cms pages, banners, notification templates, courses) reads tenant_languages; this key was written by the console and read by nothing. Its values were backfilled into tenant_languages; the console now writes tenant_languages (PUT /tenant-settings/languages). Not editable.'
 WHERE key IN ('languages.enabled', 'languages.default');

-- group_lot.max_extension_hours — consumer: GroupLotService.extend (11c, W136 "One deadline extension per lot, max 48h").
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, member_notice, tenant_min, tenant_max, floor_note) VALUES
  ('group_lot.max_extension_hours', 'int', 'tenant', 'ordinary', '48',
   'The most a coordinator may extend a group lot''s pledge deadline, once, in hours past the current deadline (W136 "One deadline extension per lot, max 48h"). Read by the extend act.',
   false, '1', '48',
   'Every extra hour keeps every pledger''s produce committed and unsold. A tenant may shorten the one extension (down to 1 h); it may not lengthen it past the platform''s 48 h.')
ON CONFLICT (key) DO UPDATE SET tenant_min = EXCLUDED.tenant_min, tenant_max = EXCLUDED.tenant_max, floor_note = EXCLUDED.floor_note, description = EXCLUDED.description;

-- THE 13 MONEY / SECURITY KEYS — the platform floor. "Platform value" = setting_definitions.default_value (no row in
-- platform_setting_values exists for any tenant-scope key; a platform value there would be a platform-scope override and
-- these are tenant-scope). A tenant may TIGHTEN within [tenant_min, tenant_max], never loosen past the platform.
UPDATE setting_definitions SET tenant_min = '0', tenant_max = default_value,
  floor_note = 'Lower = more refunds need a second person. A tenant may lower the threshold (down to 0: every refund needs two people); it may not raise it above the platform''s ₹10,000.'
 WHERE key = 'disputes.refund_checker_threshold_minor';
UPDATE setting_definitions SET tenant_min = '0', tenant_max = default_value,
  floor_note = 'Lower = more payout batches need a second person. A tenant may lower it (down to 0); it may not raise it above the platform''s ₹1,00,000.'
 WHERE key = 'payouts.batch_checker_threshold_minor';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = '1440',
  floor_note = 'Higher = a prepared batch locks earlier before it pays. A tenant may lock earlier than the platform''s 30 minutes; the 1,440-minute ceiling is not a safety floor but a liveness one — a batch that locks more than a day ahead cannot be prepared for the next run, and members would not be paid.'
 WHERE key = 'payouts.batch_cut_off_minutes';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = default_value,
  floor_note = 'The consumer accepts fortnightly or monthly (payments/domain/settlement-cycle.ts). Monthly makes every seller wait twice as long for money, and fortnightly is the platform value, so no value both differs from the platform and is not looser: the key is effectively platform-locked at fortnightly.'
 WHERE key = 'settlements.cycle_length';
UPDATE setting_definitions SET tenant_min = '0', tenant_max = default_value,
  floor_note = 'Lower = members are paid sooner after a milk cycle closes. A tenant may pay sooner (down to the day the cycle ends); it may not pay later than the platform''s 2 days.'
 WHERE key = 'dairy.cycle_payday_offset_days';
UPDATE setting_definitions SET tenant_min = '0', tenant_max = default_value,
  floor_note = 'Lower = less of a member''s milk bill may be deducted in one cycle. A tenant may lower the cap; it may not raise it above the platform''s 25%.'
 WHERE key = 'dairy.deduction_assembly_max_pct';
UPDATE setting_definitions SET tenant_min = '0', tenant_max = default_value,
  floor_note = 'Lower = a member''s consent is needed for smaller deductions. A tenant may lower it; it may not raise it above the platform''s 25%.'
 WHERE key = 'dairy.deduction_consent_pct';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = '168',
  floor_note = 'Higher = a member has longer to object to a milk bill. A tenant may lengthen it past the platform''s 24 h; the 168 h (one week) ceiling is a liveness one — a window longer than a week delays every member''s pay.'
 WHERE key = 'dairy.dispute_window_hours';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = '10000',
  floor_note = 'Higher = more eligible members must vote before a resolution carries. A tenant may raise its quorum above the platform''s 33%; it may not lower it.'
 WHERE key = 'governance.quorum_bp';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = default_value,
  floor_note = 'No direction is safer: lowering it lets newly enrolled members swing a vote, raising it disenfranchises members who joined in good faith. No sensible floor exists, so the floor is the platform default on both sides (brief A2) — effectively platform-locked at 6 months.'
 WHERE key = 'governance.min_membership_months';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = default_value,
  floor_note = 'No direction is safer: lowering it lets a one-share member outvote the by-law, raising it disenfranchises small holders. No sensible floor exists, so the floor is the platform default on both sides (brief A2) — effectively platform-locked at 10 shares.'
 WHERE key = 'governance.min_shares_to_vote';
UPDATE setting_definitions SET tenant_min = default_value, tenant_max = default_value,
  floor_note = 'The special majority is a FRACTION (num/den, resolution-rules.ts) and a proposal carries one key; no single-key move keeps num/den at or above the platform''s 2/3 (3/3 and 2/4 are both refused by the consumer). Locked at the platform default until a two-key proposal exists (refused by name in the 13b report).'
 WHERE key IN ('governance.special_majority_num', 'governance.special_majority_den');

-- member notice (brief A1: auto-confirm, approval, dispute window, cycle length, quorum, majority).
UPDATE setting_definitions SET member_notice = true
 WHERE key IN ('order.auto_confirm_hours', 'listing.approval_required', 'order.quality_window_hours', 'dairy.dispute_window_hours',
               'settlements.cycle_length', 'governance.quorum_bp', 'governance.special_majority_num', 'governance.special_majority_den');

-- Existing tenant values outside the new floors are KEPT (fix-forward: nothing deleted) and counted here; the console marks
-- them "outside the platform floor" and any new proposal must come back inside it.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM tenant_settings ts JOIN setting_definitions d ON d.key = ts.key
   WHERE (jsonb_typeof(ts.value) = 'number' AND ((jsonb_typeof(d.tenant_min) = 'number' AND (ts.value #>> '{}')::numeric < (d.tenant_min #>> '{}')::numeric)
                                              OR (jsonb_typeof(d.tenant_max) = 'number' AND (ts.value #>> '{}')::numeric > (d.tenant_max #>> '{}')::numeric)))
      OR (jsonb_typeof(d.tenant_min) = 'string' AND d.tenant_min = d.tenant_max AND ts.value <> d.tenant_min);
  RAISE NOTICE '0192: % existing tenant setting value(s) sit outside the new platform floors (kept; shown as such)', n;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.2  helpers
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_midnight_ist(ts timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (((ts AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata'
$$;
COMMENT ON FUNCTION next_midnight_ist(timestamptz) IS
  'PC-56 TENANT-13b (0192): the first 00:00 Asia/Kolkata strictly after ts — when a confirmed trust-affecting setting takes effect (canon W186 "apply from next midnight … never mid-order").';

CREATE OR REPLACE FUNCTION kv_session_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN current_setting('app.user_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.user_id', true)::uuid END
$$;
COMMENT ON FUNCTION kv_session_user() IS
  'PC-56 TENANT-13b (0192): app.user_id as a uuid, or NULL (unset, empty, or a job''s ''system'') — never a cast error.';

CREATE OR REPLACE FUNCTION kv_is_tenant_admin(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
     WHERE utr.tenant_id = p_tenant AND utr.user_id = p_user AND r.code = 'tenant_admin'
       AND utr.is_active AND utr.deleted_at IS NULL)
   AND NOT EXISTS (
    SELECT 1 FROM tenant_member_suspensions s
     WHERE s.tenant_id = p_tenant AND s.user_id = p_user AND s.lifted_at IS NULL AND s.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION kv_is_tenant_admin(uuid, uuid) IS
  'PC-56 TENANT-13b (0192): an ACTIVE, UNSUSPENDED tenant_admin of the tenant — the only person who may propose or confirm a trust-affecting setting or a desk change. Invoker rights: under kv_app it reads through RLS, so it sees only the current tenant.';

-- ------------------------------------------------------------------------------------------------------------------
-- 192.3  tenant_setting_proposals — the maker-checker carrier
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_setting_proposals (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  key            varchar(80) NOT NULL REFERENCES setting_definitions(key),
  old_value      jsonb NOT NULL,
  new_value      jsonb NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by    uuid NOT NULL REFERENCES users(id),
  proposed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  status         varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired', 'applied')),
  confirmed_by   uuid REFERENCES users(id),
  confirmed_at   timestamptz,
  effective_at   timestamptz,
  refused_by     uuid REFERENCES users(id),
  refused_at     timestamptz,
  refuse_reason  text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  expired_at     timestamptz,
  expire_note    text,
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tsp_value_changes  CHECK (new_value <> old_value),
  CONSTRAINT ck_tsp_confirm_whole  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL) AND (confirmed_at IS NULL) = (effective_at IS NULL)),
  CONSTRAINT ck_tsp_confirmed      CHECK (status NOT IN ('confirmed', 'applied') OR confirmed_by IS NOT NULL),
  CONSTRAINT ck_tsp_refused_whole  CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_tsp_expired_whole  CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  CONSTRAINT ck_tsp_applied_whole  CHECK ((status = 'applied') = (applied_at IS NOT NULL))
  -- maker ≠ checker is ONE wall, the trigger below (trg_tsp_moves) — not a second CHECK that would hide the trigger's removal.
);
-- one live proposal per key per tenant (a refused/expired/applied one is history)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsp_live ON tenant_setting_proposals (tenant_id, key) WHERE status IN ('proposed', 'confirmed');
COMMENT ON TABLE tenant_setting_proposals IS
  'PC-56 TENANT-13b (0192, founder decision: tenant maker-checker with platform floors, effective next midnight IST with member notice). A trust-affecting tenant setting (risk_class money_path | security, or member_notice) is never written by one person: a tenant_admin PROPOSES old -> new with a reason (>= 20); a DIFFERENT active tenant_admin CONFIRMS (trg_tsp_moves), fixing effective_at = next_midnight_ist(confirmed_at); the registered job APPLIES it at/after that instant (tenant_settings + tenant_setting_history + tenancy.setting_effective); or a tenant_admin REFUSES it with a reason; unconfirmed after 7 days it EXPIRES.';

CREATE OR REPLACE FUNCTION tsp_floor_problem(p_key varchar, p_value jsonb) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE d record;
BEGIN
  SELECT value_type, tenant_min, tenant_max INTO d FROM setting_definitions WHERE key = p_key;
  IF NOT FOUND THEN RETURN 'unknown key'; END IF;
  IF jsonb_typeof(d.tenant_min) = 'string' OR jsonb_typeof(d.tenant_max) = 'string' THEN
    IF d.tenant_min IS NOT NULL AND d.tenant_min = d.tenant_max AND p_value <> d.tenant_min THEN
      RETURN format('only %s is allowed', d.tenant_min #>> '{}');
    END IF;
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN
    IF d.tenant_min IS NOT NULL OR d.tenant_max IS NOT NULL THEN RETURN 'a number is required'; END IF;
    RETURN NULL;
  END IF;
  IF d.tenant_min IS NOT NULL AND (p_value #>> '{}')::numeric < (d.tenant_min #>> '{}')::numeric THEN
    RETURN format('below the platform floor %s', d.tenant_min #>> '{}');
  END IF;
  IF d.tenant_max IS NOT NULL AND (p_value #>> '{}')::numeric > (d.tenant_max #>> '{}')::numeric THEN
    RETURN format('above the platform ceiling %s', d.tenant_max #>> '{}');
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION assert_tenant_setting_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); d record; problem text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tenant_setting_proposals is append-only: a proposal is never deleted — PC-56 TENANT-13b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.applied_at IS NOT NULL
       OR NEW.expired_at IS NOT NULL OR NEW.effective_at IS NOT NULL THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_BORN_PROPOSED] a setting proposal is born proposed — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    SELECT scope, risk_class, member_notice, deprecated_at INTO d FROM setting_definitions WHERE key = NEW.key;
    IF d.scope <> 'tenant' OR d.deprecated_at IS NOT NULL OR NOT (d.risk_class IN ('money_path', 'security') OR d.member_notice) THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_NOT_GATED] % is not a trust-affecting tenant key — PC-56 TENANT-13b', NEW.key USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[SETTING_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    problem := tsp_floor_problem(NEW.key, NEW.new_value);
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION '[SETTING_OUTSIDE_FLOOR] %: % — PC-56 TENANT-13b', NEW.key, problem USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: what was proposed is final.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.key <> OLD.key OR NEW.old_value <> OLD.old_value OR NEW.new_value <> OLD.new_value
     OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[SETTING_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-13b', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('refused', 'expired', 'applied') THEN
    RAISE EXCEPTION '[SETTING_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-13b', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'confirmed' THEN
    -- append-only once confirmed: the confirmation is final; only applied / expired (re-check failed at apply) may follow.
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
       OR NEW.refused_by IS NOT NULL THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_FINAL] the confirmation of % is final — PC-56 TENANT-13b', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'applied' AND (NEW.applied_at IS NULL OR NEW.applied_at < OLD.effective_at) THEN
      RAISE EXCEPTION '[SETTING_NOT_DUE] proposal % takes effect at % — PC-56 TENANT-13b', OLD.id, OLD.effective_at USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('confirmed', 'applied', 'expired') THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_MOVE] confirmed -> % is not a move — PC-56 TENANT-13b', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- OLD.status = 'proposed'
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[SETTING_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second administrator — PC-56 TENANT-13b maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[SETTING_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-13b', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.effective_at <> next_midnight_ist(NEW.confirmed_at) THEN
      RAISE EXCEPTION '[SETTING_EFFECTIVE_AT] a confirmed setting takes effect at the next 00:00 Asia/Kolkata — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    problem := tsp_floor_problem(OLD.key, OLD.new_value);
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION '[SETTING_OUTSIDE_FLOOR] %: % — PC-56 TENANT-13b', OLD.key, problem USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_MOVE] a refused proposal carries no confirmation — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[SETTING_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF NEW.expired_at < OLD.expires_at THEN
      RAISE EXCEPTION '[SETTING_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-13b', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[SETTING_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13b', NEW.status USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_tsp_moves ON tenant_setting_proposals;
CREATE TRIGGER trg_tsp_moves BEFORE INSERT OR UPDATE OR DELETE ON tenant_setting_proposals FOR EACH ROW EXECUTE FUNCTION assert_tenant_setting_proposal_moves();
DROP TRIGGER IF EXISTS trg_tsp_no_truncate ON tenant_setting_proposals;
CREATE TRIGGER trg_tsp_no_truncate BEFORE TRUNCATE ON tenant_setting_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_setting_proposal_moves();

ALTER TABLE tenant_setting_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tsp_read ON tenant_setting_proposals;
DROP POLICY IF EXISTS tsp_insert_own ON tenant_setting_proposals;
DROP POLICY IF EXISTS tsp_update_own ON tenant_setting_proposals;
DROP POLICY IF EXISTS tsp_admin_realm ON tenant_setting_proposals;
CREATE POLICY tsp_read        ON tenant_setting_proposals FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tsp_insert_own  ON tenant_setting_proposals FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tsp_update_own  ON tenant_setting_proposals FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tsp_admin_realm ON tenant_setting_proposals FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON tenant_setting_proposals FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON tenant_setting_proposals TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, effective_at, refused_by, refused_at, refuse_reason, expired_at, expire_note, applied_at) ON tenant_setting_proposals TO kv_app;
GRANT SELECT ON tenant_setting_proposals TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.4  tenant_setting_history — append-only before/after
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_setting_history (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  key            varchar(80) NOT NULL REFERENCES setting_definitions(key),
  old_value      jsonb NOT NULL,
  new_value      jsonb NOT NULL,
  source         varchar(10) NOT NULL CHECK (source IN ('direct', 'proposal')),
  actor_user_id  uuid REFERENCES users(id),
  proposal_id    uuid REFERENCES tenant_setting_proposals(id),
  proposed_by    uuid REFERENCES users(id),
  confirmed_by   uuid REFERENCES users(id),
  reason         text,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tsh_source_whole CHECK (
    (source = 'direct'   AND actor_user_id IS NOT NULL AND proposal_id IS NULL)
 OR (source = 'proposal' AND proposal_id IS NOT NULL AND proposed_by IS NOT NULL AND confirmed_by IS NOT NULL AND proposed_by <> confirmed_by))
);
COMMENT ON TABLE tenant_setting_history IS
  'PC-56 TENANT-13b (0192, F-16): every tenant setting write, before -> after. source=direct (an ordinary key, one tenant_admin, optional reason) or source=proposal (a confirmed proposal applied by the job: maker and checker named). Append-only.';
CREATE OR REPLACE FUNCTION tenant_setting_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tenant_setting_history is append-only — a recorded change is never edited or removed (PC-56 TENANT-13b, 0192)' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_tsh_append_only ON tenant_setting_history;
CREATE TRIGGER trg_tsh_append_only BEFORE UPDATE OR DELETE ON tenant_setting_history FOR EACH ROW EXECUTE FUNCTION tenant_setting_history_append_only();
DROP TRIGGER IF EXISTS trg_tsh_no_truncate ON tenant_setting_history;
CREATE TRIGGER trg_tsh_no_truncate BEFORE TRUNCATE ON tenant_setting_history FOR EACH STATEMENT EXECUTE FUNCTION tenant_setting_history_append_only();
ALTER TABLE tenant_setting_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tsh_read ON tenant_setting_history;
DROP POLICY IF EXISTS tsh_insert_own ON tenant_setting_history;
DROP POLICY IF EXISTS tsh_admin_realm ON tenant_setting_history;
CREATE POLICY tsh_read        ON tenant_setting_history FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tsh_insert_own  ON tenant_setting_history FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tsh_admin_realm ON tenant_setting_history FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON tenant_setting_history FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON tenant_setting_history TO kv_app;
GRANT SELECT ON tenant_setting_history TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.5  tenant_settings — the key-aware wall
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_tenant_setting_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d record; pid text; ok boolean;
BEGIN
  -- Only the tenant realm is walled here: kv_app (every tenant request) and kv_relay (BYPASSRLS, no business here — its
  -- grant is revoked below; this is the belt to that brace). The admin realm (kv_admin) and migrations/seeds (owner) are
  -- platform acts with their own two-person rule (admin-api settings-ops).
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[SETTING_DELETE] a tenant setting is never deleted from the tenant realm — PC-56 TENANT-13b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.key <> OLD.key) THEN
    RAISE EXCEPTION '[SETTING_REKEY] a tenant setting row keeps its tenant and key — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
  END IF;
  SELECT risk_class, member_notice, deprecated_at INTO d FROM setting_definitions WHERE key = NEW.key;
  IF d.deprecated_at IS NOT NULL THEN
    RAISE EXCEPTION '[SETTING_DEPRECATED] % is deprecated and not writable — PC-56 TENANT-13b', NEW.key USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (d.risk_class IN ('money_path', 'security') OR d.member_notice) THEN RETURN NEW; END IF;
  pid := current_setting('app.setting_proposal_id', true);
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '[PROPOSAL_REQUIRED] % is trust-affecting: it is written only by applying a confirmed proposal — PC-56 TENANT-13b maker-checker', NEW.key
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM tenant_setting_proposals p
     WHERE p.id = pid::uuid AND p.tenant_id = NEW.tenant_id AND p.key = NEW.key AND p.new_value = NEW.value
       AND p.status = 'confirmed' AND p.confirmed_by <> p.proposed_by AND p.effective_at <= now()) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION '[PROPOSAL_REQUIRED] % — the cited proposal is not a confirmed, due proposal for this tenant, key and value — PC-56 TENANT-13b maker-checker', NEW.key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenant_settings_gate ON tenant_settings;
CREATE TRIGGER trg_tenant_settings_gate BEFORE INSERT OR UPDATE OR DELETE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION assert_tenant_setting_write();
COMMENT ON TRIGGER trg_tenant_settings_gate ON tenant_settings IS
  'PC-56 TENANT-13b (0192, F-4, Law 9): RLS cannot tell keys apart. A kv_app / kv_relay write to a money_path / security / member_notice key must cite (app.setting_proposal_id) a CONFIRMED, DUE proposal by two different tenant_admins for the same tenant, key and value. Ordinary keys write directly (with before/after in tenant_setting_history + audit). Deprecated keys are not writable.';
REVOKE INSERT, UPDATE, DELETE ON tenant_settings FROM kv_relay;   -- no relay/worker writer (grep in the 13b report)

-- ------------------------------------------------------------------------------------------------------------------
-- 192.6  tenant_languages — the one language store
-- ------------------------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_tl_one_primary ON tenant_languages (tenant_id) WHERE is_default;
GRANT DELETE ON tenant_languages TO kv_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_languages FROM kv_relay;
COMMENT ON TABLE tenant_languages IS
  'The tenant''s enabled languages (one is_default = primary). PC-56 TENANT-13b (0192, F-14): written by PUT /tenant-settings/languages (tenant.settings, audited before/after; removing a language a published page, an active template override, a reviewed subtitle or an active banner uses is refused by name); read by cms pages, banners, notification templates and courses. kv_app may DELETE a row (a set change, recorded in the audit); RLS binds it to the tenant.';

-- backfill the deprecated settings into the store every consumer reads (only tenants with no tenant_languages row yet)
INSERT INTO tenant_languages (tenant_id, language_code, is_default)
SELECT s.tenant_id, l.code,
       l.code = COALESCE(
         (SELECT d.value #>> '{}' FROM tenant_settings d WHERE d.tenant_id = s.tenant_id AND d.key = 'languages.default'
            AND (d.value #>> '{}') IN (SELECT jsonb_array_elements_text(s.value))),
         (SELECT jsonb_array_elements_text(s.value) LIMIT 1))
  FROM tenant_settings s
  CROSS JOIN LATERAL (SELECT DISTINCT x AS code FROM jsonb_array_elements_text(s.value) x) e
  JOIN languages l ON l.code = e.code AND l.deleted_at IS NULL
 WHERE s.key = 'languages.enabled' AND jsonb_typeof(s.value) = 'array'
   AND NOT EXISTS (SELECT 1 FROM tenant_languages t WHERE t.tenant_id = s.tenant_id)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.7  desks
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('desk.manage', 'Desks: propose and confirm desk changes (a second tenant_admin confirms) and add / remove desk members — tenant_admin', NULL)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'desk.manage' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS desk_templates (
  code         varchar(20) PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,19}$'),
  sort_order   smallint NOT NULL,
  canon_codes  text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE desk_templates IS
  'PC-56 TENANT-13b (0192, B3): the canon''s seven desk templates (W185) with the permission LABELS the canon draws. Which real permission each label maps to — or why it is refused — lives in apps/api modules/identity/domain/desk-templates.ts (a test pins both to permissions). Platform lookup: read-only to tenants.';
INSERT INTO desk_templates (code, sort_order, canon_codes) VALUES
  ('verification', 1, ARRAY['kyc.verify', 'member.view', 'docs.read']),
  ('support',      2, ARRAY['ticket.respond', 'member.view', 'order.read']),
  ('moderation',   3, ARRAY['listing.approve', 'listing.reject', 'report.review']),
  ('dairy',        4, ARRAY['dairy.collections', 'dairy.quality', 'bmc.monitor']),
  ('finance',      5, ARRAY['payout.prepare', 'ledger.read', 'statement.read']),
  ('content',      6, ARRAY['content.publish', 'templates.edit']),
  ('labour',       7, ARRAY['labour.desk'])
ON CONFLICT (code) DO NOTHING;
REVOKE ALL ON desk_templates FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON desk_templates TO kv_app, kv_readonly;

CREATE TABLE IF NOT EXISTS desk_change_proposals (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  kind           varchar(20) NOT NULL CHECK (kind IN ('create', 'edit', 'disable', 'enable', 'install_templates')),
  desk_id        uuid,
  diff           jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by    uuid NOT NULL REFERENCES users(id),
  proposed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  status         varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by   uuid REFERENCES users(id),
  confirmed_at   timestamptz,
  refused_by     uuid REFERENCES users(id),
  refused_at     timestamptz,
  refuse_reason  text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  expired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dcp_desk_named     CHECK ((kind IN ('create', 'install_templates')) = (desk_id IS NULL)),
  CONSTRAINT ck_dcp_confirm_whole  CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT ck_dcp_refused_whole  CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_dcp_expired_whole  CHECK ((status = 'expired') = (expired_at IS NOT NULL))
  -- maker ≠ checker: trg_dcp_moves.
);
COMMENT ON TABLE desk_change_proposals IS
  'PC-56 TENANT-13b (0192, F-18, founder decision: tenant desk bundles). Creating a desk, editing its PERMISSIONS, disabling / re-enabling it, or installing the templates is PROPOSED by a tenant_admin with the diff {add:[], remove:[], members:{add:[], remove:[]}} and a reason, and CONFIRMED (applied in the same transaction) by a DIFFERENT active tenant_admin (trg_dcp_moves). Unconfirmed after 7 days it expires. Append-only once decided.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_dcp_live_desk ON desk_change_proposals (desk_id) WHERE status = 'proposed' AND desk_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dcp_live_install ON desk_change_proposals (tenant_id) WHERE status = 'proposed' AND kind = 'install_templates';

CREATE OR REPLACE FUNCTION assert_desk_change_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'desk_change_proposals is append-only: a desk proposal is never deleted — PC-56 TENANT-13b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.expired_at IS NOT NULL THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_BORN_PROPOSED] a desk proposal is born proposed — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[DESK_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose a desk change — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_EXPIRY] a desk proposal expires 7 days after it is made — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.desk_id IS DISTINCT FROM OLD.desk_id OR NEW.diff <> OLD.diff
     OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[DESK_PROPOSAL_FINAL] what desk proposal % proposes is final — PC-56 TENANT-13b', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[DESK_PROPOSAL_CLOSED] desk proposal % is already % — PC-56 TENANT-13b', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[DESK_CHECKER_IS_MAKER] the person who proposed desk change % cannot also confirm it — a second administrator — PC-56 TENANT-13b maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[DESK_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm a desk change — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_EXPIRED] desk proposal % expired at % — PC-56 TENANT-13b', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[DESK_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[DESK_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse a desk change — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' AND NEW.expired_at >= OLD.expires_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION '[DESK_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13b', NEW.status USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_dcp_moves ON desk_change_proposals;
CREATE TRIGGER trg_dcp_moves BEFORE INSERT OR UPDATE OR DELETE ON desk_change_proposals FOR EACH ROW EXECUTE FUNCTION assert_desk_change_proposal_moves();
DROP TRIGGER IF EXISTS trg_dcp_no_truncate ON desk_change_proposals;
CREATE TRIGGER trg_dcp_no_truncate BEFORE TRUNCATE ON desk_change_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_desk_change_proposal_moves();

CREATE TABLE IF NOT EXISTS desks (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  code                  varchar(40) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                  varchar(80) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description           varchar(300),
  template_code         varchar(20) REFERENCES desk_templates(code),
  status                varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by            uuid NOT NULL REFERENCES users(id),
  confirmed_by          uuid NOT NULL REFERENCES users(id),
  created_by_proposal   uuid NOT NULL REFERENCES desk_change_proposals(id),
  disabled_at           timestamptz,
  disabled_by_proposal  uuid REFERENCES desk_change_proposals(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_desks_code UNIQUE (tenant_id, code),
  CONSTRAINT ck_desks_two_people CHECK (created_by <> confirmed_by),
  CONSTRAINT ck_desks_disabled_whole CHECK ((status = 'disabled') = (disabled_at IS NOT NULL AND disabled_by_proposal IS NOT NULL))
);
ALTER TABLE desk_change_proposals DROP CONSTRAINT IF EXISTS fk_dcp_desk;
ALTER TABLE desk_change_proposals ADD CONSTRAINT fk_dcp_desk FOREIGN KEY (desk_id) REFERENCES desks(id);
COMMENT ON TABLE desks IS
  'PC-56 TENANT-13b (0192, F-18, founder decision: tenant desk bundles, no new global roles). A named bundle of permissions shaped around real work. Born only inside the transaction that confirms a create / install proposal; disabled / enabled only by a confirmed proposal. A disabled desk grants nothing (RoleCacheService).';

CREATE TABLE IF NOT EXISTS desk_permissions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  desk_id               uuid NOT NULL REFERENCES desks(id),
  permission_code       varchar(80) NOT NULL REFERENCES permissions(code),
  added_by_proposal     uuid NOT NULL REFERENCES desk_change_proposals(id),
  removed_by_proposal   uuid REFERENCES desk_change_proposals(id),
  added_at              timestamptz NOT NULL DEFAULT now(),
  removed_at            timestamptz,
  CONSTRAINT ck_dp_removed_whole CHECK ((removed_at IS NULL) = (removed_by_proposal IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dp_live ON desk_permissions (desk_id, permission_code) WHERE removed_at IS NULL;
COMMENT ON TABLE desk_permissions IS
  'PC-56 TENANT-13b (0192): a desk''s permission codes. Added / removed ONLY inside the transaction that confirms a desk proposal (trg_desk_proposal_gate). Removal is a soft remove (removed_at + the proposal) — history is never deleted.';

CREATE TABLE IF NOT EXISTS desk_members (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  desk_id        uuid NOT NULL REFERENCES desks(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  added_by       uuid NOT NULL REFERENCES users(id),
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  removed_by     uuid REFERENCES users(id),
  remove_reason  text CHECK (remove_reason IS NULL OR length(btrim(remove_reason)) BETWEEN 3 AND 300),
  CONSTRAINT ck_dm_removed_whole CHECK ((removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dm_live ON desk_members (desk_id, user_id) WHERE removed_at IS NULL;
COMMENT ON TABLE desk_members IS
  'PC-56 TENANT-13b (0192): who sits at a desk. Adding / removing a member is a DIRECT audited act by a desk.manage holder (canon W185 "assign desks, not permission lists"); the member must hold an active role in the tenant. Removal is soft (removed_at, by, reason).';

-- Desk existence, status and permission rows move only in the transaction that confirms a desk proposal.
CREATE OR REPLACE FUNCTION assert_desk_proposal_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text; ok boolean; t uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted — PC-56 TENANT-13b', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN NEW; END IF;
  -- (nested IFs: plpgsql does not short-circuit a field reference on the other table's record type)
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'desks' THEN
    IF NEW.code <> OLD.code OR NEW.created_by <> OLD.created_by OR NEW.confirmed_by <> OLD.confirmed_by OR NEW.created_by_proposal <> OLD.created_by_proposal THEN
      RAISE EXCEPTION '[DESK_FINAL] a desk keeps its code and its two creators — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = OLD.status AND NEW.name = OLD.name AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.template_code IS NOT DISTINCT FROM OLD.template_code THEN
      RETURN NEW;   -- updated_at only
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id) THEN
    RAISE EXCEPTION '[DESK_REKEY] % keeps its tenant — PC-56 TENANT-13b', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  t := NEW.tenant_id;
  pid := current_setting('app.desk_proposal_id', true);
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '[DESK_PROPOSAL_REQUIRED] % changes only in the transaction that confirms a desk proposal — PC-56 TENANT-13b maker-checker', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (SELECT 1 FROM desk_change_proposals p
                  WHERE p.id = pid::uuid AND p.tenant_id = t AND p.status = 'confirmed'
                    AND p.confirmed_by <> p.proposed_by AND p.confirmed_at = now()) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION '[DESK_PROPOSAL_REQUIRED] the cited desk proposal was not confirmed in this transaction — PC-56 TENANT-13b maker-checker'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'desk_permissions' AND TG_OP = 'UPDATE' THEN
    IF NEW.desk_id <> OLD.desk_id OR NEW.permission_code <> OLD.permission_code OR NEW.added_by_proposal <> OLD.added_by_proposal
       OR NEW.added_at <> OLD.added_at OR OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION '[DESK_PERMISSION_FINAL] a desk permission row is only ever soft-removed, once — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_desk_proposal_gate ON desks;
CREATE TRIGGER trg_desk_proposal_gate BEFORE INSERT OR UPDATE OR DELETE ON desks FOR EACH ROW EXECUTE FUNCTION assert_desk_proposal_gate();
DROP TRIGGER IF EXISTS trg_desk_proposal_gate ON desk_permissions;
CREATE TRIGGER trg_desk_proposal_gate BEFORE INSERT OR UPDATE OR DELETE ON desk_permissions FOR EACH ROW EXECUTE FUNCTION assert_desk_proposal_gate();
DROP TRIGGER IF EXISTS desks_uat ON desks;
CREATE TRIGGER desks_uat BEFORE UPDATE ON desks FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION assert_desk_member_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'desk_members rows are never deleted (soft remove) — PC-56 TENANT-13b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION '[DESK_MEMBER_BORN_LIVE] a desk member is added live — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM desks d WHERE d.id = NEW.desk_id AND d.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION '[DESK_NOT_FOUND] desk % is not this tenant''s — PC-56 TENANT-13b', NEW.desk_id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_tenant_roles utr WHERE utr.tenant_id = NEW.tenant_id AND utr.user_id = NEW.user_id AND utr.is_active AND utr.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[DESK_MEMBER_NOT_IN_TENANT] a desk member must hold an active role in the tenant — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.desk_id <> OLD.desk_id OR NEW.user_id <> OLD.user_id OR NEW.added_by <> OLD.added_by
     OR NEW.added_at <> OLD.added_at OR OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION '[DESK_MEMBER_FINAL] a desk member row is only ever removed, once — PC-56 TENANT-13b' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_moves ON desk_members;
CREATE TRIGGER trg_dm_moves BEFORE INSERT OR UPDATE OR DELETE ON desk_members FOR EACH ROW EXECUTE FUNCTION assert_desk_member_moves();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['desks', 'desk_permissions', 'desk_members', 'desk_change_proposals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
  END LOOP;
END $$;
GRANT UPDATE (status, disabled_at, disabled_by_proposal, updated_at) ON desks TO kv_app;
GRANT UPDATE (removed_at, removed_by_proposal) ON desk_permissions TO kv_app;
GRANT UPDATE (removed_at, removed_by, remove_reason) ON desk_members TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON desk_change_proposals TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.8  notification catalogue — members hear a trust-affecting change before it bites
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('tenant.setting_effective', 'A trust-affecting cooperative setting changed (confirmed by two administrators) — effective from midnight', 'important', '["push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.9  F-17 — the global registries: admin-api (kv_admin) is the only writer of each
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON setting_definitions     FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON platform_setting_values FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON integration_providers   FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON features                FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON feature_flags           FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON feature_flag_changes    FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON roles                   FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON languages               FROM kv_app, kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 192.10 indexes
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tsp_due      ON tenant_setting_proposals (effective_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_tsp_expiring ON tenant_setting_proposals (expires_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_tsp_tenant   ON tenant_setting_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tsh_key      ON tenant_setting_history (tenant_id, key, applied_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dcp_tenant   ON desk_change_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_desks_tenant ON desks (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dp_desk      ON desk_permissions (desk_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dm_user      ON desk_members (tenant_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dm_desk      ON desk_members (desk_id) WHERE removed_at IS NULL;
