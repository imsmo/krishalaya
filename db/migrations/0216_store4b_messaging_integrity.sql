-- ==================================================================================================================
-- MIGRATION 0216 — PC-56 STORE-4b · MESSAGES TO THE ORGANISATION, NEVER TO A PERSON
-- (canon W297 messages · W298 the thread · W3109–W3111 the message chain (REAL: report) · W3112–W3114 the messages Retry (DECOR))
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0215 are applied; nothing here edits them: this file adds three nullable
-- columns to `messages`, two to `conversations`, one CHECK pair on `conversations`, and backfills the one lock that existed.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store4.md §2 F-13, §3 B16 — verified at 065218ac, STORE-4c):
--   • A REPORTED MESSAGE KEPT ITS BODY. `POST conversations/messages/:id/flag` set `messages.is_flagged` and nothing else: no reason, no
--     reporter, no instant — and every participant still read the body (canon W298 "hidden pending review" was FALSE). The reporter could not
--     be shown to a moderator either, because it was never recorded.
--   • LOCKS WERE NOT MONOTONIC. `conversations.is_locked` was one boolean: whoever opened the thread (`owner`) could lift ANY lock — a
--     moderator's, or (had anything written one) a dispute's. Nothing locked a dispute's thread at all (canon W297/W298 "Resolved threads
--     lock — readable forever, editable never" was FALSE as automatic).
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-17, STORE-4b D2):
--   216.1  D2a/b · `messages` gains `flag_reason_id` (a `report_reason` lookup value — the platform vocabulary of seed core/0005, read by the
--          API, never a literal), `flagged_by` (the reporter — served to a MODERATOR only) and `flagged_at`. `messages` is PARTITIONED by
--          `created_at`: ADD COLUMN on the parent cascades to every partition, and `ensure-partitions` creates future partitions
--          `PARTITION OF messages` (the columns follow). All three are NULL for every existing row (an old flag has no recorded reason);
--          no CHECK is added on the partitioned table (nothing to scan, nothing to lock beyond the catalogue change).
--   216.2  D2c · `conversations` gains `lock_kind` (`owner` · `moderator` · `dispute`) and `locked_at`. The rule that reads them lives in code
--          (apps/api communication/domain/conversation.entity.ts — Law 5): the owner lifts only an `owner` lock; a moderator lifts any;
--          a dispute decision locks the trade's thread with kind `dispute`.
--   216.3  BACKFILL: every row already `is_locked` was locked by its owner or a moderator through the one route that existed, and the route
--          could not tell which — it is recorded as `owner` (the weakest kind: nothing that was liftable becomes unliftable), `locked_at`
--          = its `updated_at` (the last write, which is the lock or later).
--   216.4  SHAPE: `ck_conversations_lock_kind` (the three kinds) and `ck_conversations_lock_shape` (a locked thread HAS a kind and an instant;
--          an open thread has neither) — so no writer can leave a lock with no kind for the owner to lift by default. `conversations` is not
--          partitioned; the CHECKs validate the backfilled rows in this transaction.
--
-- NOTHING ELSE: no table is created (the RLS gate's count does not move: 1,955 + the wall); no grant changes (kv_app and kv_relay hold
-- table-level SELECT/INSERT/UPDATE on both tables, which covers new columns; kv_relay needs UPDATE on `conversations` for the dispute
-- handler and already has it); no flag row is added or flipped (`communication` stays seeded OFF — Law 10); no money moves (Law 9).
-- Seeds: none (the `report_reason` vocabulary — spam · fraud · counterfeit · inappropriate · harassment · prohibited · misinformation ·
-- other — already exists as global rows in seed core/0005).
--
-- REVERSAL (documented, not automatic):
--   ALTER TABLE conversations DROP CONSTRAINT ck_conversations_lock_shape;
--   ALTER TABLE conversations DROP CONSTRAINT ck_conversations_lock_kind;
--   ALTER TABLE conversations DROP COLUMN locked_at, DROP COLUMN lock_kind;      -- every lock becomes liftable by its owner again
--   ALTER TABLE messages DROP COLUMN flagged_at, DROP COLUMN flagged_by, DROP COLUMN flag_reason_id;   -- the reasons and reporters are lost
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 216.1  A REPORT HAS A REASON, A REPORTER AND AN INSTANT (founder D2a/b)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS flag_reason_id uuid NULL REFERENCES lookup_values (id),
  ADD COLUMN IF NOT EXISTS flagged_by     uuid NULL,
  ADD COLUMN IF NOT EXISTS flagged_at     timestamptz NULL;

COMMENT ON COLUMN messages.flag_reason_id IS 'PC-56 STORE-4b (0216): the report_reason lookup value the reporter chose (global vocabulary, seed core/0005). NULL = not reported, or reported before 0216.';
COMMENT ON COLUMN messages.flagged_by     IS 'PC-56 STORE-4b (0216): the reporter. Served to a moderator (message.moderate) ONLY — never to the sender, the organisation or the reporter''s counterpart.';
COMMENT ON COLUMN messages.flagged_at     IS 'PC-56 STORE-4b (0216): when the message was reported. A flagged message is served hidden (no body, no media) to every non-moderator read.';

-- ------------------------------------------------------------------------------------------------------------------
-- 216.2  A LOCK HAS A KIND (founder D2c)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lock_kind varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL;

COMMENT ON COLUMN conversations.lock_kind IS 'PC-56 STORE-4b (0216): who locked the thread — owner (the opener; may lift it) · moderator · dispute (a dispute decision; only a moderator lifts these). NULL while open.';
COMMENT ON COLUMN conversations.locked_at IS 'PC-56 STORE-4b (0216): when the current lock was set. NULL while open.';

-- ------------------------------------------------------------------------------------------------------------------
-- 216.3  BACKFILL — the only lock that existed is recorded as the weakest kind
-- ------------------------------------------------------------------------------------------------------------------
UPDATE conversations SET lock_kind = 'owner', locked_at = COALESCE(locked_at, updated_at)
 WHERE is_locked AND lock_kind IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 216.4  THE SHAPE
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS ck_conversations_lock_kind;
ALTER TABLE conversations ADD CONSTRAINT ck_conversations_lock_kind CHECK (lock_kind IS NULL OR lock_kind IN ('owner', 'moderator', 'dispute'));
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS ck_conversations_lock_shape;
ALTER TABLE conversations ADD CONSTRAINT ck_conversations_lock_shape CHECK (
  (is_locked AND lock_kind IS NOT NULL AND locked_at IS NOT NULL) OR (NOT is_locked AND lock_kind IS NULL AND locked_at IS NULL));
