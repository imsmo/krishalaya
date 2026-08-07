-- ============================================================================
-- MIGRATION 0115 — THE FAIRNESS GATE: A HARD GATE THAT WAS NOT A GATE, AND A FAIRNESS AUDIT
-- THAT MEASURED NO FAIRNESS (PC-56 ADMIN-7)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: `promote()` DOES NOT READ `fairness_audit`. AT ALL.
-- ---------------------------------------------------------------------------
-- `apps/admin-api/src/modules/ai-models-ops/services/model-registry.service.ts` promotes a model like this, in full:
--
--     const model = await this.repo.getForUpdate(client, id);
--     const change = model.promote(dto.to);        // state-machine legality only
--     await this.repo.updateStatus(client, id, change.to, actor.userId);
--     await this.audit.write(client, { ... });
--
-- There is no read of `fairness_audit`, no threshold on any slice gap, and no second operator. So **one person with
-- `ai.model.manage` can put a model into production that has never been audited for district or gender skew** — a model
-- that decides whether a farmer's produce photograph is graded FAQ or B, or whether their listing is flagged as fraud.
--
-- The canon states the rule three times and states it as absolute:
--   W085: "Policy: no model reaches production with >5pp accuracy gap across any protected slice — the audit is a HARD gate"
--   W088: "Full production blocked until the fairness audit passes — no exceptions" · "Fairness (district gap) — HARD gate"
--   W088 restricted: "production promotion additionally requires the fairness audit record"
-- Nothing in the codebase implements any of it. This is the platform's most explicit ethical commitment and it had
-- exactly as much behind it as ADMIN-6's "hash chain intact" — which is to say a sentence in a design file.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: THE ONLY WRITER OF `fairness_audit` IS DEAD CODE, AND WHAT IT WRITES IS NOT A FAIRNESS AUDIT
-- ---------------------------------------------------------------------------
-- `runFairnessAudit` in `apps/api/src/modules/ai-governance/jobs/fairness-audit-monthly.job.ts` is called from
-- nowhere. Neither is `runDriftWatch` beside it. The module header says "SCOPE: … drift-watch / fairness-audit" — a
-- scope statement describing two functions nothing invokes. **So `ai_models.fairness_audit` is NULL for every model on
-- this platform**, and W080's "Fairness audit: passed · 30 May '26" column, W085's audit table and W088's gate all read
-- an empty column. Third empty-store finding in three waves, after `reconciliation_runs` (0113, a broken INSERT whose
-- error was swallowed) and `payout_batches` (0114, a writer nobody scheduled).
--
-- AND THE SHAPE IS WRONG IN A WAY THAT MATTERS MORE THAN THE ABSENCE. Were the job wired, it would write:
--     { window, generatedAt, total, overridden, lowConfidence, overrideRate }
-- **There is not one slice in it.** No district, no gender, no phone tier, no crop, no max gap, no verdict. W081 shows
-- the shape the console expects and W085 states the policy the shape has to support:
--     { audited_at, slices: { district: { max_gap_pp, worst }, phone_tier: {…}, crop: {…} }, verdict: "pass" }
--
-- A rollup of override rates is a USAGE SUMMARY. It cannot answer "does this model grade Kutch farmers worse than
-- Anand farmers", which is the only question a fairness audit exists to answer — and it would have been stored in a
-- column named `fairness_audit`, under a console heading reading "passed". **The claim was not printed over nothing;
-- it was printed over a number that looks like diligence and measures something else.** That is a worse failure than an
-- empty column, because an empty column is visibly empty.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION CREATES A TABLE RATHER THAN CONSTRAINING THE jsonb
-- ---------------------------------------------------------------------------
-- The obvious move is a CHECK on `ai_models.fairness_audit` requiring slices. It is wrong for three reasons.
--   1. AN AUDIT IS AN EVENT, NOT A PROPERTY. A model is audited on a date, by a method, against a slice set, and the
--      history matters: W085 prints "female-voice samples added (was 6.8pp)", which is a comparison between two audits.
--      One jsonb column holds exactly one, so the previous audit is destroyed by the next — the same
--      published-never-edited defect ADMIN-4 found on scheme versions and ADMIN-5b on consent notices, for the third
--      time.
--   2. A GATE MUST POINT AT A ROW. "Production requires the fairness audit record" needs a record with an id that the
--      promotion can name and the audit trail can cite. A gate that reads a mutable column is a gate that passes
--      because of what the column says now.
--   3. THE COLUMN IS ALREADY OCCUPIED BY SOMETHING ELSE'S OUTPUT. Retrofitting a CHECK onto a column whose only
--      (unwired) writer produces a non-conforming shape would make that job fail the day somebody wired it.
-- `ai_models.fairness_audit` is therefore LEFT ALONE as a denormalised convenience, and the console reads it only to
-- report that it is not an audit. See §6.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE AUDIT AS A RECORD
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_fairness_audits (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The model VERSION, not the model code. W085 audits "photo_grading v3.1" and "price_band v2.1 (canary)" separately,
  -- and it must: a retrained model is a different model, and inheriting v3.0's clean audit would be the whole point of
  -- the gate defeated by a version bump.
  model_id        uuid NOT NULL REFERENCES ai_models(id),
  -- Which population the audit looked at, so a reader can tell a 30-day audit from a one-week one and an audit run over
  -- 400 inferences from one run over 400,000. An audit with no denominator is an opinion.
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  sample_size     integer NOT NULL CHECK (sample_size >= 0),
  -- THE SLICES, and this column is the entire point of the table.
  --   { "district": { "maxGapPp": 2.4, "worst": "Kutch", "best": "Anand", "groups": 12, "smallestGroup": 214 }, … }
  -- `maxGapPp` is percentage POINTS of accuracy difference between the best and worst group in that slice, which is what
  -- W085's "<5pp" policy is stated in. Not a ratio: a ratio between two accuracies near 90% compresses exactly the
  -- differences that matter.
  slices          jsonb NOT NULL,
  -- The worst gap across every slice, PROJECTED OUT of the jsonb so the gate is an indexable numeric comparison rather
  -- than a jsonb walk. Denormalised deliberately, and `ck_afa_gap_agrees` below is what stops it drifting from `slices`.
  max_gap_pp      numeric(6,2) NOT NULL CHECK (max_gap_pp >= 0),
  -- pass | fail | inconclusive. `inconclusive` is its own verdict and the most important one to have: a slice whose
  -- smallest group is 11 farmers produces a gap figure that is noise, and reporting that as `pass` is how a fairness
  -- programme becomes a formality. W085 shows "in review" for the canary and the honest reading of thin data is not
  -- "passed".
  verdict         varchar(20) NOT NULL,
  -- Why, in words, for the verdict a machine cannot justify. Required on anything that is not a clean pass.
  verdict_note    text,
  -- The method, so an audit is reproducible: which eval set, which labels, which accuracy definition.
  method          jsonb NOT NULL DEFAULT '{}',
  -- WHO. Bare uuid, no FK — a platform operator has no `users` row. Realm-identity for the SIXTH time (ADMIN-2d's
  -- support reply, the ticket ATTACH, 0067's checker columns, 0112's `handled_by_admin_id`, 0114's approval columns,
  -- now this). NULL when the audit was produced by the scheduled job rather than a person, which is the ordinary case
  -- and is distinguishable on purpose.
  audited_by_admin_id uuid,
  -- The DPO's sign-off on the SLICE DEFINITIONS, which is a separate act from the audit. W085's restricted state says
  -- "slice definitions are reviewed by the DPO (protected attributes)" — because deciding to measure accuracy by gender
  -- means processing gender, and an audit that quietly invents its own protected attributes is a privacy decision made
  -- by an engineer.
  slices_approved_by_admin_id uuid,
  slices_approved_at timestamptz
);
CALL add_std_columns('ai_fairness_audits');

