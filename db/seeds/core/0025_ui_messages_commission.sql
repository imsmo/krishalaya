-- ==================================================================================================================
-- db/seeds/core/0025_ui_messages_commission.sql
-- PC-56 TENANT-SW-a · THE WORDS A COMMISSION-RULE NOTICE IS WORDED WITH, IN EVERY LANGUAGE A MEMBER IS TOLD IN.
-- ==================================================================================================================
-- `tenant.commission_rule_effective` (seed 0007) tells every member, at the rule's IST midnight, that a commission rule confirmed by two
-- administrators with seven days' notice now applies. The payload carries per-language maps read from these keys by the commission
-- service (CommissionRuleService.memberNotice); a missing English word fails the notice closed (counted), never sends a key.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('commission.change.create','en','A new commission rule'),
  ('commission.change.create','hi','नया कमीशन नियम'),
  ('commission.change.create','gu','નવો કમિશન નિયમ'),
  ('commission.change.deactivate','en','A commission rule ends'),
  ('commission.change.deactivate','hi','एक कमीशन नियम समाप्त'),
  ('commission.change.deactivate','gu','એક કમિશન નિયમ સમાપ્ત'),
  ('commission.payer.seller','en','paid by the seller'),
  ('commission.payer.seller','hi','विक्रेता द्वारा देय'),
  ('commission.payer.seller','gu','વેચનાર દ્વારા ચૂકવવાપાત્ર'),
  ('commission.payer.buyer','en','paid by the buyer'),
  ('commission.payer.buyer','hi','खरीदार द्वारा देय'),
  ('commission.payer.buyer','gu','ખરીદનાર દ્વારા ચૂકવવાપાત્ર')
ON CONFLICT (key, language_code) DO NOTHING;
