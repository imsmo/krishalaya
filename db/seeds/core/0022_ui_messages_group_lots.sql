-- ==================================================================================================================
-- db/seeds/core/0022_ui_messages_group_lots.sql
-- PC-56 TENANT-11c · GROUP LOTS — the words a group-lot notice is worded with, in every language a member can be told in.
-- ==================================================================================================================
-- `group_lot.cancelled` (seed 0007) names the REASON the lot was cancelled. The reason is a platform code from the
-- `group_lot_cancel_reason` lookup (0188 / seed 0005); a Gujarati notice with an English code in it is TENANT-6d-7's defect.
-- So the words live here, per language, and the group-lot service reads them by prefix (`UiMessageRepository.mapsUnder`)
-- and fails CLOSED on a missing English row. `other` is never read from here: the coordinator's own words are sent verbatim.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('group_lot.cancel_reason.target_missed','en','the target was not reached by the deadline'),
  ('group_lot.cancel_reason.target_missed','hi','अंतिम तिथि तक लक्ष्य पूरा नहीं हुआ'),
  ('group_lot.cancel_reason.target_missed','gu','અંતિમ તારીખ સુધીમાં લક્ષ્ય પૂરું ન થયું'),
  ('group_lot.cancel_reason.coordinator_withdrew','en','the coordinator withdrew'),
  ('group_lot.cancel_reason.coordinator_withdrew','hi','संयोजक ने अपना नाम वापस ले लिया'),
  ('group_lot.cancel_reason.coordinator_withdrew','gu','સંયોજકે પોતાનું નામ પાછું ખેંચી લીધું'),
  ('group_lot.cancel_reason.quality','en','the produce did not meet the buyer''s quality grade'),
  ('group_lot.cancel_reason.quality','hi','उपज खरीदार की गुणवत्ता श्रेणी पर खरी नहीं उतरी'),
  ('group_lot.cancel_reason.quality','gu','ઉપજ ખરીદદારના ગુણવત્તા ધોરણ પર ખરી ન ઊતરી')
ON CONFLICT DO NOTHING;