ALTER TABLE ai_fairness_audits
  ADD CONSTRAINT ck_afa_verdict CHECK (verdict IN ('pass', 'fail', 'inconclusive'));
ALTER TABLE ai_fairness_audits
  ADD CONSTRAINT ck_afa_window CHECK (window_end > window_start);
-- A NON-PASS OWES A SENTENCE. The gate refuses production on anything but a pass, so the note is the only thing that
-- tells the next person what to fix — and "fail" with no reason is a dead end for whoever inherits it.
ALTER TABLE ai_fairness_audits
  ADD CONSTRAINT ck_afa_note CHECK (
    verdict = 'pass' OR char_length(btrim(coalesce(verdict_note, ''))) >= 20);
-- THE DENORMALISED GAP MUST BE PRESENT IN THE SLICES IT SUMMARISES. Not a full recomputation — Postgres should not be
-- asked to reduce a jsonb tree in a CHECK — but a shape assertion: `slices` must be a non-empty object. An audit with
-- `slices = '{}'` and `max_gap_pp = 0` would otherwise be a passing audit that measured nothing, which is exactly the
-- artefact the unwired job would have produced.
ALTER TABLE ai_fairness_audits
  ADD CONSTRAINT ck_afa_slices_present CHECK (
    jsonb_typeof(slices) = 'object' AND slices <> '{}'::jsonb);
