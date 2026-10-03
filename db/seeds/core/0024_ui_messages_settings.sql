-- ==================================================================================================================
-- db/seeds/core/0024_ui_messages_settings.sql
-- PC-56 TENANT-13b · THE NAME OF EVERY TRUST-AFFECTING SETTING, AND OF ITS ENUM VALUES, IN EVERY LANGUAGE A MEMBER IS TOLD IN.
-- ==================================================================================================================
-- `tenant.setting_effective` (seed 0007) tells every member that a cooperative rule changes at midnight. The rule is a registry
-- key (`governance.quorum_bp`); a Gujarati notice with the key in it is TENANT-6d-7's defect. The settings-apply job reads these by
-- prefix (`UiMessageRepository.mapsUnder('setting.name.')`, `('setting.value.')`) and puts per-language maps into the payload. A key
-- with no English name here is not announced (fails closed, counted) — `tenant13b-settings-desks.spec.ts` asserts every member_notice
-- key the registry flags has a name in all three languages.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('setting.name.order.auto_confirm_hours','en','Order auto-confirm (hours)'),
  ('setting.name.order.auto_confirm_hours','hi','ऑर्डर स्वतः पुष्टि (घंटे)'),
  ('setting.name.order.auto_confirm_hours','gu','ઓર્ડર આપમેળે પુષ્ટિ (કલાક)'),
  ('setting.name.listing.approval_required','en','Listings need approval'),
  ('setting.name.listing.approval_required','hi','लिस्टिंग के लिए मंज़ूरी ज़रूरी'),
  ('setting.name.listing.approval_required','gu','લિસ્ટિંગ માટે મંજૂરી જરૂરી'),
  ('setting.name.order.quality_window_hours','en','Order quality complaint window (hours)'),
  ('setting.name.order.quality_window_hours','hi','ऑर्डर गुणवत्ता शिकायत अवधि (घंटे)'),
  ('setting.name.order.quality_window_hours','gu','ઓર્ડર ગુણવત્તા ફરિયાદ સમયગાળો (કલાક)'),
  ('setting.name.dairy.dispute_window_hours','en','Milk bill objection window (hours)'),
  ('setting.name.dairy.dispute_window_hours','hi','दूध बिल आपत्ति अवधि (घंटे)'),
  ('setting.name.dairy.dispute_window_hours','gu','દૂધ બિલ વાંધા સમયગાળો (કલાક)'),
  ('setting.name.settlements.cycle_length','en','Settlement cycle'),
  ('setting.name.settlements.cycle_length','hi','भुगतान चक्र'),
  ('setting.name.settlements.cycle_length','gu','ચુકવણી ચક્ર'),
  ('setting.name.governance.quorum_bp','en','Voting quorum'),
  ('setting.name.governance.quorum_bp','hi','मतदान कोरम'),
  ('setting.name.governance.quorum_bp','gu','મતદાન કોરમ'),
  ('setting.name.governance.special_majority_num','en','Special majority (numerator)'),
  ('setting.name.governance.special_majority_num','hi','विशेष बहुमत (अंश)'),
  ('setting.name.governance.special_majority_num','gu','વિશેષ બહુમતી (અંશ)'),
  ('setting.name.governance.special_majority_den','en','Special majority (denominator)'),
  ('setting.name.governance.special_majority_den','hi','विशेष बहुमत (हर)'),
  ('setting.name.governance.special_majority_den','gu','વિશેષ બહુમતી (છેદ)'),
  ('setting.value.fortnightly','en','fortnightly'),
  ('setting.value.fortnightly','hi','पाक्षिक'),
  ('setting.value.fortnightly','gu','પખવાડિક'),
  ('setting.value.monthly','en','monthly'),
  ('setting.value.monthly','hi','मासिक'),
  ('setting.value.monthly','gu','માસિક'),
  ('setting.value.true','en','yes'),
  ('setting.value.true','hi','हाँ'),
  ('setting.value.true','gu','હા'),
  ('setting.value.false','en','no'),
  ('setting.value.false','hi','नहीं'),
  ('setting.value.false','gu','ના')
ON CONFLICT DO NOTHING;
