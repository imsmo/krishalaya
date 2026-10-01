-- ==================================================================================================================
-- db/seeds/core/0017_ui_messages_export_datasets.sql
-- PC-56 TENANT-6e-2 · THE EXPORT — the name of each export DATASET, in every language a requester can be told in.
-- ==================================================================================================================
--
-- `exports.export_ready` (0169.4) tells a requester their file is on the ready page, and its body says WHICH file:
-- *"Your {{dataset}} export is ready"*. The dataset code is `dairy.insights` — a platform identifier, not a word — and
-- a Gujarati notice with `dairy.insights` in the middle of it is TENANT-6d-7's defect (an English token inside
-- vernacular copy) in a new coat. So the word comes from here, as a per-language map the template picks from, exactly
-- as `dairy.shift.*` does in 0016.
--
-- ONE ROW SET PER REGISTERED DATASET, keyed `exports.dataset.<code>`. The API's dataset registry reads these by code
-- and fails CLOSED (langMapFrom) if the English row is missing — a dataset with no name is a notice with a hole in it.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('exports.dataset.dairy.insights', 'en', 'dairy insights'),
  ('exports.dataset.dairy.insights', 'hi', 'dairy insights (doodh sangrah ka saar)'),
  ('exports.dataset.dairy.insights', 'gu', 'ડેરી ઇનસાઇટ્સ')
ON CONFLICT DO NOTHING;

-- [PC-56 TENANT-7d-money] W418's file: the instructor's own earnings statement (dataset `education.instructor_earnings`).
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('exports.dataset.education.instructor_earnings', 'en', 'instructor earnings statement'),
  ('exports.dataset.education.instructor_earnings', 'hi', 'प्रशिक्षक कमाई विवरण'),
  ('exports.dataset.education.instructor_earnings', 'gu', 'પ્રશિક્ષક કમાણી પત્રક')
ON CONFLICT DO NOTHING;

-- [PC-56 TENANT-8e] W2839/W2840's file: the cooperative's in-app broadcasts, counted from the delivery log
-- (dataset `communication.broadcasts`). There is no WhatsApp dataset — the receipt says so.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('exports.dataset.communication.broadcasts', 'en', 'announcements (in-app broadcasts)'),
  ('exports.dataset.communication.broadcasts', 'hi', 'सूचनाएँ (ऐप-भीतर प्रसारण)'),
  ('exports.dataset.communication.broadcasts', 'gu', 'જાહેરાતો (ઍપમાંના પ્રસારણ)')
ON CONFLICT DO NOTHING;

-- [PC-56 TENANT-9c] The auditor realm's three files (W201 / W2498 / W2499): the audit trail (masked as on screen), the
-- ledger legs through the tenant funnel, and one section of the compliance pack per file. All UNSIGNED — the receipt says so.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('exports.dataset.audit.trail', 'en', 'audit trail (masked)'),
  ('exports.dataset.audit.trail', 'hi', 'ऑडिट ट्रेल (छिपे विवरण सहित)'),
  ('exports.dataset.audit.trail', 'gu', 'ઑડિટ ટ્રેલ (છુપાવેલી વિગતો સાથે)'),
  ('exports.dataset.ledger.entries', 'en', 'ledger entries'),
  ('exports.dataset.ledger.entries', 'hi', 'खाता-बही प्रविष्टियाँ'),
  ('exports.dataset.ledger.entries', 'gu', 'ખાતાવહી નોંધો'),
  ('exports.dataset.compliance.pack', 'en', 'compliance pack section'),
  ('exports.dataset.compliance.pack', 'hi', 'अनुपालन पैक का खंड'),
  ('exports.dataset.compliance.pack', 'gu', 'અનુપાલન પૅકનો વિભાગ')
ON CONFLICT DO NOTHING;
