-- ==================================================================================================================
-- MIGRATION 0182 — PC-56 TENANT-9b · THE RESOLUTIONS — A CLOSED VOTE IS A FACT
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0009, 0088, 0125, 0130 and 0181 are applied; nothing here
-- edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t9.md F-13, F-14, F-15, F-17, F-18), RE-PROVEN AT d8543fa BEFORE THIS FILE:
--   • F-13 A CLOSED RESOLUTION'S RESULT MOVED. `GovernanceService.results` counted today's eligible roll for every
--          resolution, closed or not, so a closed AGM's turnout and "passed" changed whenever a member joined or sold
--          shares — the denominator 0130 snapshots at close (`eligible_at_close`) was read by the register tile and by
--          nothing else. The quorum was read live from today's bylaws too. A ballot was any string of 1–20 characters
--          ("yes" was counted in `cast` and never in favour). `coop_votes` had no tenant_id and no RLS. Nothing recorded
--          WHO opened or closed a resolution, WHEN, or WHY; `status` and `resolution_type` had no CHECK.
--   • F-14 THE DIVIDEND RUN was payable on any `closed` (or the never-written `activated`) dividend resolution — one
--          that FAILED included — and its "checker" was a uuid typed into the MAKER's own request body: the second
--          person never acted.
--
-- WHAT THIS FILE DOES
--   182.1  THE VOCABULARIES AS DATA. `resolution_type` (the canon's four — W198: "coop_resolutions: agm_vote · dividend ·
--          patronage_bonus · board_election"; meta says which are dividend-class, i.e. pay members) and
--          `resolution_choice` (meta lists the types a choice is declared for — for / against / abstain on a motion;
--          NOTHING for `board_election`, whose ballot names candidates and there is no candidate table: refused by name,
--          never invented here). `resolution_close_reason` and `resolution_withdraw_reason`, the reasons an act is
--          recorded with. DECIDED (recorded in the wave report): the brief's "ordinary | special" is a MAJORITY rule,
--          not a subject — a dividend can be put as an ordinary or a special resolution — so it is its own column
--          (`majority`), and the type CHECK keeps the canon's four subjects.
--   182.2  THE LIFECYCLE, RECORDED. `opened_at / opened_by`, `closed_at / closed_by / close_reason`, `withdrawn_at /
--          withdrawn_by / withdraw_reason`, `majority`, the rule the members voted under fixed when voting OPENS
--          (`quorum_bp`, `pass_num / pass_den / pass_strict`, `rule_fixed_at`), and `outcome` — WRITTEN BY THE DATABASE
--          at close (`coop_resolution_outcome`), from the frozen ballot box and the snapshot, never by the caller.
--          Widen first, then backfill (every pre-0182 closed resolution: `outcome = 'not_recorded'` — 1e's rule, unknown
--          is not a number), then the CHECKs (status `draft → open → closed | withdrawn`, the canon's four types,
--          majority, outcome, and the instants that must agree with the status).
--   182.3  THE GUARD (`trg_coop_resolutions_guard`, every role, owner included): a resolution is born a draft; its words
--          change only while it is a draft; the only moves are draft→open, open→closed, draft|open→withdrawn; a closed or
--          withdrawn resolution never changes again; opening fixes the rule; closing needs its snapshot and computes the
--          outcome; **a `special` or dividend-class resolution cannot be closed by the person who opened it** (maker ≠
--          checker, the 7a/8a/9a pattern → 23514); `board_election` cannot open (no candidate model).
--   182.4  THE BALLOT BOX. `coop_votes.tenant_id` (backfilled from the resolution, NOT NULL, and forced to the
--          resolution's tenant by the trigger — a vote can never carry another cooperative's id); RLS ENABLE + FORCE
--          (`cv_tenant`); `trg_coop_votes_guard` — a vote is written only while its resolution is OPEN and inside its
--          window, only with a choice DECLARED for the resolution's type (`resolution_choice`), and never moves to
--          another resolution or member. So the numerator of a closed result is frozen in the database, not by app care.
--   182.5  THE DIVIDEND GATE (F-14). `coop_resolution_payable(id)` — closed AND dividend-class AND outcome `passed`;
--          `trg_coop_payout_runs_payable` refuses any run on anything else (23514; a CHECK may not read another table, so
--          a trigger). The run becomes TWO acts: the maker PREPARES (`status = 'prepared'`, no batch, no payout row), a
--          DIFFERENT person CONFIRMS — `confirmed_by` is the confirming caller, a real user FK, and
--          `ck_cpr_checker_is_not_maker` + `ck_cpr_confirmed_has_checker` hold it. The money itself stays exactly where it
--          was: the confirm writes a `payout_batches` row `status 'open'` and `payouts` rows `queued` with the 0088
--          `dividend` / `patronage_bonus` purpose, behind TENANT-4b's two-person batch gate (0143) and 0125's per-role
--          KYC preflight (`payout_purpose_roles`: dividend → farmer, dairy_farmer, pashupalak — there is no `member` role
--          on this platform, so "the member role" of the brief IS those three rows). No new money path (Law 2).
--   182.6  THE PERMISSION (F-18): `governance.manage` — draft, edit a draft, open, close, withdraw (tenant_admin; no board
--          role exists — the canon's "Drafting is board members" is named, not modelled). Here AND in seed 0004.
--   182.7  THE BYLAW (rule zero): `governance.special_majority_num / _den` (2/3), beside 0130's three — the fraction of
--          CAST votes a special resolution needs, as data.
--   182.8  THE WALL (0175's split, F-12 class): `coop_resolutions`, `coop_share_registers`, `coop_payout_runs` lose the
--          FOR ALL `tenant_id IS NULL OR …` policy for read / insert / update policies bound to the tenant and a kv_admin
--          realm policy; REVOKE before the narrow GRANT (no DELETE for anybody in the tenant realm; kv_relay never touched
--          these tables — `grep -rn coop_ apps/worker` → 0 — and loses its write grants).
--
-- RLS DECISION: every table in this file carries tenant_id NOT NULL and is RLS ENABLE + FORCE with tenant-bound policies
-- (`coop_votes` newly). PARTITION NOTE: none of these tables is partitioned (row counts are per-cooperative-per-AGM, a few
-- thousand ballots a year); no Law 8 lookup applies.
--
-- WHAT THIS FILE DOES NOT DO (named): no candidate table (board_election stays refused by name); no paper-ballot
-- ingestion (TENANT-1e-Q1); no notice-period record (TENANT-1e-Q3); no auto-close job at `voting_closes` (the ballot is
-- refused after the window in the DB; the CLOSE is a person's recorded act, because it fixes a result); no per-language
-- title / body (one text — named).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 182.1  THE VOCABULARIES
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('resolution_type',            'Resolution type',             false),
  ('resolution_choice',          'Ballot choice',               false),
  ('resolution_close_reason',    'Why voting was closed',       false),
  ('resolution_withdraw_reason', 'Why a resolution was withdrawn', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.t, NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('resolution_type', 'agm_vote',        'AGM motion',                 '{"dividend_class":false,"ballot":"motion"}', 1),
    ('resolution_type', 'dividend',        'Dividend',                   '{"dividend_class":true,"ballot":"motion","purpose":"dividend"}', 2),
    ('resolution_type', 'patronage_bonus', 'Patronage bonus',            '{"dividend_class":true,"ballot":"motion","purpose":"patronage_bonus"}', 3),
    ('resolution_type', 'board_election',  'Board election',             '{"dividend_class":false,"ballot":"candidates","modelled":false}', 4),
    ('resolution_choice', 'for',     'For',     '{"types":["agm_vote","dividend","patronage_bonus"],"in_favour":true}', 1),
    ('resolution_choice', 'against', 'Against', '{"types":["agm_vote","dividend","patronage_bonus"],"in_favour":false}', 2),
    ('resolution_choice', 'abstain', 'Abstain', '{"types":["agm_vote","dividend","patronage_bonus"],"in_favour":false}', 3),
    ('resolution_close_reason', 'window_ended',     'The voting window has ended',                 '{}', 1),
    ('resolution_close_reason', 'all_have_voted',   'Every eligible member has voted',             '{}', 2),
    ('resolution_close_reason', 'agm_declared',     'Declared at the general meeting',             '{}', 3),
    ('resolution_withdraw_reason', 'drafting_error',  'The resolution was drafted in error',       '{}', 1),
    ('resolution_withdraw_reason', 'superseded',      'Replaced by another resolution',            '{}', 2),
    ('resolution_withdraw_reason', 'legal_advice',    'Withdrawn on legal or registrar advice',    '{}', 3),
    ('resolution_withdraw_reason', 'board_decision',  'Withdrawn by decision of the board',        '{}', 4)
  ) AS v(t, code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.t AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 182.2  THE LIFECYCLE, RECORDED — widen, backfill, then CHECK
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE coop_resolutions
  ADD COLUMN IF NOT EXISTS majority        varchar(10) NOT NULL DEFAULT 'ordinary',
  ADD COLUMN IF NOT EXISTS opened_at       timestamptz,
  ADD COLUMN IF NOT EXISTS opened_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS closed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS close_reason    varchar(40),
  ADD COLUMN IF NOT EXISTS withdrawn_at    timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS withdraw_reason varchar(40),
  ADD COLUMN IF NOT EXISTS quorum_bp       integer,
  ADD COLUMN IF NOT EXISTS pass_num        integer,
  ADD COLUMN IF NOT EXISTS pass_den        integer,
  ADD COLUMN IF NOT EXISTS pass_strict     boolean,
  ADD COLUMN IF NOT EXISTS rule_fixed_at   varchar(5),
  ADD COLUMN IF NOT EXISTS outcome         varchar(14);

COMMENT ON COLUMN coop_resolutions.majority IS 'PC-56 TENANT-9b · ordinary (more than half of CAST votes) or special (at least governance.special_majority_num/_den of cast). A special resolution is closed by a second person (trg_coop_resolutions_guard).';
COMMENT ON COLUMN coop_resolutions.quorum_bp IS 'PC-56 TENANT-9b · the quorum the members voted under, fixed when voting OPENED (or, for one opened before 0182, when it closed — rule_fixed_at says which). Never re-read from today''s bylaws for a closed resolution.';
COMMENT ON COLUMN coop_resolutions.outcome IS 'PC-56 TENANT-9b · WRITTEN BY THE DATABASE at close (coop_resolution_outcome over the frozen ballot box, eligible_at_close and the fixed rule): passed | failed. not_recorded = closed before 0182 — never a recomputed number.';
COMMENT ON COLUMN coop_resolutions.closed_by IS 'PC-56 TENANT-9b · who closed voting. For a special or dividend-class resolution this must not be opened_by (maker ≠ checker, 23514).';

-- Nothing in the tree writes a status outside the four (`activated` is read by one rule and written by nothing — the
-- survey's grep); a row that says otherwise is named here rather than silently mapped.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM coop_resolutions WHERE status NOT IN ('draft', 'open', 'closed', 'withdrawn')
     OR resolution_type NOT IN ('agm_vote', 'dividend', 'patronage_bonus', 'board_election');
  IF bad > 0 THEN
    RAISE EXCEPTION '0182: % coop_resolutions row(s) carry a status or type outside the declared vocabulary — resolve by hand before this migration', bad;
  END IF;
END $$;

-- 1e's rule: a resolution closed before the snapshot existed has NO recorded result. Its closed_at is unknown too
-- (`updated_at` is the last write, not the close) — left NULL, never guessed.
UPDATE coop_resolutions SET outcome = 'not_recorded' WHERE status = 'closed' AND outcome IS NULL;

ALTER TABLE coop_resolutions
  ADD CONSTRAINT ck_cres_status   CHECK (status IN ('draft', 'open', 'closed', 'withdrawn')),
  ADD CONSTRAINT ck_cres_type     CHECK (resolution_type IN ('agm_vote', 'dividend', 'patronage_bonus', 'board_election')),
  ADD CONSTRAINT ck_cres_majority CHECK (majority IN ('ordinary', 'special')),
  ADD CONSTRAINT ck_cres_outcome  CHECK (outcome IS NULL OR outcome IN ('passed', 'failed', 'not_recorded')),
  ADD CONSTRAINT ck_cres_rule_fixed CHECK (rule_fixed_at IS NULL OR rule_fixed_at IN ('open', 'close')),
  -- A closed resolution always says what it decided — a fact, or "not recorded"; an unclosed one says nothing.
  ADD CONSTRAINT ck_cres_closed_has_outcome CHECK ((status = 'closed') = (outcome IS NOT NULL)),
  -- A recorded result needs the whole snapshot it was computed from.
  ADD CONSTRAINT ck_cres_outcome_has_snapshot CHECK (outcome IS NULL OR outcome = 'not_recorded'
       OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason IS NOT NULL AND eligible_at_close IS NOT NULL
           AND quorum_bp IS NOT NULL AND pass_num IS NOT NULL AND pass_den IS NOT NULL AND pass_strict IS NOT NULL)),
  ADD CONSTRAINT ck_cres_withdrawn CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdraw_reason IS NOT NULL)),
  ADD CONSTRAINT ck_cres_rule_sane CHECK (quorum_bp IS NULL OR (quorum_bp BETWEEN 1 AND 10000
       AND pass_num >= 1 AND pass_den >= 2 AND pass_num < pass_den)),
  ADD CONSTRAINT ck_cres_window CHECK (voting_opens IS NULL OR voting_closes IS NULL OR voting_closes > voting_opens);

CREATE INDEX IF NOT EXISTS idx_coop_resolutions_keyset ON coop_resolutions (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 182.3  THE RESULT, AND THE GUARD
-- ------------------------------------------------------------------------------------------------------------------
-- THE ONE PLACE A RESULT IS DECIDED. The TypeScript `tally()` prints the same arithmetic for an OPEN resolution and is
-- asserted equal to this over a fact matrix (tenant9b spec); for a CLOSED one the page prints this column.
--   turnout_bp = floor(cast × 10000 / eligible);  quorum met = eligible > 0 AND turnout_bp ≥ quorum_bp;
--   in favour  = ballots whose choice is declared in_favour ('for');
--   passed     = cast > 0 AND quorum met AND (strict: for × den > cast × num | not strict: for × den ≥ cast × num).
-- One member one vote: the count is of ROWS of coop_votes (one per member by primary key) — no shareholding enters.
CREATE OR REPLACE FUNCTION coop_resolution_outcome(p_resolution uuid, p_eligible integer, p_quorum_bp integer,
                                                   p_num integer, p_den integer, p_strict boolean) RETURNS varchar
LANGUAGE plpgsql STABLE AS $$
DECLARE n_cast bigint; n_for bigint; turnout bigint;
BEGIN
  IF p_eligible IS NULL OR p_quorum_bp IS NULL OR p_num IS NULL OR p_den IS NULL OR p_strict IS NULL THEN
    RETURN 'not_recorded';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM lookup_values lv
                                         WHERE lv.type_code = 'resolution_choice' AND lv.tenant_id IS NULL
                                           AND lv.code = v.choice AND (lv.meta->>'in_favour')::boolean))
    INTO n_cast, n_for
    FROM coop_votes v WHERE v.resolution_id = p_resolution;
  IF n_cast = 0 OR p_eligible <= 0 THEN RETURN 'failed'; END IF;
  turnout := (n_cast * 10000) / p_eligible;
  IF turnout < p_quorum_bp THEN RETURN 'failed'; END IF;
  IF p_strict THEN
    RETURN CASE WHEN n_for * p_den > n_cast * p_num THEN 'passed' ELSE 'failed' END;
  END IF;
  RETURN CASE WHEN n_for * p_den >= n_cast * p_num THEN 'passed' ELSE 'failed' END;
END $$;
COMMENT ON FUNCTION coop_resolution_outcome(uuid, integer, integer, integer, integer, boolean) IS
  'PC-56 TENANT-9b · the result of a resolution from its ballot box and the snapshot it closed with. not_recorded when any part of the snapshot is missing — never a number computed from today.';

CREATE OR REPLACE FUNCTION coop_resolutions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dividend_class boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.opened_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.outcome IS NOT NULL
       OR NEW.withdrawn_at IS NOT NULL OR NEW.quorum_bp IS NOT NULL OR NEW.eligible_at_close IS NOT NULL THEN
      RAISE EXCEPTION 'coop_resolutions: a resolution is born a draft — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- A decided resolution is a fact. Nothing moves it — not its words, not its status, not its snapshot.
  IF OLD.status IN ('closed', 'withdrawn') THEN
    RAISE EXCEPTION 'coop_resolutions: % is % and can never change — PC-56 TENANT-9b', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'coop_resolutions: a resolution never changes cooperative — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
  END IF;

  -- The words members vote on change only while nobody can vote on them.
  IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.resolution_type IS DISTINCT FROM OLD.resolution_type OR NEW.majority IS DISTINCT FROM OLD.majority
       OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.voting_opens IS DISTINCT FROM OLD.voting_opens
       OR NEW.voting_closes IS DISTINCT FROM OLD.voting_closes) THEN
    RAISE EXCEPTION 'coop_resolutions: % is % — its text, type, majority, window and formula are fixed — PC-56 TENANT-9b', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- What an earlier move recorded is never rewritten by a later one.
    IF OLD.opened_at IS NOT NULL AND (NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opened_by IS DISTINCT FROM OLD.opened_by) THEN
      RAISE EXCEPTION 'coop_resolutions: who opened % and when is already recorded — PC-56 TENANT-9b', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.rule_fixed_at IS NOT NULL AND (NEW.quorum_bp IS DISTINCT FROM OLD.quorum_bp OR NEW.pass_num IS DISTINCT FROM OLD.pass_num
         OR NEW.pass_den IS DISTINCT FROM OLD.pass_den OR NEW.pass_strict IS DISTINCT FROM OLD.pass_strict
         OR NEW.rule_fixed_at IS DISTINCT FROM OLD.rule_fixed_at) THEN
      RAISE EXCEPTION 'coop_resolutions: the rule % was voted under is fixed — PC-56 TENANT-9b', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'closed' AND (NEW.eligible_at_close IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL) THEN
      RAISE EXCEPTION 'coop_resolutions: only the close records a close — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((OLD.status = 'draft' AND NEW.status IN ('open', 'withdrawn'))
         OR (OLD.status = 'open'  AND NEW.status IN ('closed', 'withdrawn'))) THEN
      RAISE EXCEPTION 'coop_resolutions: % → % is not a move a resolution makes — PC-56 TENANT-9b', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'open' THEN
      IF NEW.resolution_type = 'board_election' THEN
        RAISE EXCEPTION 'coop_resolutions: a board_election ballot names candidates and no candidate table exists — refused by name — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.opened_at IS NULL OR NEW.opened_by IS NULL OR NEW.quorum_bp IS NULL OR NEW.pass_num IS NULL
         OR NEW.pass_den IS NULL OR NEW.pass_strict IS NULL OR NEW.rule_fixed_at IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'coop_resolutions: opening records who, when, and the rule the members vote under — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.status = 'closed' THEN
      IF NEW.closed_at IS NULL OR NEW.closed_by IS NULL OR NEW.close_reason IS NULL OR NEW.eligible_at_close IS NULL
         OR NEW.quorum_bp IS NULL OR NEW.pass_num IS NULL OR NEW.pass_den IS NULL OR NEW.pass_strict IS NULL THEN
        RAISE EXCEPTION 'coop_resolutions: closing records who, when, why, the eligible roll and the rule — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
      END IF;
      -- Opened before 0182: no rule was fixed at open, so the rule in force at the close is recorded — and SAYS so.
      IF OLD.rule_fixed_at IS NULL AND NEW.rule_fixed_at IS DISTINCT FROM 'close' THEN
        RAISE EXCEPTION 'coop_resolutions: a rule first recorded at close is marked rule_fixed_at = close — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM lookup_values WHERE type_code = 'resolution_close_reason' AND tenant_id IS NULL AND code = NEW.close_reason) THEN
        RAISE EXCEPTION 'coop_resolutions: close reason % is not declared — PC-56 TENANT-9b', NEW.close_reason USING ERRCODE = 'check_violation';
      END IF;
      SELECT COALESCE((meta->>'dividend_class')::boolean, false) INTO dividend_class
        FROM lookup_values WHERE type_code = 'resolution_type' AND tenant_id IS NULL AND code = NEW.resolution_type;
      -- MAKER ≠ CHECKER on the votes that decide money or need a special majority. A resolution opened before 0182 has
      -- no recorded opener: the rule cannot be applied to a person nobody wrote down (named in the wave report).
      IF (NEW.majority = 'special' OR COALESCE(dividend_class, false)) AND OLD.opened_by IS NOT NULL AND NEW.closed_by = OLD.opened_by THEN
        RAISE EXCEPTION 'coop_resolutions: the person who opened % cannot also close it (special or dividend-class — a second person) — PC-56 TENANT-9b maker-checker', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      -- THE RESULT IS THE DATABASE'S, NOT THE CALLER'S.
      NEW.outcome := coop_resolution_outcome(NEW.id, NEW.eligible_at_close, NEW.quorum_bp, NEW.pass_num, NEW.pass_den, NEW.pass_strict);
    END IF;

    IF NEW.status = 'withdrawn' THEN
      IF NOT EXISTS (SELECT 1 FROM lookup_values WHERE type_code = 'resolution_withdraw_reason' AND tenant_id IS NULL AND code = NEW.withdraw_reason) THEN
        RAISE EXCEPTION 'coop_resolutions: withdraw reason % is not declared — PC-56 TENANT-9b', NEW.withdraw_reason USING ERRCODE = 'check_violation';
      END IF;
      NEW.outcome := NULL;
    END IF;
  ELSE
    -- No move: the lifecycle columns are written only by the move that owns them.
    IF NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
       OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.eligible_at_close IS DISTINCT FROM OLD.eligible_at_close
       OR NEW.quorum_bp IS DISTINCT FROM OLD.quorum_bp OR NEW.pass_num IS DISTINCT FROM OLD.pass_num
       OR NEW.pass_den IS DISTINCT FROM OLD.pass_den OR NEW.pass_strict IS DISTINCT FROM OLD.pass_strict THEN
      RAISE EXCEPTION 'coop_resolutions: the lifecycle record is written only by open / close — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_coop_resolutions_guard ON coop_resolutions;