-- A DPO approval names a person and a time together or neither.
ALTER TABLE ai_fairness_audits
  ADD CONSTRAINT ck_afa_slices_approval CHECK (
    (slices_approved_by_admin_id IS NULL AND slices_approved_at IS NULL)
    OR (slices_approved_by_admin_id IS NOT NULL AND slices_approved_at IS NOT NULL));

-- The gate's read: the newest audit for a model.
CREATE INDEX IF NOT EXISTS idx_afa_model_recent ON ai_fairness_audits (model_id, created_at DESC, id DESC);
-- W085's board: every model's latest verdict, worst first.
CREATE INDEX IF NOT EXISTS idx_afa_recent ON ai_fairness_audits (created_at DESC, id DESC);

-- APPEND-ONLY, and this is the published-never-edited rule for the third time on this platform. An audit that can be
-- edited after a promotion cites it is not evidence. A wrong audit is superseded by a new one; the wrong one stays,
-- because "we audited this and got it wrong" is itself the finding.
REVOKE UPDATE, DELETE ON ai_fairness_audits FROM PUBLIC;
REVOKE ALL ON ai_fairness_audits FROM kv_app;
GRANT SELECT, INSERT ON ai_fairness_audits TO kv_admin;
GRANT SELECT, INSERT ON ai_fairness_audits TO kv_relay;
GRANT SELECT ON ai_fairness_audits TO kv_readonly;
-- The DPO's slice sign-off is the ONLY UPDATE this table permits, and only kv_admin may perform it. Expressed as a
-- grant rather than a trigger because the columns it may touch are enforced in the service and the audit row records
-- it; a trigger asserting column-level immutability here would be the stronger design and is named as ADMIN-7-Q1.
GRANT UPDATE (slices_approved_by_admin_id, slices_approved_at, updated_at, updated_by) ON ai_fairness_audits TO kv_admin;

-- Cross-tenant by nature: `ai_models` is a GLOBAL registry and an audit spans every tenant's inferences. No tenant_id,
-- no RLS policy — same reasoning as `reconciliation_runs`, `ledger_chain_verifications` (0113) and `settlement_runs`
-- (0114). Stated because 0020 once claimed RLS on a table that had none and the correction cost a wave's detour.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_fairness_audits' AND rowsecurity) THEN
    RAISE NOTICE 'ai_fairness_audits has RLS enabled; it is a cross-tenant global table and should not';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2 · THE GATE, AND THE PROMOTION AS AN APPROVAL OBJECT
