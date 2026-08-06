-- ============================================================================
-- MIGRATION 0103 — THE TRANSLATIONS PLANE: REVIEW STATE + LANGUAGE-SCOPED REVIEWERS
-- (PC-56 ADMIN-3b, closes ADMIN-3-Q1's schema half)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- `translations` HAS EXISTED SINCE 0001 AND NOTHING HAS EVER WRITTEN TO IT. Not "rarely": `grep "INSERT INTO
-- translations"` across apps/ and db/ returns nothing at all. Meanwhile apps/api's lookups module LEFT JOINs it for
-- lookup values and regions and COALESCEs onto `default_name`, so that read path has always silently returned the
-- English canonical name. Golden Law 6 — "never hardcoded, names localize via translations" — is half-wired and
-- completely unfed. A Gujarati farmer sees "Wheat", not "ઘઉં", for every category and attribute in the product.
--
-- BEFORE ANY WRITE PATH CAN EXIST, TWO THINGS IN THE READ PATH HAVE TO BE TRUE, AND NEITHER IS:
--
--   1. THE CANON'S RULE (W028): "Machine translations (is_machine) require human review before farmer-facing surfaces
--      show them." The read path does NOT filter `is_machine`. So the moment anything inserts a machine translation,
--      unreviewed AI text is shown to farmers immediately — the rule broken on day one by the very feature meant to
--      honour it. This is why ADMIN-3b starts here rather than with a console screen.
--   2. A SOFT-DELETED TRANSLATION IS STILL SERVED. The read path does not filter `deleted_at` either, so revoking a bad
--      translation would not revoke it. A separate, smaller bug in the same three lines of SQL.
--
-- This migration gives the table the state it needs for a reviewed/unreviewed distinction to be expressible and
-- INDEXED; the read-path predicate itself is fixed in apps/api (one place, three queries) because SQL in a service is
-- not something a migration can reach.
--
-- WHAT THIS TABLE IS NOT GAINING: a `status` enum. `is_machine` + `reviewed_at` already express every state that
-- matters — a human-authored row needs no review and is live on insert; a machine row is a DRAFT until somebody with the
-- right language accepts it. A third column would be a second source of truth for the same question.
-- ============================================================================

-- ---------- 1. THE REVIEW RECORD ----------
-- `reviewed_by` exists (0001) as a bare uuid with NO foreign key and NO timestamp beside it. So "who accepted this
-- translation, and when" has been half-recordable and never recorded.
--
-- NO FK IS ADDED ON reviewed_by, deliberately: the reviewer is an ADMIN-realm identity and `users` is the tenant realm's
-- table. Pointing this column at `users` would assert that a platform reviewer is a tenant user, which is the same
-- cross-realm identity confusion ADMIN-2d refused for support replies. It stays an opaque uuid, as `catalogue_changes
-- .actor_user_id` and every other admin-authored column in this schema does.
ALTER TABLE translations ADD COLUMN reviewed_at timestamptz;
COMMENT ON COLUMN translations.reviewed_by IS
  'The ADMIN-realm reviewer who accepted this translation. Deliberately no FK: admin identities do not live in the tenant realm''s users table (same reasoning as catalogue_changes.actor_user_id).';
COMMENT ON COLUMN translations.reviewed_at IS
  'When the translation was accepted. Added by 0103. A machine translation with reviewed_at IS NULL is a DRAFT and must not reach a farmer-facing surface.';

-- The reviewer's own words, when they changed the text rather than simply accepting it. Nullable: accepting a good
-- machine translation unchanged is the common case and forcing a note would produce a column full of "ok".
ALTER TABLE translations ADD COLUMN review_note text;

-- WHO PROPOSED IT. A machine translation names its engine ('ai4bharat', 'indictrans2'); a human one names nothing,
-- because the row's author is already in `created_by`. The canon's W028 shows a "Suggested by" column and this is it.
ALTER TABLE translations ADD COLUMN source varchar(40);
ALTER TABLE translations ADD CONSTRAINT ck_translation_machine_source CHECK (
  -- a machine translation must say which engine produced it: "the AI said so" is not a provenance
  (is_machine = false) OR (source IS NOT NULL AND length(btrim(source)) >= 2)
);

-- A REVIEWED ROW HAS A REVIEWER AND A TIME, OR NEITHER. Half a review record is worse than none: it would read as
-- reviewed to any query that checked only one of the two columns.
ALTER TABLE translations ADD CONSTRAINT ck_translation_review_pair CHECK (
  (reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
);

-- ---------- 2. THE INDEXES THE READ AND THE QUEUE BOTH NEED ----------
-- THE SERVING INDEX. This is the exact shape the fixed read predicate uses, and its WHERE clause encodes the rule:
-- a row is servable when it is human-authored, or machine-authored AND reviewed.
CREATE INDEX idx_translation_servable ON translations (entity_type, entity_id, field, language_code)
  WHERE deleted_at IS NULL AND (is_machine = false OR reviewed_at IS NOT NULL);

-- THE REVIEW QUEUE. Machine rows awaiting a human, oldest first — a translation nobody has looked at for three weeks is
-- the queue quietly failing, and the oldest-first order is what makes that visible rather than buried.
CREATE INDEX idx_translation_review_queue ON translations (language_code, created_at)
  WHERE is_machine AND reviewed_at IS NULL AND deleted_at IS NULL;

-- COVERAGE. W028's matrix counts keys per (entity_type, language) and it is the one read that scans broadly.
CREATE INDEX idx_translation_coverage ON translations (entity_type, language_code)
  WHERE deleted_at IS NULL;

-- ---------- 3. LANGUAGE-SCOPED REVIEWERS ----------
-- The canon states the rule plainly on W028: "Approving needs `translations.review` per language (reviewers are
-- language-scoped)."
--
-- WHY THIS IS A TABLE AND NOT A PERMISSION. `OwnerPermissions` is a fixed enum of strings and a role is a fixed list of
-- them; neither can carry "…but only for Gujarati". A permission per language would mean fourteen enum members today and
-- an enum change every time a language is added — and the language list is DATA (0001's `languages` table), so its
-- authority has to be data too. `translations.review` therefore grants the ABILITY to review, and this table decides
-- WHICH LANGUAGES. Both are required; neither is sufficient.
--
-- AND THE REASON THE RULE MATTERS: a reviewer who cannot read Tamil cannot tell a correct Tamil translation from a
-- fluent-sounding wrong one. Approving is not a clerical act — it is a claim that the text says what the English says,
-- to a farmer who will act on it.
CREATE TABLE translation_reviewers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- an ADMIN-realm identity, opaque here for the same reason reviewed_by is
  admin_user_id     uuid NOT NULL,
  language_code     varchar(8) NOT NULL REFERENCES languages(code),
  -- who granted the scope, so the grant itself is attributable
  granted_by        uuid NOT NULL,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  -- revoked rather than deleted: a translation approved last year was approved by somebody who held the scope THEN, and
  -- deleting the grant would make that approval unexplainable
  revoked_at        timestamptz,
  revoked_by        uuid,
  note              text
);
CALL add_std_columns('translation_reviewers');

-- One LIVE grant per (reviewer, language). A revoked grant may be re-issued, which is why the index is partial rather
-- than a plain UNIQUE — history accumulates, authority does not.
CREATE UNIQUE INDEX uq_translation_reviewer_live ON translation_reviewers (admin_user_id, language_code)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_translation_reviewer_lang ON translation_reviewers (language_code)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;
ALTER TABLE translation_reviewers ADD CONSTRAINT ck_translation_reviewer_revocation CHECK (
  (revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
);

-- ---------- 4. THE MACHINE-TRANSLATION RUN LEDGER ----------
-- W028's "Machine-translate gaps" button fans out over thousands of keys. Without a record of the run, a second click
-- while the first is still working would double the queue, and "why are there 3,218 pending?" would be unanswerable.
--
-- NO PROVIDER EXISTS. There is no translation engine wired into this platform — the same honest gap as the email, voice
-- and pager providers (ADMIN-1e, ADMIN-2b, ADMIN-2d). So a run is RECORDED and lands `provider_pending`, and the console
-- says so rather than showing a progress bar for work nothing can perform. When an engine is wired, only the execution
-- leg changes; the ledger, the queue and the review flow all stay.
CREATE TYPE translation_run_status AS ENUM ('queued', 'provider_pending', 'completed', 'failed');

CREATE TABLE translation_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  requested_by    uuid NOT NULL,
  -- what was asked for: which entity kinds, which target languages
  entity_types    varchar(60)[] NOT NULL,
  language_codes  varchar(8)[] NOT NULL,
  -- how many gaps the request covered AT REQUEST TIME. Recorded because the number moves: a run that says "filled 40 of
  -- 3,218" is only meaningful against the count it started from.
  gap_count       integer NOT NULL CHECK (gap_count >= 0),
  status          translation_run_status NOT NULL DEFAULT 'queued',
  -- how many rows the run actually produced. NULL until it has run — never 0, which would read as "tried and produced
  -- nothing" (unknown ≠ zero, the standing rule).
  produced_count  integer CHECK (produced_count IS NULL OR produced_count >= 0),
  detail          text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  reason          text NOT NULL
);
CALL add_std_columns('translation_runs');
CREATE INDEX idx_translation_run_recent ON translation_runs (requested_at DESC);
CREATE INDEX idx_translation_run_open ON translation_runs (requested_at)
  WHERE status IN ('queued', 'provider_pending') AND deleted_at IS NULL;
-- anything that did not complete must explain itself
ALTER TABLE translation_runs ADD CONSTRAINT ck_translation_run_detail CHECK (
  status IN ('queued', 'completed') OR length(btrim(COALESCE(detail, ''))) >= 3
);
ALTER TABLE translation_runs ADD CONSTRAINT ck_translation_run_settled CHECK (
  (status = 'queued' AND settled_at IS NULL) OR (status <> 'queued' AND settled_at IS NOT NULL)
);

-- ---------- 5. THE AUDIT VOCABULARY ----------
-- 0102 widened `catalogue_changes` for the EAV plane; translations need their own kinds for the same reason — a
-- translation edit is a change to what a farmer reads, and it was previously impossible to record.
ALTER TABLE catalogue_changes DROP CONSTRAINT IF EXISTS catalogue_changes_entity_type_check;
ALTER TABLE catalogue_changes ADD CONSTRAINT catalogue_changes_entity_type_check CHECK (entity_type IN (
  'lookup_type', 'lookup_value', 'category',
  'attribute', 'attribute_option', 'category_attribute', 'unit', 'unit_conversion',   -- 0102
  'translation',            -- the text itself
  'translation_reviewer',   -- who may approve which language
  'translation_run'         -- a machine-translation fan-out
));
ALTER TABLE catalogue_changes DROP CONSTRAINT IF EXISTS catalogue_changes_action_check;
ALTER TABLE catalogue_changes ADD CONSTRAINT catalogue_changes_action_check CHECK (action IN (
  'created', 'updated', 'activated', 'deactivated', 'moved', 'renamed', 'bound', 'unbound',
  -- a translation is APPROVED or REJECTED, not "activated": the words matter in a ledger somebody reads under pressure
  'approved', 'rejected', 'granted', 'revoked', 'requested'
));

-- ---------- 6. grants (the 0014/0018 default-privileges trap) --------------------------------------
-- TRANSLATIONS: the tenant API READS them (that is the whole point) and must never write them — a tenant editing the
-- platform's Hindi name for "Wheat" would change it for every other tenant. Only the admin realm authors.
REVOKE INSERT, UPDATE, DELETE ON translations FROM kv_app, kv_relay;
GRANT SELECT ON translations TO kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT, UPDATE ON translations TO kv_admin;
-- No DELETE for anybody: a translation a farmer has already read is soft-deleted, never removed.

-- REVIEWERS + RUNS: platform-only. The tenant role is granted nothing at all — who may approve Gujarati is not a
-- tenant's business, and a table the tenant role cannot touch is a stronger statement than a policy it could forget.
REVOKE ALL ON translation_reviewers, translation_runs FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON translation_reviewers, translation_runs TO kv_admin;
GRANT SELECT ON translation_reviewers, translation_runs TO kv_readonly;
-- the run executor will need to settle rows when an engine exists; kv_relay gets UPDATE then, not speculatively now