CREATE TRIGGER trg_coop_resolutions_guard BEFORE INSERT OR UPDATE ON coop_resolutions
  FOR EACH ROW EXECUTE FUNCTION coop_resolutions_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 182.4  THE BALLOT BOX
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE coop_votes ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE coop_votes v SET tenant_id = r.tenant_id FROM coop_resolutions r WHERE r.id = v.resolution_id AND v.tenant_id IS NULL;
ALTER TABLE coop_votes ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coop_votes_tenant ON coop_votes (tenant_id, resolution_id);
COMMENT ON COLUMN coop_votes.tenant_id IS 'PC-56 TENANT-9b · the resolution''s cooperative, forced by trg_coop_votes_guard (a ballot can never carry another tenant''s id) and the key of cv_tenant. Before 0182 the ballot box had no tenant column and no RLS — ballot isolation was app discipline only.';

CREATE OR REPLACE FUNCTION coop_votes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.resolution_id <> OLD.resolution_id OR NEW.member_user_id <> OLD.member_user_id) THEN
    RAISE EXCEPTION 'coop_votes: a ballot never moves to another resolution or member — PC-56 TENANT-9b' USING ERRCODE = 'check_violation';
  END IF;
  SELECT id, tenant_id, status, resolution_type, voting_opens, voting_closes INTO r
    FROM coop_resolutions WHERE id = NEW.resolution_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'coop_votes: no such resolution — PC-56 TENANT-9b' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := r.tenant_id;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'coop_votes: resolution % is % — votes are written only while it is open (immutable after close) — PC-56 TENANT-9b', r.id, r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.voting_opens IS NOT NULL AND now() < r.voting_opens THEN
    RAISE EXCEPTION 'coop_votes: voting on % has not started — PC-56 TENANT-9b', r.id USING ERRCODE = 'check_violation';
  END IF;
  IF r.voting_closes IS NOT NULL AND now() > r.voting_closes THEN
    RAISE EXCEPTION 'coop_votes: voting on % has closed — PC-56 TENANT-9b', r.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM lookup_values lv
                  WHERE lv.type_code = 'resolution_choice' AND lv.tenant_id IS NULL AND lv.code = NEW.choice AND lv.is_active
                    AND (lv.meta->'types') ? r.resolution_type) THEN
    RAISE EXCEPTION 'coop_votes: % is not a choice declared for a % ballot — PC-56 TENANT-9b', NEW.choice, r.resolution_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_coop_votes_guard ON coop_votes;
