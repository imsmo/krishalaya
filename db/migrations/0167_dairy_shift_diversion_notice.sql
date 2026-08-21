-- ==================================================================================================================
-- 0167 · PC-56 TENANT-6d-8 · THE NOTICE — W170's *"route notice to 87 pourers, Gujarati voice"*
-- ==================================================================================================================
--
-- W170's playbook step 2 reads, in full:
--
--     *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*
--
-- TENANT-6d-6 built the diversion and catalogued this event, and said so in its own migration: *"It does not tell the
-- members."* TENANT-6d-7 then found that the machinery which would have told them could not: every fan-out resolved to
-- English because `users.language_code` had never been read, and fifteen declared template variables rendered as the
-- empty string. Both are fixed. **So this migration is the last mile: the retraction, the notice's own state on the
-- row, the flag, and the index that lets a screen answer "who was told".**
--
-- WHAT IS ALREADY DONE AND IS NOT REPEATED HERE:
--   • `dairy.shift_diverted` is catalogued by 0166 — priority `critical`, `user_can_opt_out = false`,
--     `default_channels = ["ivr","sms","push"]`, `batchable = false`. A member who is not told that tonight's
--     collection has moved village carries their milk to a locked door.
--   • The per-recipient language, the per-language payload value and the variable guard are TENANT-6d-7 (no DDL).
--
-- ------------------------------------------------------------------------------------------------------------------
-- 167.1  THE RETRACTION — the notice this wave adds, and the reason it is not optional
-- ------------------------------------------------------------------------------------------------------------------
-- A signed diversion can be CALLED OFF while no milk has been taken under it (6d-6's `cancelVerdict`), and until now
-- that was a silent state change. Telling 87 families to carry their evening milk to Bhesan and then not telling them
-- it is back at Vanthali is the same promise broken twice: the first message caused the walk, and the silence causes
-- the wasted one. It is catalogued exactly like the diversion itself — `critical`, unmutable, voice channel FIRST —
-- because the people who need it most are the ones without a smartphone, and because a retraction that arrives after
-- the walk is worth nothing.
--
-- SEPARATE EVENT, NOT A FIELD ON THE FIRST. The copy is different in kind ("go to Bhesan tonight" versus "stay at
-- Vanthali after all"), the templates are per-event, and a cooperative reading its own notification history must be
-- able to count the diversions that were called off. 0166's argument for its own event code, applied again.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('dairy.shift_diversion_cancelled', 'Collection is back at your own centre', 'critical',
        '["ivr","sms","push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 167.2  THE IN-APP LEG, ADDED TO BOTH
-- ------------------------------------------------------------------------------------------------------------------
-- 0166 gave the diversion notice voice, SMS and push. `inapp` is added to both events for one reason: it is the only
-- channel that leaves something a member can RE-READ standing at a collection counter at half past five, with the
-- centre's name in front of them. It costs no send (the inbox row IS the delivery — see `NotificationService.deliver`),
-- it needs no address, and it is never suppressed by quiet hours.
--
-- The ORDER is unchanged where it matters: `ivr` stays first because that is the canon's own word (*"Gujarati voice"*)
-- and because the routine-fan-out policy reads `default_channels` order as the primary channel for routine tiers — a
-- `critical` event passes through that policy untouched, but the ordering is a statement about intent either way.
UPDATE notification_events
   SET default_channels = '["ivr","sms","push","inapp"]'
 WHERE code = 'dairy.shift_diverted' AND default_channels = '["ivr","sms","push"]';

-- ------------------------------------------------------------------------------------------------------------------
-- 167.3  WHAT THE ROW HAS TO REMEMBER ABOUT THE TELLING
-- ------------------------------------------------------------------------------------------------------------------
-- **QUEUED, NEVER "SENT".** These columns record that this platform HANDED THE NOTICE OVER — the outbox row was
-- written inside the same transaction as the signature (Law 4) — and the count of members it was handed over FOR. They
-- do not claim delivery: delivery is per person per channel and lives in `notifications`, which the delivery report
-- reads (167.4). A column called `notified_at` would have been a lie about a phone somebody left at home.
--
-- WHY THE COUNT IS STORED AT ALL, when it could be re-derived: because the recipient set is *"the members routed to
-- this centre AS OF THE DIVERTED DAY"*, and route history keeps changing after the fact. Re-deriving it a week later
-- answers a different question from the one that was asked. The number told is a fact about the past; 87 is not a
-- query, it is a receipt.
ALTER TABLE dairy_shift_diversions
  ADD COLUMN IF NOT EXISTS notice_queued_at      timestamptz,
  ADD COLUMN IF NOT EXISTS notice_recipients     integer,
  ADD COLUMN IF NOT EXISTS retraction_queued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS retraction_recipients integer;

-- Both ends or neither, the same shape 0166 used for its two signatures: a queued-at with no count (or a count with no
-- instant) is a receipt nobody can read.
ALTER TABLE dairy_shift_diversions
  DROP CONSTRAINT IF EXISTS ck_dairy_diversion_notice_pair;
ALTER TABLE dairy_shift_diversions
  ADD CONSTRAINT ck_dairy_diversion_notice_pair
  CHECK ((notice_queued_at IS NULL) = (notice_recipients IS NULL));
ALTER TABLE dairy_shift_diversions
  DROP CONSTRAINT IF EXISTS ck_dairy_diversion_retraction_pair;
ALTER TABLE dairy_shift_diversions
  ADD CONSTRAINT ck_dairy_diversion_retraction_pair
  CHECK ((retraction_queued_at IS NULL) = (retraction_recipients IS NULL));

-- A RETRACTION WITHOUT A NOTICE IS A MESSAGE ABOUT NOTHING. If nobody was told to move, nobody needs telling to stay —
-- the service already only retracts a SIGNED diversion, and this makes the rule true of the row whatever wrote it.
ALTER TABLE dairy_shift_diversions
  DROP CONSTRAINT IF EXISTS ck_dairy_diversion_retraction_needs_notice;
ALTER TABLE dairy_shift_diversions
  ADD CONSTRAINT ck_dairy_diversion_retraction_needs_notice
  CHECK (retraction_queued_at IS NULL OR notice_queued_at IS NOT NULL);

-- THE GRANT, EXTENDED BY EXACTLY FOUR COLUMNS. 0166 revoked UPDATE and granted back only the two endings; the notice
-- receipt is a third thing the application legitimately writes once, so it is named here rather than the whole table
-- being handed back. (A `REVOKE ALL` + `GRANT` pair would silently widen what 0166 narrowed.)
GRANT UPDATE (notice_queued_at, notice_recipients, retraction_queued_at, retraction_recipients)
  ON dairy_shift_diversions TO kv_app;

COMMENT ON COLUMN dairy_shift_diversions.notice_queued_at IS
  'PC-56 TENANT-6d-8: when the member notice was HANDED TO THE OUTBOX, in the same transaction as the signature. Not '
  'a delivery claim - per-person delivery is in notifications, read by the diversion screen''s delivery report.';
COMMENT ON COLUMN dairy_shift_diversions.notice_recipients IS
  'PC-56 TENANT-6d-8: how many members the notice was queued FOR - the "87 pourers" of W170''s own sentence, resolved '
  'from the route history AS OF the diverted day. Stored rather than re-derived: route history changes, and a receipt '
  'about the past must not.';

-- ------------------------------------------------------------------------------------------------------------------
-- 167.4  THE INDEX THAT MAKES "WHO WAS TOLD" A BOUNDED QUESTION
-- ------------------------------------------------------------------------------------------------------------------
-- The delivery report answers, for ONE diversion: how many members were reached, on which channels, in which
-- languages, how many had no address and how many had no template. That is a read over `notifications` — RANGE
-- partitioned by `created_at` (0012) with indexes only on `(user_id, created_at)` and the queued-status partial.
--
-- Without an index this report is a filtered scan of a whole day's notifications on a busy platform: fine on a
-- cooperative, ruinous on the shared tables of a district union, and exactly the shape Law 8 exists to forbid. With
-- `(event_code, created_at DESC)` and the notice's own `notice_queued_at` as the window, it is an index range over a
-- handful of rows inside ONE partition — the diversion's own notice and nothing else.
--
-- THE COST IS NAMED: one more index on the platform's highest-volume table, written on every notification insert. It is
-- accepted because the alternative is a screen that cannot answer the question a cooperative will ask first ("did the
-- families get the message?"), and because the same index serves every future per-event delivery report rather than
-- only this one.
CREATE INDEX IF NOT EXISTS idx_notif_event_created ON notifications (event_code, created_at DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- 167.5  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_shift_diversion_notice',
   'PC-56 TENANT-6d-8 (W170 playbook step 2): the MEMBER NOTICE for a signed shift diversion, and its retraction when '
   'the diversion is called off - voice first, in each member''s own language, to the members routed to the sending '
   'centre as of the diverted day. OFF means no notice is queued and the diversion screen SAYS SO ("not enabled") '
   'rather than showing a count that reached nobody; the diversion act itself, the counter and the board are '
   'untouched by this flag. A cooperative whose telephony contract is not signed yet can divert a shift and tell its '
   'members by loudspeaker, which is what they did before this platform existed.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 167.6  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It does not seed the copy.** The templates for both events - four channels x three languages each - live in
--     `db/seeds/core/0007_notification_events_templates.sql`, ABOVE its version backfill, because 0122's send-time
--     gate INNER JOINs `serving_version_id` and only that file writes version rows for seed-authored copy. A template
--     inserted by a migration after 0122 resolves to nothing and is recorded `no_template`, silently: TENANT-6c-2's
--     finding, which 6d-1 and 6d-5 both had to route around.
--   • **It does not decide WHO in a cooperative may switch the notice on.** The flag is platform-level (`experiment`
--     tier, 100% rollout when enabled); per-tenant staging is what `FlagsService`'s tenant scope already does.
--   • **It does not record a failed CALL.** A voice leg that the telephony product refuses is recorded by the
--     notification spine as a failed row on that channel - which is more than TENANT-6d-5's masked call manages - but
--     nothing retries it, and *"repeated failures page the on-call"* (W2523) still has nothing to count.
--   • **It does not tell a member whose route CHANGED after the notice went out.** The recipient set is resolved as of
--     the diverted day at the moment of signing. A member enrolled onto that route an hour later is not told, and the
--     screen's count is the receipt of what was actually done rather than a live query. Naming it here because the
--     honest fix is a re-resolve at shift start, which is a scheduled job and not this wave.
--   • **It does not move the pours or touch the trigger.** Where a pour may be recorded is 6d-6's `pourPlace`, and it
--     does not consult the notice: a member who never got the message and turns up at Bhesan under a signed diversion
--     is still recorded correctly. The notice is a courtesy this platform owes them, not a condition of their milk.