-- ---------------------------------------------------------------------------
-- W080: "Status transitions need `ai.deploy` + checker." W088: "Promote to 50% canary — needs checker · Maker: AI Ops
-- (DV)". Neither existed: `promote()` is one operator and one UPDATE.
--
-- ELEVENTH MAKER-CHECKER SITE. Same realm-identity shape as the previous five: bare uuid actor columns, no FK.
ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS proposed_status        varchar(20),
  ADD COLUMN IF NOT EXISTS proposed_by_admin_id   uuid,
  ADD COLUMN IF NOT EXISTS proposed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS proposal_reason        text,
  -- The audit the promotion was granted against, BY ID. This is what makes the gate citable: after the fact, "why is
  -- this model in production" is answerable with a row rather than with a column's current value.
  ADD COLUMN IF NOT EXISTS promoted_on_audit_id   uuid REFERENCES ai_fairness_audits(id),
  ADD COLUMN IF NOT EXISTS promoted_by_admin_id   uuid,
  ADD COLUMN IF NOT EXISTS promoted_at            timestamptz,
  -- Canary traffic share, which W088 steps 10% → 50% → production. It has never existed, so the "canary 10%" on four
  -- screens was a number in a mockup: nothing stored a split and nothing read one.
  ADD COLUMN IF NOT EXISTS canary_percent         smallint,
  -- W088's auto-rollback: "if canary MAPE exceeds 8% or override rate exceeds 10% over any 6h window, traffic snaps
  -- back to v2.0 automatically and the AI Ops officer is paged. Rollbacks are recorded, never silent."
  ADD COLUMN IF NOT EXISTS rollback_of_model_id   uuid REFERENCES ai_models(id),
  ADD COLUMN IF NOT EXISTS rolled_back_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rollback_reason        text;

-- THE STATUS CHECK `ai_models` NEVER HAD. `status` is a bare varchar(20) defaulting to 'shadow' with a comment listing
-- four values — the third table in three waves in that condition (`reconciliation_runs`, `payout_batches`, this).
-- Not NOT VALID: this table has real rows written by the existing registry service, whose state machine has always
-- produced exactly these four, so validating is safe and a NOT VALID constraint over data we can reason about would be
-- weaker for no reason.
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_model_status;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_model_status CHECK (status IN ('shadow', 'canary', 'production', 'retired'));

ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_model_proposed_status;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_model_proposed_status CHECK (
    proposed_status IS NULL OR proposed_status IN ('shadow', 'canary', 'production', 'retired'));

-- ELEVENTH MAKER-CHECKER SITE. Shape from `makerNeCheckerConstraint`; both NULL escapes load-bearing (every existing
-- model row has NULL in both, and a constraint without them fails this migration on lawful data).
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_models_maker_ne_checker;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_models_maker_ne_checker CHECK (
    promoted_by_admin_id IS NULL OR proposed_by_admin_id IS NULL OR promoted_by_admin_id <> proposed_by_admin_id);

-- **THE GATE, AS A DATABASE FACT.** A model in production must name the audit it was promoted on.
--
-- NOT VALID, and this one is NOT VALID for a reason that matters rather than out of caution: **there may already be
-- models in production with no audit**, and that is precisely the defect. Validating would abort the migration and the
-- honest sequence is to land the constraint (binding every future promotion immediately), then let the console SHOW the
-- existing violations, then audit those models, then VALIDATE. A migration that refused to apply until the data was
-- clean would leave the gate unbuilt for as long as the backlog took.
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_model_production_needs_audit;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_model_production_needs_audit CHECK (
    status <> 'production' OR promoted_on_audit_id IS NOT NULL) NOT VALID;

-- A canary share only means something on a canary, and a canary without one is a traffic split nobody set.
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_model_canary_percent;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_model_canary_percent CHECK (
    (status = 'canary' AND canary_percent IS NOT NULL AND canary_percent BETWEEN 1 AND 100)
    OR (status <> 'canary')) NOT VALID;

-- A rollback names what it rolled back to, and when.
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ck_ai_model_rollback;
ALTER TABLE ai_models
  ADD CONSTRAINT ck_ai_model_rollback CHECK (
    (rolled_back_at IS NULL AND rollback_of_model_id IS NULL)
    OR (rolled_back_at IS NOT NULL AND rollback_of_model_id IS NOT NULL
        AND char_length(btrim(coalesce(rollback_reason, ''))) >= 10)) NOT VALID;