CREATE TRIGGER trg_coop_votes_guard BEFORE INSERT OR UPDATE ON coop_votes
  FOR EACH ROW EXECUTE FUNCTION coop_votes_guard();

ALTER TABLE coop_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coop_votes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cv_tenant ON coop_votes;
DROP POLICY IF EXISTS cv_admin_realm ON coop_votes;
CREATE POLICY cv_tenant ON coop_votes FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cv_admin_realm ON coop_votes FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON coop_votes FROM kv_app, kv_relay;
GRANT SELECT ON coop_votes TO kv_app, kv_readonly;
GRANT INSERT (resolution_id, member_user_id, choice, tenant_id) ON coop_votes TO kv_app;
GRANT UPDATE (choice, previous_choice, changed_at, change_count) ON coop_votes TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 182.5  THE DIVIDEND GATE
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION coop_resolution_payable(p_resolution uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM coop_resolutions r
      JOIN lookup_values lv ON lv.type_code = 'resolution_type' AND lv.tenant_id IS NULL AND lv.code = r.resolution_type
     WHERE r.id = p_resolution AND r.deleted_at IS NULL
       AND r.status = 'closed' AND r.outcome = 'passed'
       AND COALESCE((lv.meta->>'dividend_class')::boolean, false));
$$;
COMMENT ON FUNCTION coop_resolution_payable(uuid) IS 'PC-56 TENANT-9b (F-14) · a co-op payout run is payable ONLY from a closed dividend-class resolution whose recorded outcome is passed. Before 0182 a failed dividend vote was payable.';

