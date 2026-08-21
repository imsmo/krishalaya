-- ==================================================================================================================
-- db/seeds/core/0016_ui_messages_dairy_notices.sql
-- PC-56 TENANT-6d-7 · THE WORDS THAT NEVER ARRIVED — the platform's first rows in `ui_messages`.
-- ==================================================================================================================
--
-- `ui_messages` (key, language_code, text) has existed since migration 0001 — *"UI strings (app labels, button text)
-- — keyed catalog, same dynamic principle"* — and until this wave it held NOTHING and had no reader on the server.
-- The mobile app's own i18n header calls it *"the eventual source of truth"* and ships hardcoded fallbacks instead.
--
-- WHAT IT IS FOR HERE. A dairy notice's copy is seeded three times over (en/hi/gu) in 0007, and its variables come
-- from a domain event that is emitted ONCE and rendered for every recipient. So a payload carrying `shift: 'evening'`
-- has already put an English word inside a Gujarati sentence — which is exactly what TENANT-6b-1's SMS did:
--
--     "{{mcc}} માં {{shift}} નું તમારું દૂધ તપાસ માટે રાખ્યું છે."   →   "  માં evening નું તમારું દૂધ ..."
--
-- (the centre name blank because `{{mcc}}` was never in the payload at all; see the wave's own note in
-- modules/dairy/domain/dairy-notice-vars.ts). These rows are where the three words come from, so the value in the
-- payload is a per-language map and `NotificationTemplate.render` picks the one the template is written in.
--
-- WHY DATA AND NOT A CONSTANT IN A SERVICE. Law 6: *"If you are writing a string a tenant admin should control —
-- stop, it belongs in a table."* A cooperative that calls its shifts *"સવાર/સાંજ"* or *"પહેલી/બીજી"* must be able to
-- say so without a deploy, and a platform that adds Marathi adds rows here rather than a branch in dairy.
--
-- WHY NOT `lookup_values`. `milk_shift` is a Postgres ENUM (0009) and the review status is a state machine's own
-- vocabulary — neither is a tenant-extensible list, so neither belongs in `lookup_values`. What they need is a
-- TRANSLATION of a fixed word, which is what this table is.
--
-- IDEMPOTENT: PK (key, language_code), untargeted DO NOTHING (TENANT-6d-1's NULL-key lesson does not apply here — the
-- key has no nullable column — but the same shape keeps a re-run silent).

INSERT INTO ui_messages (key, language_code, text) VALUES
  -- The two collections of a dairy day (`milk_shift`, 0009). Hindi is romanised for the same reason 0007's SMS copy
  -- is: a farmer's feature phone renders Latin reliably and Devanagari sometimes.
  ('dairy.shift.morning',            'en', 'morning'),
  ('dairy.shift.morning',            'hi', 'subah'),
  ('dairy.shift.morning',            'gu', 'સવાર'),
  ('dairy.shift.evening',            'en', 'evening'),
  ('dairy.shift.evening',            'hi', 'shaam'),
  ('dairy.shift.evening',            'gu', 'સાંજ'),

  -- W168's quality decision, as a member is told it. NOT the enum: *"cleared"* is a platform word and
  -- *"પાસ થયું"* is what it means to somebody holding a phone at a collection counter.
  ('dairy.quality.outcome.cleared',  'en', 'cleared'),
  ('dairy.quality.outcome.cleared',  'hi', 'theek paya gaya'),
  ('dairy.quality.outcome.cleared',  'gu', 'પાસ થયું'),
  ('dairy.quality.outcome.rejected', 'en', 'not accepted'),
  ('dairy.quality.outcome.rejected', 'hi', 'sweekar nahin kiya gaya'),
  ('dairy.quality.outcome.rejected', 'gu', 'સ્વીકાર્યું નથી'),

  -- W169's dispute outcome (`DISPUTE_STATUSES`, milk-bill-dispute.entity.ts). *"upheld"* means the member was right.
  ('dairy.dispute.outcome.upheld',   'en', 'your objection was accepted'),
  ('dairy.dispute.outcome.upheld',   'hi', 'aapki shikayat maani gayi'),
  ('dairy.dispute.outcome.upheld',   'gu', 'તમારો વાંધો સ્વીકાર્યો'),
  ('dairy.dispute.outcome.rejected', 'en', 'your objection was not accepted'),
  ('dairy.dispute.outcome.rejected', 'hi', 'aapki shikayat nahin maani gayi'),
  ('dairy.dispute.outcome.rejected', 'gu', 'તમારો વાંધો સ્વીકાર્યો નથી')
ON CONFLICT DO NOTHING;
