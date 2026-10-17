-- ==================================================================================================================
-- MIGRATION 0218 — PC-56 STORE-5a · A REVIEW IS A BUYER'S VERDICT ON THE ORGANISATION — KEPT, NEVER EDITED AWAY
-- (canon W290 write a review · W3141–W3144 the edit chain · W3145–W3147 the submit chain · W324 accessibility + W3074–W3076)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0217 are applied; nothing here edits them: 0024's `review_eligibility` and
-- 0005's `reviews` gain nullable columns, seed core/0004's grant rows are changed by a DELETE / INSERT here, not by editing 0004.)
-- NOT MONEY: no ledger table, no posting, no money column. Review eligibility rides the completion HOTFIX-7 fixed (a pay-on-delivery
-- completion settles nothing — `order.settlement_skipped`).
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store5.md F-6 / F-10 / F-12 / B6 / B7 / B8 — verified at 6fc75701, HOTFIX-7):
--   • F-12 THE REVIEW RULES THE CANON STATES WERE ABSENT. Sub-rating keys were free text (`^[a-z_]{1,30}$` — Law 6: the dimensions were
--          nobody's vocabulary); an author could edit for ever (`isEditable` = not removed) and the edit was unaudited; the eligibility row had
--          no expiry, so the "invite open 30 days after delivery" window did not exist.
--   • F-6  THE SELLING ORGANISATION COULD HIDE OR REMOVE ITS BUYERS' REVIEWS. Seed core/0004 granted `review.moderate` to `tenant_admin`
--          (and `ai_ops`), and `canModerateReview` also admitted `listing.moderate` (held by tenant_admin) — "sellers can reply but never edit
--          or remove it" was false for the organisation.
--   • F-10 / C-4 `ReviewPromptsJob` was registered nowhere; `review.prompt` had English templates only; there was no reminder.
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-17, STORE-5a D2 / D3):
--   218.1  THE DIMENSIONS ARE A VOCABULARY (Law 6): `lookup_types` `review_dimension` (not tenant-extendable — the TYPE row first, the 0210
--          lesson: migrations run BEFORE seeds on a database built from empty and `lookup_values.type_code` is an FK) + three platform values
--          quality · freshness · packaging (sort 1–3). Their Hindi and Gujarati names are rows of `translations` (entity_type 'lookup_value',
--          field 'name', human-authored: `is_machine = false`, `source = 'migration:0218'`) — the path `GET /v1/lookups/values?type=` already
--          serves (lookups.service.ts: COALESCE(translation, default_name) under the ADMIN-3b servable rule), so the server's review preview
--          names a dimension in the caller's language. (3a's cancel reasons put their labels in the storefront catalogues instead; a review's
--          dimension label must come back from the SERVER's preview, so this file uses the lookups path — named in the wave report.)
--          The API refuses a sub-rating key outside the active vocabulary: 422 REVIEW_DIMENSION_UNKNOWN.
--   218.2  THE WINDOWS ARE PLATFORM SETTINGS (founder D3): `reviews.edit_window_hours` 168 (an author edits for 7 days after submitting, then
--          the review is locked — 409 REVIEW_LOCKED), `reviews.invite_window_days` 30 (the eligibility is open 30 days after the order completed —
--          409 REVIEW_WINDOW_CLOSED after) and `reviews.reminder_after_days` 7 (the ONE reminder, a week after the ONE invite — a third setting
--          the brief did not list: Law 6 forbids the week as a literal in the job; named in the wave report as a deviation).
--   218.3  `review_eligibility.expires_at timestamptz` (set on insert by the eligibility handlers from 218.2; backfilled here for every existing
--          row as `created_at + invite_window_days`) and `review_eligibility.reminded_at timestamptz` (the reminder's idempotency marker, stamped
--          in the reminder's own transaction); `reviews.edit_locks_at timestamptz` (set at submit = `created_at + edit_window_hours`; backfilled
--          here). A NULL `expires_at` after this file can only be a row written outside the handlers (a test fixture) — the API reads it as an
--          open window; a NULL `edit_locks_at` can only be a row written outside the submit path — the API reads it as LOCKED (fail closed:
--          a review is kept, never edited away). Index for the reminder pass: (expires_at) WHERE reminded_at IS NULL.
--   218.4  THE ORGANISATION RESPONDS AND FLAGS; IT NEVER HIDES OR REMOVES (founder D2): a new permission `review.flag` ("Flag a review for
--          platform review") granted to `tenant_admin` and `support_agent`; `role_permissions` (tenant_admin, review.moderate) and (ai_ops,
--          review.moderate) DELETED (seed core/0004 line 208 granted both; ai_ops is an organisation-scoped role too). After this file the
--          only role in apps/api's realm holding `review.moderate` is `support_agent` — the platform support desk HOTFIX-7 named (hide / remove
--          / restore); `canModerateReview` no longer admits `listing.moderate` (code). Seed core/0004 carries the same list IN THE SAME CHANGE:
--          the seed is ON CONFLICT DO NOTHING, so an existing database needs THIS file and a fresh database needs the edited seed (migrate.js
--          also runs core/0004 inside 0125, long before this file — the edited list grants `review.flag` there and no longer grants
--          `review.moderate` to tenant_admin / ai_ops).
--   218.5  `notification_events` `review.reminder` (informational, ["push","inapp"], opt-out-able, batchable — the `review.prompt` shape)
--          INSERTED WHERE MISSING (the 0215 pattern: migrations run before seeds from empty; seed core/0007 carries the same row, ON CONFLICT
--          DO NOTHING, and its en / hi / gu templates above the "NOTE (TENANT-6d-1)" line, with `review.prompt`'s missing hi / gu).
--   218.6  `GRANT SELECT ON platform_setting_values TO kv_relay`: the eligibility handlers run on the relay's transaction AS kv_relay and read
--          `reviews.invite_window_days` through `kv_platform_setting()` (0194 — SECURITY INVOKER, it reads `platform_setting_values` then
--          `setting_definitions`); 0121 granted the values table to kv_app / kv_readonly only, so the relay could not read a platform setting at
--          all (it already reads `setting_definitions`). The prompt clock (the runner's kv_relay pool) reads `reviews.reminder_after_days` the
--          same way. A read grant on a platform configuration table; no write.
--
-- NOTHING ELSE: no table (the RLS gate's count does not move: 1,955 + the wall), no flag row (`reviews` stays seeded OFF — Law 10), no
-- media column (founder D7: photos refused by name), no column for the responder (the reply is the ORGANISATION's — founder D2: the audit
-- row `review.responded` records who; no read ever serves it).
--
-- RLS / GRANTS DECISION: `review_eligibility` and `reviews` keep their RLS policies; their grants are TABLE-level (kv_app SELECT / INSERT /
-- UPDATE; kv_relay SELECT / INSERT / UPDATE / DELETE — verified on krishalaya_dev: information_schema.role_table_grants), so the new columns
-- inherit them. `lookup_types` / `lookup_values` / `setting_definitions` / `translations` are global registries (no RLS; unchanged grants).
-- Neither table is partitioned.
--
-- REVERSAL (documented, not automatic):
--   REVOKE SELECT ON platform_setting_values FROM kv_relay;          -- the eligibility handlers then fall back to their named constant (logged)
--   DELETE FROM notification_templates WHERE event_code = 'review.reminder'; DELETE FROM notification_events WHERE code = 'review.reminder';
--   DELETE FROM role_permissions WHERE permission_code = 'review.flag'; DELETE FROM permissions WHERE code = 'review.flag';
--   INSERT INTO role_permissions (role_id, permission_code) SELECT r.id, 'review.moderate' FROM roles r WHERE r.code IN ('tenant_admin', 'ai_ops')
--     ON CONFLICT DO NOTHING;   -- …and restore seed core/0004 line 208 (the organisation could then hide / remove its buyers' reviews again)
--   DROP INDEX IF EXISTS idx_review_eligibility_reminder_due;
--   ALTER TABLE reviews DROP COLUMN IF EXISTS edit_locks_at;            -- the code must be reverted first (the repository names the column)
--   ALTER TABLE review_eligibility DROP COLUMN IF EXISTS reminded_at, DROP COLUMN IF EXISTS expires_at;
--   DELETE FROM setting_definitions WHERE key IN ('reviews.edit_window_hours', 'reviews.invite_window_days', 'reviews.reminder_after_days');
--   the three dimension values CANNOT be deleted once a review names one (sub_ratings keeps the code) — deactivate instead:
--   UPDATE lookup_values SET is_active = false WHERE type_code = 'review_dimension';   -- every sub-rating is then refused by name
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 218.1  the review dimensions — a platform vocabulary (the type row FIRST), with their Hindi and Gujarati names
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('review_dimension', 'Review sub-rating dimension', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, '{}'::jsonb, v.sort_order
  FROM (VALUES
    ('review_dimension', 'quality',   'Quality',   1),
    ('review_dimension', 'freshness', 'Freshness', 2),
    ('review_dimension', 'packaging', 'Packaging', 3)
  ) AS v(type_code, code, default_name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO translations (entity_type, entity_id, field, language_code, text, is_machine, source)
SELECT 'lookup_value', lv.id, 'name', v.lang, v.label, false, 'migration:0218'
  FROM (VALUES
    ('quality',   'hi', 'गुणवत्ता'), ('quality',   'gu', 'ગુણવત્તા'),
    ('freshness', 'hi', 'ताज़गी'),   ('freshness', 'gu', 'તાજગી'),
    ('packaging', 'hi', 'पैकिंग'),   ('packaging', 'gu', 'પેકિંગ')
  ) AS v(code, lang, label)
  JOIN lookup_values lv ON lv.type_code = 'review_dimension' AND lv.tenant_id IS NULL AND lv.code = v.code
ON CONFLICT (entity_type, entity_id, field, language_code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 218.2  the windows — platform settings (founder D3)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note) VALUES
  ('reviews.edit_window_hours', 'int', 'platform', 'ordinary', '168'::jsonb,
   'PC-56 STORE-5a (0218, founder D3): hours after a review is submitted during which its author may edit it (stars, sub-ratings, words). '
   'Stamped on the review at submit (reviews.edit_locks_at = created_at + this); after it the API refuses the edit (409 REVIEW_LOCKED). '
   'Seeded 168 (7 days).',
   'Changing it moves the lock of reviews submitted AFTER the change only — a review''s lock instant is stamped when it is written. '
   'Lengthening it lets authors rewrite a verdict sellers have already read; the platform decides it, never an organisation.'),
  ('reviews.invite_window_days', 'int', 'platform', 'ordinary', '30'::jsonb,
   'PC-56 STORE-5a (0218, founder D3): days after an order (or a service booking) completes during which its parties may review each other. '
   'Stamped on the eligibility when it is recorded (review_eligibility.expires_at); after it the API refuses a review (409 REVIEW_WINDOW_CLOSED) '
   'and the invite and the reminder stop. Seeded 30.',
   'Changing it moves the window of eligibilities recorded AFTER the change only. Ratings should reflect fresh memory; the platform decides it.'),
  ('reviews.reminder_after_days', 'int', 'platform', 'ordinary', '7'::jsonb,
   'PC-56 STORE-5a (0218, founder D3 "one invite, one reminder"): days after the review invite (review_eligibility.prompted_at) at which the '
   'review-prompts clock sends the ONE reminder, if no review exists for the order and the window is still open. Seeded 7.',
   'One invite and one reminder, never more: the reminder is stamped (review_eligibility.reminded_at) in the transaction that sends it.')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 218.3  the instants on the rows (+ backfill) and the reminder pass's index
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE review_eligibility ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE review_eligibility ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS edit_locks_at timestamptz;
COMMENT ON COLUMN review_eligibility.expires_at IS
  'PC-56 STORE-5a (0218, founder D3): the end of the review window — the instant the eligibility was recorded (the order or booking completed) '
  '+ reviews.invite_window_days. After it a review is refused (REVIEW_WINDOW_CLOSED) and no invite or reminder is sent. Backfilled by 0218.';
COMMENT ON COLUMN review_eligibility.reminded_at IS
  'PC-56 STORE-5a (0218, founder D3): when the ONE reminder was sent (the review-prompts clock, in the transaction that wrote it); NULL = none yet.';
COMMENT ON COLUMN reviews.edit_locks_at IS
  'PC-56 STORE-5a (0218, founder D3): the instant after which the author can no longer edit this review (created_at + reviews.edit_window_hours, '
  'stamped at submit). NULL is read as locked (fail closed). Backfilled by 0218.';

UPDATE review_eligibility
   SET expires_at = created_at + make_interval(days => COALESCE((kv_platform_setting('reviews.invite_window_days') #>> '{}')::int, 30))
 WHERE expires_at IS NULL;
UPDATE reviews
   SET edit_locks_at = created_at + make_interval(hours => COALESCE((kv_platform_setting('reviews.edit_window_hours') #>> '{}')::int, 168))
 WHERE edit_locks_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_review_eligibility_reminder_due ON review_eligibility (expires_at) WHERE reminded_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 218.4  the organisation responds and flags; the platform desk hides, removes and restores (founder D2)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES ('review.flag', 'Flag a review for platform review', 'M03')
ON CONFLICT (code) DO NOTHING;

DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND r.code IN ('tenant_admin', 'ai_ops')
   AND rp.permission_code = 'review.moderate';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM roles r
  JOIN permissions p ON p.code = 'review.flag'
 WHERE r.code IN ('tenant_admin', 'support_agent')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 218.5  the ONE reminder's catalogue row (where missing — the 0215 pattern; its templates live in seed core/0007 above the NOTE)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('review.reminder', 'Reminder: rate your recent purchase', 'informational', '["push","inapp"]', true, true)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 218.6  the relay reads a platform setting (the eligibility handlers and the prompt clock run as kv_relay)
-- ------------------------------------------------------------------------------------------------------------------
GRANT SELECT ON platform_setting_values TO kv_relay;
