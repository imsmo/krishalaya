-- ==================================================================================================================
-- MIGRATION 0240 — PC-56 GOV-2a · THE AUTHORITY DECIDES, ON DECLARED FIELDS — a farmer's unsent draft never reaches the
-- authority; each scheme version declares the form fields it asks for and the authority reads only those (personal ones
-- masked); the authority checks and decides applications to the schemes it runs through ONE definer on the kv_gov axis —
-- the decider is never the person who checked it, never the applicant, never the assister; and it reads its own schemes'
-- published versions (never an amount, never a draft's content, never an operator id).
-- (GOV-2 Q1-A, Q2-A, Q3-A, Q4-A and Q5-A, applied by the lead on 2026-11-10 under the founder's instructions of that day:
-- "start one by one task as per your requirement you are fully permitted to do anything as a product owner" / "choose
-- recommeneded option" — 06_GOV.md "GOV-2 SPLIT"; `survey_gov2.md` §1 "WHAT SCHEMES AND APPLICATIONS ARE ON THE PLATFORM
-- TODAY", §2 F-1…F-9, §3 GOV2-B1…B5, §5 item 1, §6 Q1–Q5; brief `wave-reports/brief_gov2a.md` §D/§E. The founder may reopen.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0239 are applied; nothing here edits them. REPLACED BY NAME:
-- 0239's policy `gov_own_schemes_scheme_applications` (dropped and recreated with `status <> 'draft'`) and its DEFINER
-- `gov_application_form(uuid)` (same signature, same return type — now the DECLARED fields only); 0105's trigger function
-- `trg_scheme_version_immutable()` (every column it froze is still frozen, plus `form_fields`). REUSED UNCHANGED: 0239's
-- `kv_gov`, `current_authority_id()`, `gov_runs_scheme()`, `gov_access()`, `gov_mask_form()`; 0225's `kv_session_user_uuid()`;
-- 0011's `application_status` and `scheme_application_events`; 0106's `ck_scheme_apps_rejection_code`.)
--
-- C-4 CORRECTED HERE (never by editing 0011): 0011:284 says `eligibility_check jsonb -- AI checker output + confidence`. No code
-- writes that column — there is no AI checker and no confidence on this platform; the column is always NULL (survey_gov2 F-5).
--
-- CLASS — TRUST/PII — CODEOWNERS, the founder's Law 9 / Law 11 review. Who may decide a farmer's application, and what of her
-- form a government official reads. NOT MONEY: approval carries no amount (Q1-A); no ledger, wallet or money column is written or
-- read; the processing fee and `benefit_summary.amount_minor` are never returned to the gov realm.
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   240.1  DRAFTS NEVER REACH THE AUTHORITY (B1 / Q3). `gov_own_schemes_scheme_applications` admits only `status <> 'draft'`;
--          `gov_application_form()` answers NULL for a draft. THE POLICY IS THE WALL (the API also filters — a second line).
--   240.2  DECLARED FORM FIELDS (B2f / Q3-A). `scheme_versions.form_fields jsonb NOT NULL DEFAULT '[]'` — an array of
--          {key, label, kind, personal}; `kv_scheme_form_fields_valid()` (CHECK `ck_scheme_version_form_fields`): unique keys,
--          kind ∈ text · number · date · boolean · choice, `personal` a boolean, at most 100; a key that IS a person's name
--          (`name`, `farmerName`, `fatherName` … — `cropName` is not), or names a village or caste (or a phone / Aadhaar / bank /
--          account / IFSC / UPI / PAN) MUST be personal (`kv_form_key_must_be_personal`); a location key
--          (lat / lng / gps / location / address / boundary …) cannot be declared at all. Authored ONLY in the admin realm's
--          existing draft → publish plane (maker ≠ checker, 0105); FROZEN once published (`trg_scheme_version_immutable()`
--          REPLACED to cover it). `gov_application_form(id)` → a JSON ARRAY of the version's declared fields, in declared
--          order: {key, label, kind, personal, value}; a personal value → six bullets + the last 3 characters (GOV-0's mask);
--          a non-personal value passes through `gov_mask_form()` (defence in depth); an UNDECLARED key is never returned. The
--          version is the one the application was filed under (`scheme_version_id`); none (pre-0105) or none declared → `[]`.
--   240.3  THE AUTHORITY DECIDES (B2 / Q2-A). Permissions `authority.applications.verify` (authority_officer, authority_head) and
--          `authority.applications.decide` (authority_head ONLY); seed core/0004 carries the same rows.
--          `scheme_applications` gains `verified_by` / `verified_realm` and `decided_by` / `decided_realm`; FOUR CHECKs hold the
--          second person for EVERY role in the database: a decision (decided_by) needs a verifier, and the decider is never
--          the verifier, never the applicant, never the assister. `scheme_application_events.actor_realm` ('tenant' | 'gov').
--          A gov rejection carries a listed code AND a sentence of 10–500 characters (CHECK).
--          `gov_application_act(id, act, reason_code, note)` (DEFINER, kv_gov only) — re-checks the session person's LIVE
--          permission (`gov_access`), `gov_runs_scheme`, no draft, the legal transition (0011's machine, the API's
--          `scheme-application.state.ts`), and the second-person rules; moves the row, writes the event row (actor + realm 'gov')
--            verify   submitted | appealed → under_verification, the actor recorded as the checker (an appeal re-opens: the
--                     previous decider and the 0106 code are cleared — the events keep them); under_verification with no checker
--                     → stays, the actor recorded as the checker ("complete checking");
--            clarify  under_verification → clarification_needed, with a note of 10–500 characters the farmer reads;
--            approve  under_verification → approved — NO AMOUNT (Q1-A);
--            reject   under_verification → rejected, a listed code + a sentence of 10–500 characters.
--          `gov_application_act_facts(id)` (DEFINER, kv_gov only) — the booleans the API's refusal order reads first; never an id.
--          kv_gov holds NO UPDATE on `scheme_applications` (asserted by probe: 42501). The API writes the `audit_log` row (the
--          application's organisation — a tenant row it can read) and the outbox event in the SAME transaction (Law 4).
--   240.4  THE AUTHORITY'S SCHEMES (B3 / Q5-A). DEFINERs, kv_gov only, the authority's own schemes only (another's → nothing):
--            gov_scheme_read(id | NULL)              published fields only — code, name, category, benefit type + instalment count
--                                                    (NEVER an amount, never the fee), window as stored, regions, required document
--                                                    types, the rules from the evaluator's five fields, the declared form fields,
--                                                    version, active, "a newer draft exists", "published by a second person",
--                                                    backfilled, "versions below N were not recorded";
--            gov_scheme_versions(scheme)             published and superseded versions (never a draft) — no operator id;
--            gov_scheme_version_diff(scheme, n)      field by field against the version below, over the same public fields.
--          B5 (the organisation's name on a gov row) is REFUSED (brief §D): no function returns `tenants.name` to kv_gov.
--
-- RLS — the gate count does NOT move (1,993 → 1,993): one policy dropped and the same name recreated; no new policy. The four new
-- `scheme_applications` columns and `actor_realm` carry no grant to kv_gov (column-level SELECT stays 0239's ten columns).
--
-- OWNER: every DEFINER assumes the migration owner bypasses RLS on `scheme_applications` / `scheme_application_events` (0239's
-- note, restated). If the production owner does not, the reads answer nothing and the act finds no row — fail closed.
--
-- SHARDS: roles / permissions / schemes / scheme_versions / lookup_values / admin_regions are reference rows present on every
-- shard (0105's and 0239's posture); `scheme_applications` and its events live on the application's TENANT shard — the API finds
-- the shard first (`gov_application_act_facts` on each) and acts there. Every shard runs this file unchanged.
--
-- REVERSAL (hand-run, never by the runner; revert the API's gov act / scheme routes and the tenant refusal, and admin-api's
-- `formFields`, FIRST):
--   DROP FUNCTION IF EXISTS gov_application_act(uuid, text, text, text), gov_application_act_facts(uuid), gov_scheme_read(uuid),
--     gov_scheme_versions(uuid), gov_scheme_version_diff(uuid, integer), gov_version_public(uuid);
--   -- re-run 0239's CREATE OR REPLACE FUNCTION gov_application_form (the key-name mask) and its DO-block policy (no draft clause);
--   -- re-run 0105's CREATE OR REPLACE FUNCTION trg_scheme_version_immutable;
--   ALTER TABLE scheme_versions DROP CONSTRAINT IF EXISTS ck_scheme_version_form_fields, DROP COLUMN IF EXISTS form_fields;
--   DROP FUNCTION IF EXISTS kv_scheme_form_fields_valid(jsonb), kv_form_key_must_be_personal(text), kv_form_key_tokens(text);
--   ALTER TABLE scheme_applications DROP CONSTRAINT IF EXISTS ck_sa_decision_needs_verifier, DROP CONSTRAINT IF EXISTS ck_sa_decider_not_verifier,
--     DROP CONSTRAINT IF EXISTS ck_sa_decider_not_applicant, DROP CONSTRAINT IF EXISTS ck_sa_decider_not_assister,
--     DROP CONSTRAINT IF EXISTS ck_sa_verified_whole, DROP CONSTRAINT IF EXISTS ck_sa_decided_whole, DROP CONSTRAINT IF EXISTS ck_sa_gov_reject_reasoned,
--     DROP COLUMN IF EXISTS verified_by, DROP COLUMN IF EXISTS verified_realm, DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS decided_realm;
--   ALTER TABLE scheme_application_events DROP CONSTRAINT IF EXISTS ck_sae_actor_realm, DROP COLUMN IF EXISTS actor_realm;
--   DELETE FROM role_permissions WHERE permission_code IN ('authority.applications.verify', 'authority.applications.decide');
--   DELETE FROM permissions WHERE code IN ('authority.applications.verify', 'authority.applications.decide');
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 240.1  DRAFTS NEVER REACH THE AUTHORITY — the policy is the wall
-- ------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS gov_own_schemes_scheme_applications ON scheme_applications;
CREATE POLICY gov_own_schemes_scheme_applications ON scheme_applications FOR SELECT TO kv_gov
  USING (current_authority_id() IS NOT NULL AND status <> 'draft' AND gov_runs_scheme(scheme_id));

-- ------------------------------------------------------------------------------------------------------------------
-- 240.2  DECLARED FORM FIELDS on the version (authored in the admin realm; frozen once published)
-- ------------------------------------------------------------------------------------------------------------------
-- A key as lower_snake tokens, '_'-fenced (0239's `gov_mask_form` tokeniser): `farmerName` → `_farmer_name_`.
CREATE OR REPLACE FUNCTION kv_form_key_tokens(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT '_' || lower(regexp_replace(regexp_replace(COALESCE(p_key, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g'), '[^A-Za-z0-9]+', '_', 'g')) || '_';
$$;

-- A key that MUST be declared personal: a person's name (the whole key — `cropName` is not a person), or anywhere in it a village, a caste,
-- or one of GOV-0's identifiers (phone / Aadhaar / bank / account / IFSC / UPI / PAN).
CREATE OR REPLACE FUNCTION kv_form_key_must_be_personal(p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT kv_form_key_tokens(p_key) ~ '^_(name|names|full_name|fullname|first_name|middle_name|last_name|surname|farmer_name|applicant_name|beneficiary_name|father_name|fathers_name|mother_name|husband_name|spouse_name|guardian_name)_$'
      OR kv_form_key_tokens(p_key) ~ '_(village|caste|phone|phones|mobile|msisdn|aadhaar|aadhar|uid|bank|account|acct|ifsc|upi|vpa|pan)_';
$$;

CREATE OR REPLACE FUNCTION kv_scheme_form_fields_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE e jsonb; k text; tok text; seen text[] := '{}';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 100 THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) AS x LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) AS ok WHERE ok NOT IN ('key', 'label', 'kind', 'personal')) THEN RETURN false; END IF;
    k := e ->> 'key';
    IF jsonb_typeof(e -> 'key') IS DISTINCT FROM 'string' OR k IS NULL OR k !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$' OR k = ANY (seen) THEN RETURN false; END IF;
    IF jsonb_typeof(e -> 'label') IS DISTINCT FROM 'string' OR char_length(btrim(e ->> 'label')) NOT BETWEEN 1 AND 120 THEN RETURN false; END IF;
    IF jsonb_typeof(e -> 'kind') IS DISTINCT FROM 'string' OR (e ->> 'kind') NOT IN ('text', 'number', 'date', 'boolean', 'choice') THEN RETURN false; END IF;
    IF jsonb_typeof(e -> 'personal') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    tok := kv_form_key_tokens(k);
    -- a location is never declared (GOV-0 drops every location; no officer-of-record exists for an authority)
    IF tok ~ '_(lat|lng|lon|latitude|longitude|geo|geotag|geotags|gps|location|locations|coords|coordinates|trace|walk|address|boundary|polygon|geojson)_' THEN RETURN false; END IF;
    -- a person's name, village or caste — and GOV-0's identifiers — are declared personal or not at all (Q3-A)
    IF kv_form_key_must_be_personal(k) AND (e ->> 'personal')::boolean IS NOT TRUE THEN RETURN false; END IF;
    seen := seen || k;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE scheme_versions ADD COLUMN IF NOT EXISTS form_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scheme_versions DROP CONSTRAINT IF EXISTS ck_scheme_version_form_fields;
ALTER TABLE scheme_versions ADD CONSTRAINT ck_scheme_version_form_fields CHECK (kv_scheme_form_fields_valid(form_fields));
COMMENT ON COLUMN scheme_versions.form_fields IS
  'PC-56 GOV-2a (GOV-2 Q3-A, lead-applied 2026-11-10): the form fields this version asks for — [{key, label, kind, personal}]. Written only '
  'in the admin realm''s draft → publish plane (maker ≠ checker); frozen once published. A government authority reads an application''s '
  'DECLARED fields only (gov_application_form), personal ones masked; an undeclared key is never returned.';

-- PUBLISHED MEANS IMMUTABLE — 0105's function REPLACED BY NAME: every column it froze is still frozen, and `form_fields` with them.
CREATE OR REPLACE FUNCTION trg_scheme_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;                                        -- a draft is work in progress
  END IF;
  IF OLD.benefit_summary::text       IS DISTINCT FROM NEW.benefit_summary::text
     OR OLD.eligibility_rules::text     IS DISTINCT FROM NEW.eligibility_rules::text
     OR OLD.required_doc_type_ids::text IS DISTINCT FROM NEW.required_doc_type_ids::text
     OR OLD.application_window::text    IS DISTINCT FROM NEW.application_window::text
     OR OLD.applicable_region_ids::text IS DISTINCT FROM NEW.applicable_region_ids::text
     OR OLD.processing_fee_minor        IS DISTINCT FROM NEW.processing_fee_minor
     OR OLD.form_fields::text           IS DISTINCT FROM NEW.form_fields::text
     OR OLD.version                     IS DISTINCT FROM NEW.version
     OR OLD.scheme_id                   IS DISTINCT FROM NEW.scheme_id
     OR OLD.change_reason               IS DISTINCT FROM NEW.change_reason
     OR OLD.drafted_by                  IS DISTINCT FROM NEW.drafted_by
     OR OLD.published_by                IS DISTINCT FROM NEW.published_by
     OR OLD.published_at                IS DISTINCT FROM NEW.published_at THEN
    RAISE EXCEPTION 'scheme_versions row % is % and its rules are immutable (publish a new version instead)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> NEW.status AND NOT (OLD.status = 'published' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'scheme_versions status % -> % is not a permitted transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- THE FORM OF AN ADMITTED APPLICATION — 0239's function REPLACED BY NAME (same signature, same jsonb return): the DECLARED fields of
-- the version it was filed under, in declared order; personal → masked; the rest through gov_mask_form; undeclared keys never.
-- NULL for a draft and for anything the session's authority does not run.
CREATE OR REPLACE FUNCTION gov_application_form(p_application_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_form jsonb; v_fields jsonb; f jsonb; k text; val jsonb; personal boolean; d text; shown jsonb; out jsonb := '[]'::jsonb;
BEGIN
  SELECT a.form_data, COALESCE(v.form_fields, '[]'::jsonb) INTO v_form, v_fields
    FROM scheme_applications a LEFT JOIN scheme_versions v ON v.id = a.scheme_version_id
   WHERE a.id = p_application_id AND a.deleted_at IS NULL AND a.status <> 'draft' AND gov_runs_scheme(a.scheme_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(v_fields) AS x LOOP
    k := f ->> 'key';
    val := CASE WHEN jsonb_typeof(v_form) = 'object' THEN v_form -> k END;
    personal := COALESCE((f ->> 'personal')::boolean, true) OR kv_form_key_must_be_personal(k);
    IF val IS NULL OR jsonb_typeof(val) = 'null' THEN
      shown := 'null'::jsonb;
    ELSIF personal THEN
      d := regexp_replace(CASE WHEN jsonb_typeof(val) = 'string' THEN val #>> '{}' ELSE val::text END, '[^0-9A-Za-z]', '', 'g');
      shown := to_jsonb(repeat('•', 6) || CASE WHEN length(d) >= 4 THEN right(d, 3) ELSE '' END);
    ELSE
      shown := gov_mask_form(val);
    END IF;
    out := out || jsonb_build_array(jsonb_build_object('key', k, 'label', f ->> 'label', 'kind', f ->> 'kind', 'personal', personal, 'value', shown));
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION gov_application_form(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_application_form(uuid) TO kv_gov;
REVOKE ALL ON FUNCTION kv_form_key_tokens(text), kv_form_key_must_be_personal(text), kv_scheme_form_fields_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_form_key_tokens(text), kv_form_key_must_be_personal(text), kv_scheme_form_fields_valid(jsonb) TO kv_admin;

-- ------------------------------------------------------------------------------------------------------------------
-- 240.3  THE AUTHORITY DECIDES — permissions, the second person by CHECK, the one act definer
-- ------------------------------------------------------------------------------------------------------------------
-- The two roles 0239 created, GUARANTEED here before they are bound (the 0174 shape; TENANT-4d-5's static rule: a migration binds only roles
-- 0056a guarantees or that it inserts itself). Same rows as 0239 — ON CONFLICT DO NOTHING, nothing changes where they exist.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code) VALUES
  ('authority_head',    'Authority head (approves and removes the authority''s roles)', 'authority', false, true, 'M17'),
  ('authority_officer', 'Authority officer (reads applications to the authority''s schemes)', 'authority', false, true, 'M17')
ON CONFLICT (code) DO NOTHING;
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('authority.applications.verify', 'Government console: check an application to this authority''s schemes, or ask the farmer for a clarification', 'M17'),
  ('authority.applications.decide', 'Government console: approve or reject an application (never one you checked, made or helped make)', 'M17')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON
       (r.code = 'authority_head'    AND p.code IN ('authority.applications.verify', 'authority.applications.decide'))
    OR (r.code = 'authority_officer' AND p.code IN ('authority.applications.verify'))
 WHERE r.scope = 'authority'
ON CONFLICT DO NOTHING;

ALTER TABLE scheme_applications ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id);
ALTER TABLE scheme_applications ADD COLUMN IF NOT EXISTS verified_realm varchar(10);
ALTER TABLE scheme_applications ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id);
ALTER TABLE scheme_applications ADD COLUMN IF NOT EXISTS decided_realm varchar(10);
ALTER TABLE scheme_applications
  ADD CONSTRAINT ck_sa_verified_whole CHECK ((verified_by IS NULL) = (verified_realm IS NULL) AND (verified_realm IS NULL OR verified_realm IN ('tenant', 'gov'))),
  ADD CONSTRAINT ck_sa_decided_whole  CHECK ((decided_by IS NULL) = (decided_realm IS NULL) AND (decided_realm IS NULL OR decided_realm IN ('tenant', 'gov'))),
  -- THE SECOND PERSON, for every role in the database (owner included): a decision follows a check by someone else ...
  ADD CONSTRAINT ck_sa_decision_needs_verifier CHECK (decided_by IS NULL OR verified_by IS NOT NULL),
  ADD CONSTRAINT ck_sa_decider_not_verifier    CHECK (decided_by IS NULL OR verified_by IS NULL OR decided_by <> verified_by),
  -- ... and is never made by the applicant or the person who helped her apply
  ADD CONSTRAINT ck_sa_decider_not_applicant   CHECK (decided_by IS NULL OR decided_by <> applicant_user_id),
  ADD CONSTRAINT ck_sa_decider_not_assister    CHECK (decided_by IS NULL OR assisted_by IS NULL OR decided_by <> assisted_by),
  -- a government rejection names a listed reason AND says it in a sentence the farmer reads
  ADD CONSTRAINT ck_sa_gov_reject_reasoned CHECK (decided_realm IS DISTINCT FROM 'gov' OR status <> 'rejected'
                                                  OR (rejection_reason_code IS NOT NULL AND char_length(btrim(COALESCE(rejection_reason, ''))) BETWEEN 10 AND 500));
COMMENT ON COLUMN scheme_applications.verified_by IS
  'PC-56 GOV-2a: the person who checked this application (verified_realm says in which realm). A decision (decided_by) is never theirs — CHECK.';
COMMENT ON COLUMN scheme_applications.decided_by IS
  'PC-56 GOV-2a: the person who approved or rejected it — never the checker, the applicant or the assister (four CHECKs).';
COMMENT ON COLUMN scheme_applications.eligibility_check IS
  'C-4 (PC-56 GOV-2a, survey_gov2 F-5) — 0011''s comment "AI checker output + confidence" is FALSE: no code writes this column; there is no AI '
  'checker and no confidence on the platform. Always NULL today.';

ALTER TABLE scheme_application_events ADD COLUMN IF NOT EXISTS actor_realm varchar(10) NOT NULL DEFAULT 'tenant';
ALTER TABLE scheme_application_events DROP CONSTRAINT IF EXISTS ck_sae_actor_realm;
ALTER TABLE scheme_application_events ADD CONSTRAINT ck_sae_actor_realm CHECK (actor_realm IN ('tenant', 'gov'));

-- THE FACTS the API's refusal order reads BEFORE any key is reserved: booleans about the session person, never an id.
CREATE OR REPLACE FUNCTION gov_application_act_facts(p_application_id uuid)
RETURNS TABLE (status text, verified boolean, actor_is_verifier boolean, actor_is_applicant boolean, actor_is_assister boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.status::text, (a.verified_by IS NOT NULL),
         (a.verified_by IS NOT NULL AND a.verified_by = kv_session_user_uuid()),
         (a.applicant_user_id = kv_session_user_uuid()),
         (a.assisted_by IS NOT NULL AND a.assisted_by = kv_session_user_uuid())
    FROM scheme_applications a
   WHERE a.id = p_application_id AND a.deleted_at IS NULL AND a.status <> 'draft'
     AND current_authority_id() IS NOT NULL AND kv_session_user_uuid() IS NOT NULL AND gov_runs_scheme(a.scheme_id);
$$;

-- THE ACT. The session person (app.user_id) in the session's authority (app.authority_id) — both from the VERIFIED token.
CREATE OR REPLACE FUNCTION gov_application_act(p_application_id uuid, p_act text, p_reason_code text, p_note text)
RETURNS TABLE (tenant_id uuid, from_status text, to_status text, scheme_id uuid, decided_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := kv_session_user_uuid();
  v_auth  uuid := current_authority_id();
  v_perm  text;
  v_note  text := NULLIF(btrim(COALESCE(p_note, '')), '');
  a       record;
  v_to    application_status;
BEGIN
  IF v_actor IS NULL OR v_auth IS NULL THEN
    RAISE EXCEPTION '[GOV_SESSION_REQUIRED] no person or authority in scope — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  v_perm := CASE p_act WHEN 'verify' THEN 'authority.applications.verify' WHEN 'clarify' THEN 'authority.applications.verify'
                       WHEN 'approve' THEN 'authority.applications.decide' WHEN 'reject' THEN 'authority.applications.decide' END;
  IF v_perm IS NULL THEN
    RAISE EXCEPTION '[GOV_ACT_UNKNOWN] the act is one of verify, clarify, approve, reject — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  -- the input rules (the API says them first; the definer says them again)
  IF p_act = 'reject' THEN
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed',
         'documents_missing', 'ineligible_landholding', 'ineligible_category', 'ineligible_region', 'portal_rejected', 'withdrawn_by_applicant', 'other') THEN
      RAISE EXCEPTION '[GOV_REASON_CODE_REQUIRED] a rejection names one reason from the list — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
    IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 10 AND 500 THEN
      RAISE EXCEPTION '[GOV_REASON_REQUIRED] a rejection says its reason in a sentence of 10 to 500 characters — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_reason_code IS NOT NULL THEN
    RAISE EXCEPTION '[GOV_REASON_CODE_ONLY_ON_REJECT] only a rejection carries a reason code — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  IF p_act = 'clarify' AND (v_note IS NULL OR char_length(v_note) NOT BETWEEN 10 AND 500) THEN
    RAISE EXCEPTION '[GOV_NOTE_REQUIRED] a clarification asks its question in a sentence of 10 to 500 characters — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION '[GOV_NOTE_REQUIRED] a note is at most 500 characters — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  -- the person's LIVE permission in THIS authority (0239's one resolver: active AND unexpired)
  IF NOT EXISTS (SELECT 1 FROM gov_access(v_actor, v_auth) g WHERE g.permission_code = v_perm) THEN
    RAISE EXCEPTION '[GOV_PERMISSION_MISSING] your role in this authority does not include this — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;
  SELECT x.id, x.tenant_id, x.scheme_id, x.status, x.applicant_user_id, x.assisted_by, x.verified_by INTO a
    FROM scheme_applications x
   WHERE x.id = p_application_id AND x.deleted_at IS NULL AND x.status <> 'draft'
   FOR UPDATE;
  IF NOT FOUND OR NOT gov_runs_scheme(a.scheme_id) THEN
    RAISE EXCEPTION '[GOV_APPLICATION_NOT_FOUND] — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
  END IF;

  IF p_act = 'verify' THEN
    IF a.status IN ('submitted', 'appealed') THEN
      v_to := 'under_verification';
      UPDATE scheme_applications x SET status = v_to, verified_by = v_actor, verified_realm = 'gov', decided_by = NULL, decided_realm = NULL,
             rejection_reason_code = NULL, updated_by = v_actor, updated_at = now()
       WHERE x.id = a.id;
    ELSIF a.status = 'under_verification' AND a.verified_by IS NULL THEN
      v_to := 'under_verification';
      UPDATE scheme_applications x SET verified_by = v_actor, verified_realm = 'gov', updated_by = v_actor, updated_at = now() WHERE x.id = a.id;
    ELSE
      RAISE EXCEPTION '[GOV_ACT_NOT_NOW] % does not allow this step — PC-56 GOV-2a', a.status USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_act = 'clarify' THEN
    IF a.status <> 'under_verification' THEN
      RAISE EXCEPTION '[GOV_ACT_NOT_NOW] % does not allow this step — PC-56 GOV-2a', a.status USING ERRCODE = 'check_violation';
    END IF;
    v_to := 'clarification_needed';
    UPDATE scheme_applications x SET status = v_to, updated_by = v_actor, updated_at = now() WHERE x.id = a.id;
  ELSE
    -- approve / reject: a DECISION — after a check, by a second person
    IF a.status <> 'under_verification' THEN
      RAISE EXCEPTION '[GOV_ACT_NOT_NOW] % does not allow this step — PC-56 GOV-2a', a.status USING ERRCODE = 'check_violation';
    END IF;
    IF a.verified_by IS NULL THEN
      RAISE EXCEPTION '[GOV_NOT_VERIFIED] a decision follows a check by another person — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
    IF a.verified_by = v_actor THEN
      RAISE EXCEPTION '[GOV_DECIDER_IS_VERIFIER] the person who checked an application does not decide it — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
    IF a.applicant_user_id = v_actor THEN
      RAISE EXCEPTION '[GOV_DECIDER_IS_APPLICANT] nobody decides their own application — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
    IF a.assisted_by IS NOT NULL AND a.assisted_by = v_actor THEN
      RAISE EXCEPTION '[GOV_DECIDER_IS_ASSISTER] nobody decides an application they helped make — PC-56 GOV-2a' USING ERRCODE = 'check_violation';
    END IF;
    IF p_act = 'approve' THEN
      v_to := 'approved';
      UPDATE scheme_applications x SET status = v_to, decided_by = v_actor, decided_realm = 'gov', decided_at = now(), updated_by = v_actor, updated_at = now()
       WHERE x.id = a.id;
    ELSE
      v_to := 'rejected';
      UPDATE scheme_applications x SET status = v_to, decided_by = v_actor, decided_realm = 'gov', decided_at = now(),
             rejection_reason = v_note, rejection_reason_code = p_reason_code, updated_by = v_actor, updated_at = now()
       WHERE x.id = a.id;
    END IF;
  END IF;

  INSERT INTO scheme_application_events (application_id, tenant_id, from_status, to_status, note, actor_user_id, actor_realm)
  VALUES (a.id, a.tenant_id, a.status, v_to,
          CASE WHEN p_act = 'reject' THEN p_reason_code || ': ' || v_note WHEN p_act = 'verify' THEN NULL ELSE v_note END,
          v_actor, 'gov');

  RETURN QUERY SELECT a.tenant_id, a.status::text, v_to::text, a.scheme_id, x.decided_at FROM scheme_applications x WHERE x.id = a.id;
END $$;
REVOKE ALL ON FUNCTION gov_application_act_facts(uuid), gov_application_act(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_application_act_facts(uuid), gov_application_act(uuid, text, text, text) TO kv_gov;

-- ------------------------------------------------------------------------------------------------------------------
-- 240.4  THE AUTHORITY'S SCHEMES — published fields only; never an amount, a draft's content or an operator id
-- ------------------------------------------------------------------------------------------------------------------
-- The public face of ONE version (internal: not granted to anyone; the DEFINERs below call it as the owner).
CREATE OR REPLACE FUNCTION gov_version_public(p_version_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'benefitType', CASE WHEN (v.benefit_summary ->> 'type') ~ '^[a-z][a-z0-9_]{0,39}$' THEN v.benefit_summary ->> 'type' END,
           'instalments', CASE WHEN (v.benefit_summary ->> 'instalments') ~ '^[0-9]{1,3}$' THEN (v.benefit_summary ->> 'instalments')::int END,
           'rules', jsonb_strip_nulls(jsonb_build_object(
              'roles', v.eligibility_rules -> 'roles', 'landholding_max_acres', v.eligibility_rules -> 'landholding_max_acres',
              'gender', v.eligibility_rules -> 'gender', 'age_min', v.eligibility_rules -> 'age_min', 'age_max', v.eligibility_rules -> 'age_max')),
           'applicationWindow', v.application_window,
           'regions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.default_name) ORDER BY r.default_name, r.id)
                                  FROM admin_regions r WHERE r.id::text IN (SELECT jsonb_array_elements_text(v.applicable_region_ids))), '[]'::jsonb),
           'requiredDocuments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.default_name) ORDER BY l.code, l.id)
                                  FROM lookup_values l WHERE l.id::text IN (SELECT jsonb_array_elements_text(v.required_doc_type_ids))), '[]'::jsonb),
           'formFields', v.form_fields)
    FROM scheme_versions v WHERE v.id = p_version_id AND v.status <> 'draft' AND v.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION gov_version_public(uuid) FROM PUBLIC;

-- One scheme (p_scheme_id) or every scheme (NULL) the session's authority runs, read from its PUBLISHED version.
CREATE OR REPLACE FUNCTION gov_scheme_read(p_scheme_id uuid)
RETURNS TABLE (id uuid, code text, name text, category_code text, category_name text, is_active boolean, version integer, version_id uuid,
               published_at timestamptz, published_by_second_person boolean, is_backfilled boolean, newer_draft_exists boolean,
               unrecorded_below integer, public jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.code::text, s.default_name::text, c.code::text, c.default_name::text, s.is_active, v.version, v.id, v.published_at,
         (v.id IS NOT NULL AND NOT v.is_backfilled AND v.published_by IS NOT NULL AND v.drafted_by IS NOT NULL AND v.published_by <> v.drafted_by),
         COALESCE(v.is_backfilled, false),
         EXISTS (SELECT 1 FROM scheme_versions d WHERE d.scheme_id = s.id AND d.status = 'draft' AND d.deleted_at IS NULL),
         (SELECT CASE WHEN min(h.version) > 1 THEN min(h.version) END FROM scheme_versions h
           WHERE h.scheme_id = s.id AND h.status <> 'draft' AND h.deleted_at IS NULL),
         CASE WHEN v.id IS NOT NULL THEN gov_version_public(v.id) END
    FROM schemes s
    LEFT JOIN lookup_values c ON c.id = s.category_id
    LEFT JOIN scheme_versions v ON v.scheme_id = s.id AND v.status = 'published' AND v.deleted_at IS NULL
   WHERE current_authority_id() IS NOT NULL AND s.authority_id = current_authority_id() AND s.deleted_at IS NULL
     AND (p_scheme_id IS NULL OR s.id = p_scheme_id)
   ORDER BY s.code, s.id;
$$;

-- The versions of one of the authority's schemes — published and superseded only (a draft is never listed); no operator id.
CREATE OR REPLACE FUNCTION gov_scheme_versions(p_scheme_id uuid)
RETURNS TABLE (version integer, status text, published_at timestamptz, published_by_second_person boolean, is_backfilled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.version, v.status::text, v.published_at,
         (NOT v.is_backfilled AND v.published_by IS NOT NULL AND v.drafted_by IS NOT NULL AND v.published_by <> v.drafted_by), v.is_backfilled
    FROM scheme_versions v JOIN schemes s ON s.id = v.scheme_id
   WHERE current_authority_id() IS NOT NULL AND s.authority_id = current_authority_id() AND s.deleted_at IS NULL
     AND v.scheme_id = p_scheme_id AND v.status <> 'draft' AND v.deleted_at IS NULL
   ORDER BY v.version DESC
   LIMIT 200;
$$;

-- Version N against the recorded version below it, field by field, over the PUBLIC fields only (no amount, no fee). No row for a draft,
-- an unknown version or another authority's scheme. `compared_with` NULL when nothing below N was recorded.
CREATE OR REPLACE FUNCTION gov_scheme_version_diff(p_scheme_id uuid, p_version integer)
RETURNS TABLE (compared_with integer, field text, from_value jsonb, to_value jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_this uuid; v_below uuid; v_below_n integer; pub_this jsonb; pub_below jsonb; k text; n integer := 0;
BEGIN
  SELECT v.id INTO v_this FROM scheme_versions v JOIN schemes s ON s.id = v.scheme_id
   WHERE current_authority_id() IS NOT NULL AND s.authority_id = current_authority_id() AND s.deleted_at IS NULL
     AND v.scheme_id = p_scheme_id AND v.version = p_version AND v.status <> 'draft' AND v.deleted_at IS NULL;
  IF v_this IS NULL THEN RETURN; END IF;
  SELECT v.id, v.version INTO v_below, v_below_n FROM scheme_versions v
   WHERE v.scheme_id = p_scheme_id AND v.version < p_version AND v.status <> 'draft' AND v.deleted_at IS NULL
   ORDER BY v.version DESC LIMIT 1;
  pub_this := gov_version_public(v_this);
  pub_below := CASE WHEN v_below IS NOT NULL THEN gov_version_public(v_below) END;
  FOREACH k IN ARRAY ARRAY['benefitType', 'instalments', 'rules', 'applicationWindow', 'regions', 'requiredDocuments', 'formFields'] LOOP
    IF pub_below IS NULL OR (pub_below -> k) IS DISTINCT FROM (pub_this -> k) THEN
      compared_with := v_below_n; field := k; from_value := pub_below -> k; to_value := pub_this -> k; n := n + 1;
      RETURN NEXT;
    END IF;
  END LOOP;
  -- a version with nothing changed in the public fields still answers (one row, field NULL) so "found, no visible change" ≠ "not found"
  IF n = 0 THEN compared_with := v_below_n; field := NULL; from_value := NULL; to_value := NULL; RETURN NEXT; END IF;
END $$;

REVOKE ALL ON FUNCTION gov_scheme_read(uuid), gov_scheme_versions(uuid), gov_scheme_version_diff(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_scheme_read(uuid), gov_scheme_versions(uuid), gov_scheme_version_diff(uuid, integer) TO kv_gov;
