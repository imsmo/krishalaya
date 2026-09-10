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