-- W080's registry list is filtered by status and W079's overview counts production models; `idx_ai_models_code_status`
-- (0029) serves the first. This serves the awaiting-checker strip.
CREATE INDEX IF NOT EXISTS idx_ai_models_proposed ON ai_models (proposed_at)
  WHERE proposed_status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3 · THE REVIEW QUEUE ACROSS THE REALM BOUNDARY
-- ---------------------------------------------------------------------------
-- W082 and W083 are a PLATFORM AI Ops officer working cases across every tenant — `platform_ai_ops` is an owner-realm
-- role, and `ai_review_queue` is tenant-scoped with RLS. So this is a god-mode read (Law 11) and a god-mode write.
--
-- **AND THE OPERATOR CANNOT BE RECORDED AS THE REVIEWER.** `ai_review_queue.reviewer_user_id` is
-- `uuid REFERENCES users(id)` — the farmer table — and admin-api authenticates from a self-contained JWT with no
-- database identity. SIXTH occurrence of this exact finding, and ADMIN-2d's three wrong fixes are still the three wrong
-- fixes: invent a platform account inside every tenant's user table (the cross-tenant identity the two-realm split
-- exists to prevent); record the tenant's own reviewer instead (a forgery); or drop the FK (which stops the tenant
-- column meaning what it means, and a tenant's own AI Ops officer reviewing their own cases is a real and separate act).
--
-- Same answer as 0112: a SECOND column, plus a constraint that a resolved case names exactly one reviewer.
ALTER TABLE ai_review_queue
  ADD COLUMN IF NOT EXISTS reviewer_admin_id uuid,
  -- W083: "Another reviewer holds this case (in_review) — cases are single-owner to avoid conflicting decisions." The
  -- claim needs a claim TIME, or a case claimed by somebody who then closed their laptop is held for ever.
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE ai_review_queue
  DROP CONSTRAINT IF EXISTS ck_ai_review_one_reviewer;
ALTER TABLE ai_review_queue
  ADD CONSTRAINT ck_ai_review_one_reviewer CHECK (
    status NOT IN ('accepted', 'rejected')
    OR (reviewer_user_id IS NOT NULL) <> (reviewer_admin_id IS NOT NULL)) NOT VALID;

-- The status and kind vocabularies, both comment-only until now. `drift` is included because `drift-watch.job.ts`
-- inserts it (and is itself dead code — ADMIN-7-Q2), so a CHECK omitting it would break that job the day it is wired.
ALTER TABLE ai_review_queue
  DROP CONSTRAINT IF EXISTS ck_ai_review_status;
ALTER TABLE ai_review_queue
  ADD CONSTRAINT ck_ai_review_status CHECK (
    status IN ('pending', 'in_review', 'accepted', 'rejected')) NOT VALID;
ALTER TABLE ai_review_queue
  DROP CONSTRAINT IF EXISTS ck_ai_review_kind;
ALTER TABLE ai_review_queue
  ADD CONSTRAINT ck_ai_review_kind CHECK (
    queue_kind IN ('fraud_flag', 'low_confidence_grade', 'price_anomaly', 'dispute_triage', 'drift')) NOT VALID;

-- A DECISION OWES THE MODEL A REASON, and here the reason is not courtesy — W083 says the note "teaches the model" and
-- W085's whole override analysis is built from these notes ("commodity price spikes read as manipulation"). A resolved
-- case with an empty note is a training signal thrown away.
ALTER TABLE ai_review_queue
  DROP CONSTRAINT IF EXISTS ck_ai_review_decision_note;
ALTER TABLE ai_review_queue
  ADD CONSTRAINT ck_ai_review_decision_note CHECK (
    status NOT IN ('accepted', 'rejected')
    OR char_length(btrim(coalesce(decision_note, ''))) >= 20) NOT VALID;

