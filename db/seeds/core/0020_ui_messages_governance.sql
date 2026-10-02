-- ==================================================================================================================
-- db/seeds/core/0020_ui_messages_governance.sql
-- PC-56 TENANT-9b · THE RESOLUTIONS — the words a resolution notice is worded with, in every language a member is told in.
-- ==================================================================================================================
-- `resolution.closed` (seed 0007) names the RESULT — a platform code (`passed`, `failed`) the database wrote at close
-- (0182). A Gujarati notice with an English code in it is TENANT-6d-7's defect, so the words live here per language and
-- `GovernanceService.transition` reads them by prefix. `governance.notice.no_close` is what `resolution.opened` says when
-- the board set no closing time.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('governance.outcome.passed','en','passed'),('governance.outcome.passed','hi','पारित'),('governance.outcome.passed','gu','પસાર'),
  ('governance.outcome.failed','en','not passed'),('governance.outcome.failed','hi','पारित नहीं'),('governance.outcome.failed','gu','પસાર નથી'),
  ('governance.outcome.not_recorded','en','not recorded'),('governance.outcome.not_recorded','hi','दर्ज नहीं'),('governance.outcome.not_recorded','gu','નોંધાયેલ નથી'),
  ('governance.notice.no_close','en','when the board closes voting'),('governance.notice.no_close','hi','जब बोर्ड मतदान बंद करे'),('governance.notice.no_close','gu','જ્યારે બોર્ડ મતદાન બંધ કરે')
ON CONFLICT DO NOTHING;