-- Widen before the CHECK: the run is born `prepared` (the maker's act) and only a different person confirms it.
ALTER TABLE coop_payout_runs DROP CONSTRAINT IF EXISTS coop_payout_runs_status_check;
ALTER TABLE coop_payout_runs ADD CONSTRAINT coop_payout_runs_status_check
  CHECK (status IN ('prepared', 'queued', 'executing', 'completed', 'cancelled'));
ALTER TABLE coop_payout_runs ADD COLUMN IF NOT EXISTS prepared_at timestamptz;
ALTER TABLE coop_payout_runs ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id);

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM coop_payout_runs
   WHERE prepared_by IS NULL OR (confirmed_by IS NOT NULL AND confirmed_by = prepared_by)
      OR (status NOT IN ('prepared', 'cancelled') AND confirmed_by IS NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION '0182: % coop_payout_runs row(s) have no maker, a checker equal to the maker, or a queued run with no checker — resolve by hand', bad;
  END IF;
END $$;

ALTER TABLE coop_payout_runs
  ADD CONSTRAINT ck_cpr_has_maker CHECK (prepared_by IS NOT NULL),
  ADD CONSTRAINT ck_cpr_checker_is_not_maker CHECK (confirmed_by IS NULL OR confirmed_by <> prepared_by),
  ADD CONSTRAINT ck_cpr_confirmed_has_checker CHECK (status IN ('prepared', 'cancelled') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  ADD CONSTRAINT ck_cpr_prepared_has_no_money CHECK (status <> 'prepared' OR (batch_id IS NULL AND confirmed_by IS NULL));
COMMENT ON COLUMN coop_payout_runs.confirmed_by IS 'PC-56 TENANT-9b · the CHECKER — the user who performed the confirm act (never a uuid in the maker''s body, never the maker: ck_cpr_checker_is_not_maker).';

CREATE OR REPLACE FUNCTION coop_payout_runs_payable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coop_resolution_payable(NEW.resolution_id) THEN
    RAISE EXCEPTION 'coop_payout_runs: resolution % is not payable — only a closed dividend-class resolution whose recorded outcome is passed pays — PC-56 TENANT-9b', NEW.resolution_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_coop_payout_runs_payable ON coop_payout_runs;
CREATE TRIGGER trg_coop_payout_runs_payable BEFORE INSERT OR UPDATE OF resolution_id ON coop_payout_runs
  FOR EACH ROW EXECUTE FUNCTION coop_payout_runs_payable();

-- ------------------------------------------------------------------------------------------------------------------
-- 182.6  THE PERMISSION
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('governance.manage', 'Draft a resolution, edit a draft, open and close voting, withdraw (recorded; a special or dividend vote is closed by a second person)', 'M04')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'governance.manage' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 182.7  THE BYLAW
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES
  ('governance.special_majority_num', 'int', 'tenant', 'security', '2'::jsonb,
   'Numerator of the share of CAST votes a SPECIAL resolution needs in favour (with governance.special_majority_den: 2/3 = two-thirds). Must be more than half and less than all.',
   'This decides whether a special resolution carries. Two administrators.'),
  ('governance.special_majority_den', 'int', 'tenant', 'security', '3'::jsonb,
   'Denominator of the special-majority fraction (see governance.special_majority_num).',
   'This decides whether a special resolution carries. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 182.8  THE WALL
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coop_resolutions', 'coop_share_registers', 'coop_payout_runs'] LOOP
    p := CASE t WHEN 'coop_resolutions' THEN 'cres' WHEN 'coop_share_registers' THEN 'csr' ELSE 'cpr' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', p || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', p || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', p || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', p || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_app, kv_readonly', t);
  END LOOP;
END $$;

GRANT INSERT (id, tenant_id, title, body, resolution_type, majority, voting_opens, voting_closes, payload, status, created_by, updated_by)
  ON coop_resolutions TO kv_app;
GRANT UPDATE (title, body, resolution_type, majority, voting_opens, voting_closes, payload, status,
              opened_at, opened_by, closed_at, closed_by, close_reason, withdrawn_at, withdrawn_by, withdraw_reason,
              quorum_bp, pass_num, pass_den, pass_strict, rule_fixed_at, eligible_at_close, outcome, updated_at, updated_by)
  ON coop_resolutions TO kv_app;
-- The share register keeps 0009's write surface for kv_app (TENANT-1e: no edit route exists; the allotment is a money path).
GRANT INSERT, UPDATE ON coop_share_registers TO kv_app;
GRANT INSERT (id, tenant_id, resolution_id, batch_id, purpose_code, formula_snapshot, total_minor, member_count, skipped_count,
              skipped_detail, currency_code, status, prepared_by, prepared_at, confirmed_by, confirmed_at, idempotency_key, created_by, updated_by)
  ON coop_payout_runs TO kv_app;
GRANT UPDATE (batch_id, status, confirmed_by, confirmed_at, cancel_reason, cancelled_by, total_minor, member_count, skipped_count,
              skipped_detail, version, updated_at, updated_by)
  ON coop_payout_runs TO kv_app;