-- W082's queue is ordered by priority then age, ACROSS TENANTS for a platform reviewer. `idx_ai_queue_claim` (0029)
-- leads with `tenant_id`, so it cannot serve a cross-tenant scan. This one can.
CREATE INDEX IF NOT EXISTS idx_ai_queue_platform ON ai_review_queue (priority, created_at, id)
  WHERE status IN ('pending', 'in_review');

-- ---------------------------------------------------------------------------
-- 4 · GRANTS FOR THE GOD-MODE REALM
-- ---------------------------------------------------------------------------
-- The 0014/0018 `ALTER DEFAULT PRIVILEGES` trap: a new table is granted to roles nobody named, so every grant and
-- revoke here is explicit.
--
-- 0067's finding in miniature, and the reason to check it every time: a table built for an operator who has no grant on
-- it. kv_admin must now write the promotion columns and the review queue's admin-side reviewer.
GRANT SELECT, INSERT, UPDATE ON ai_models TO kv_admin;
GRANT SELECT, UPDATE ON ai_review_queue TO kv_admin;
-- INSERT is deliberately NOT granted on the review queue: cases are created by the inference path and by the drift
-- watcher, both of which run in apps/api. A god-mode realm that could manufacture a review case could manufacture the
-- evidence that a model was reviewed.
REVOKE INSERT, DELETE ON ai_review_queue FROM kv_admin;
-- W084's decision explorer reads the inference audit log across every tenant. SELECT only — `ai_inferences` is
-- append-only (0014 revokes UPDATE and DELETE from every app role) and this realm has no business being the exception.
GRANT SELECT ON ai_inferences TO kv_admin;
REVOKE INSERT, UPDATE, DELETE ON ai_inferences FROM kv_admin;

-- ---------------------------------------------------------------------------
-- 5 · PARTITIONS
-- ---------------------------------------------------------------------------
-- `ai_inferences` is `PARTITION BY RANGE (created_at)` and W084 reads it. `ensure_partitions()` (0014, made SECURITY
-- DEFINER by 0053) discovers partitioned tables dynamically, so this is a no-op if they exist and a repair if they do
-- not — the 0069 precedent, which also documents that the call must precede any RLS DO block in the same file.
CALL ensure_partitions(3);

-- ---------------------------------------------------------------------------
-- 6 · WHAT IS DELIBERATELY NOT DONE
-- ---------------------------------------------------------------------------
-- NO CHECK ON `ai_models.fairness_audit`, and no backfill of it from the new table. It stays a denormalised
-- convenience whose only (unwired) writer produces a shape containing no slices, and the console reads it ONLY to
-- report that what it contains is not a fairness audit. Constraining it would break that job the day somebody wires it;
-- backfilling from `ai_fairness_audits` would put a second copy of the gate's evidence somewhere editable. The column's
-- retirement belongs with the job's rewrite (ADMIN-7-Q2).
--
-- NO `ai_tenant_quotas` TABLE (W086). The canon itself carries the banner "Backend pending (DELTA-019): ai_tenant_quotas
-- table (PRD 3-tier cost model: edge/platform/cloud) — enforcement today via plan_limits. Design leads." A three-tier
-- metered cost model with graceful-degradation semantics is a billing object, and inventing its shape inside a
-- governance wave — with the canon explicitly saying the design is not settled — would be exactly the guess that
-- becomes permanent. Recorded as GAP-BACKEND with the canon's own owner.
--
-- NO VERSIONED PROMPT STORE (W087). Same: "Backend pending (DELTA-020): versioned prompt/config store — today only
-- confidence_threshold lives on ai_models; prompts ship with service releases. Design leads." The threshold half of
-- that screen IS built, because the threshold does live on `ai_models` and its review-load impact is computable.
--
-- THE NOT VALID CONSTRAINTS: `ck_ai_model_production_needs_audit` (there may be unaudited models in production, which
-- is the defect), `ck_ai_model_canary_percent` and `ck_ai_model_rollback` (columns new, so NULL everywhere, but the
-- canary one would reject an existing canary row that predates the column), and the four on `ai_review_queue` (real
-- rows, unknown distinct values). VALIDATE belongs in a later migration run against real data — the standing debt item,
-- now covering 0110–0115.
