-- 0007 · notification event catalog (PRD §14.2) + hi/en/gu templates · [P1]
INSERT INTO notification_events (code,default_name,priority,default_channels,user_can_opt_out,batchable) VALUES
 ('auth.otp','Login OTP','critical','["sms","whatsapp"]',false,false),
 ('order.created','Order placed','important','["push","sms"]',true,false),
 ('order.delivered','Order delivered','important','["push","sms","whatsapp"]',true,false),
 ('payment.success','Payment successful','important','["push","sms"]',true,false),
 ('payout.completed','Payout credited','important','["push","sms"]',true,false),
 ('bid.outbid','You were outbid','important','["push"]',true,false),
 ('bid.won','Auction won','important','["push","sms"]',true,false),
 ('wage.paid','Wage credited','critical','["push","sms"]',true,false),
 ('booking.offer','New work booking offer','important','["push","sms"]',true,false),
 ('scheme.approved','Scheme application approved','important','["push","sms"]',true,false),
 ('price.alert','Mandi price alert','informational','["push"]',true,true),
 ('weather.alert','Weather advisory','important','["push","sms"]',true,false),
 -- M13 communication fanout codes (mapped from module outbox events; see communication/events/notification-event-map.ts)
 ('order.confirmed','Order confirmed','important','["push","sms","inapp"]',true,false),
 ('order.completed','Order completed','important','["push","inapp"]',true,false),
 ('offer.accepted','Your offer was accepted','important','["push","inapp"]',true,false),
 ('quote.accepted','Your quote was accepted','important','["push","inapp"]',true,false),
 ('shipment.delivered','Shipment delivered','important','["push","sms","inapp"]',true,false),
 ('dispute.opened','A dispute was opened','important','["push","inapp"]',false,false),
 ('dispute.resolved','Dispute resolved','important','["push","sms","inapp"]',false,false),
 ('dispute.refunded','Refund issued','critical','["push","sms","inapp"]',false,false),
 ('chat.message_posted','New message','informational','["push","inapp"]',true,true),
 -- Wave 4 engagement codes (mapped from module outbox events; see communication/events/notification-event-map.ts)
 ('requirement.matched','A listing matches your requirement','informational','["push","inapp"]',true,true),
 ('requirement.reminder','Your requirement is still open','informational','["push","inapp"]',true,true),
 ('review.prompt','Rate your recent purchase','informational','["push","inapp"]',true,true),
 -- P1-7 auction watch/follow: notify watchers when an auction they follow closes
 ('auction.ended','An auction you watched has ended','informational','["push","inapp"]',true,true),
 -- API-W10 tenant broadcast: an admin blast (not a transactional alert) → push + in-app, opt-out-able. Free text
 -- flows in via the payload ({{title}}/{{body}}). Moved here from migration 0048 (templates FK languages → seed).
 ('tenant.broadcast','Announcement','promotional','["push","inapp"]',true,false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code,channel,language_code,tenant_id,subject,body,provider_template_ref,is_active) VALUES
 ('auth.otp','sms','hi',NULL,NULL,'Krishalaya OTP: {{otp}}. 5 minute me expire. Kisi se share na karein.','DLT_OTP_HI',true),
 ('auth.otp','sms','en',NULL,NULL,'Krishalaya OTP: {{otp}}. Expires in 5 min. Do not share.','DLT_OTP_EN',true),
 ('auth.otp','sms','gu',NULL,NULL,'Krishalaya OTP: {{otp}}. 5 મિનિટમાં સમાપ્ત. કોઈને શેર ન કરો.','DLT_OTP_GU',true),
 ('wage.paid','sms','hi',NULL,NULL,'{{amount}} aapke khate me jama. Kaam: {{task}}. Krishalaya','DLT_WAGE_HI',true),
 ('wage.paid','sms','gu',NULL,NULL,'{{amount}} તમારા ખાતામાં જમા. કામ: {{task}}. Krishalaya','DLT_WAGE_GU',true),
 ('order.delivered','push','en',NULL,'Delivered','Your order {{order_no}} was delivered. Rate your experience.',NULL,true),
 -- M13 platform-default templates (en) for the fanout codes; tenants may override per (event,channel,lang)
 ('order.confirmed','push','en',NULL,'Order confirmed','Your order {{orderNo}} is confirmed.',NULL,true),
 ('order.confirmed','inapp','en',NULL,'Order confirmed','Your order {{orderNo}} is confirmed.',NULL,true),
 ('order.completed','inapp','en',NULL,'Order completed','Order {{orderNo}} is complete.',NULL,true),
 ('offer.accepted','push','en',NULL,'Offer accepted','Your offer was accepted.',NULL,true),
 ('offer.accepted','inapp','en',NULL,'Offer accepted','Your offer was accepted.',NULL,true),
 ('quote.accepted','inapp','en',NULL,'Quote accepted','Your quote was accepted.',NULL,true),
 ('shipment.delivered','push','en',NULL,'Delivered','Your shipment was delivered.',NULL,true),
 ('shipment.delivered','inapp','en',NULL,'Delivered','Your shipment was delivered.',NULL,true),
 ('dispute.opened','inapp','en',NULL,'Dispute opened','A dispute was opened on your order.',NULL,true),
 ('dispute.resolved','inapp','en',NULL,'Dispute resolved','Your dispute has been resolved.',NULL,true),
 ('dispute.refunded','push','en',NULL,'Refund issued','A refund of {{amountMinor}} (minor units) was issued.',NULL,true),
 ('dispute.refunded','inapp','en',NULL,'Refund issued','A refund was issued to your wallet.',NULL,true),
 ('payment.success','inapp','en',NULL,'Payment received','We received your payment.',NULL,true),
 ('chat.message_posted','push','en',NULL,'New message','You have a new message.',NULL,true),
 ('chat.message_posted','inapp','en',NULL,'New message','You have a new message.',NULL,true),
 ('requirement.matched','push','en',NULL,'New match','A new listing matches your requirement.',NULL,true),
 ('requirement.matched','inapp','en',NULL,'New match','A new listing matches your requirement.',NULL,true),
 ('requirement.reminder','push','en',NULL,'Still looking?','Your requirement is still open — sellers can quote.',NULL,true),
 ('requirement.reminder','inapp','en',NULL,'Still looking?','Your requirement is still open — sellers can quote.',NULL,true),
 ('review.prompt','push','en',NULL,'Rate your experience','How was your recent order? Leave a review.',NULL,true),
 ('review.prompt','inapp','en',NULL,'Rate your experience','How was your recent order? Leave a review.',NULL,true),
 ('auction.ended','push','en',NULL,'Auction ended','An auction you watched has ended — see the result.',NULL,true),
 ('auction.ended','inapp','en',NULL,'Auction ended','An auction you watched has ended — see the result.',NULL,true)
-- [PC-56 TENANT-6e-2 2026-09-10] WAS `ON CONFLICT (event_code,channel,language_code,tenant_id) DO NOTHING` — a TARGETED
-- conflict on the table's own unique key, whose `tenant_id` is NULL on every platform row. Postgres treats NULLs as
-- distinct there, so that target could never fire (TENANT-6c-4's finding, and the reason every later block in this
-- file uses the untargeted form), and since 0162 added `uq_notification_templates_platform` the second run of this
-- file failed on THIS statement: `node db/scripts/seed.js` was not re-runnable on any database it had already seeded.
-- Invisible because the programme's proof ran seeds exactly once per fresh database. Untargeted, like the rest.
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------------
-- THE VARIABLE DECLARATIONS FOR THE COPY ABOVE (moved here by PC-56 TENANT-4d-5, chain repair)
-- ---------------------------------------------------------------------------------------------------
-- 0122 introduced `notification_event_variables` so that "a required variable missing from a body is
-- refused at authoring time", and declared these eight from the bodies in THIS file. It could not: the
-- table's `event_code` REFERENCES `notification_events(code)`, and every code below is created here — in a
-- SEED, which `db/prod/apply.sh` runs at step 4, AFTER migrations at step 1. So 0122 failed its foreign
-- key on every fresh database and, because the runner wraps each file in one transaction and stops the
-- chain on failure, nothing from 0122 onwards had ever applied anywhere.
--
-- A declaration about seeded copy belongs beside that copy, which is also why 0048 moved its templates
-- here. 0122 keeps its own guarded insert for databases that already hold these events; the ON CONFLICT
-- below means the two can never produce a duplicate, and either order gives exactly one row.
INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('auth.otp',        'otp',            'generated one-time code (never stored in clear)', '482913',            true),
 ('order.delivered', 'order_id',       'orders.order_no',                                 'ORD-2026-088412',   true),
 ('order.delivered', 'amount',         'orders.total_minor + currency (formatted)',       '₹12,450',           false),
 ('order.delivered', 'payment_status', 'payments.status label (localized)',               'Paid',              false),
 ('order.delivered', 'receipt_url',    'short link (kvs.in)',                             'kvs.in/r/8xk2',     false),
 ('bid.outbid',      'lot_name',       'auction_lots.title',                              'Cotton · 12 quintal', true),
 ('wage.paid',       'amount',         'wage_payments.amount_minor + currency',           '₹1,250',            true),
 ('scheme.approved', 'scheme_name',    'schemes.default_name',                            'PM-KISAN',          true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6b-1 · W168's promise: "member notified in Gujarati"
-- ---------------------------------------------------------------------------------------------------------------
-- The quality desk's footer reads *"Flag decisions are recorded · pour-level hold, never wallet freeze · member
-- notified in Gujarati"*. Nothing told the member anything: there was no review, no decision and no message, and the
-- flagged pour was paid in the next bill regardless. Two events, and the wording matters as much as the plumbing —
-- W168's own protocol says *"gentle first-time conversation (rain-water in cans is the usual truth)"*, so the message
-- states the fact and names the re-test, and does NOT accuse anybody of adulteration.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('dairy.quality_flag_opened',  'Milk sample under review', 'important', '["sms","push"]', false, false),
 ('dairy.quality_flag_decided', 'Milk sample review closed', 'important', '["sms","push"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- `user_can_opt_out = false` on both, deliberately: this is a message about money the cooperative is holding back from
-- this member. A farmer who muted dairy notifications must still be told that a pour is not being paid for.

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('dairy.quality_flag_opened','sms','gu',NULL,NULL,'{{mcc}} માં {{shift}} નું તમારું દૂધ તપાસ માટે રાખ્યું છે. સીલબંધ નમૂનો તમારી હાજરીમાં ફરી તપાસાશે. આ પુરાવણી સુધી આ એક પોરનું જ પેમેન્ટ રોકાયું છે — બાકીના પોર સામાન્ય રીતે ચૂકવાશે. Krishalaya','DLT_DAIRY_FLAG_GU',true),
 ('dairy.quality_flag_opened','sms','hi',NULL,NULL,'{{mcc}} par {{shift}} ka aapka doodh jaanch ke liye rakha gaya hai. Sealed sample aapki maujoodgi me dobara jaancha jayega. Sirf is ek pour ka payment ruka hai — baaki pour normal chukaye jayenge. Krishalaya','DLT_DAIRY_FLAG_HI',true),
 ('dairy.quality_flag_opened','sms','en',NULL,NULL,'Your {{shift}} milk at {{mcc}} is held for a quality check. The sealed sample will be re-tested with you present. Only this pour''s payment is held — your other pours pay normally. Krishalaya','DLT_DAIRY_FLAG_EN',true),
 ('dairy.quality_flag_opened','push','en',NULL,'Milk sample under review','Your {{shift}} pour at {{mcc}} is held pending a re-test with you present. Your other pours are unaffected.',NULL,true),
 ('dairy.quality_flag_opened','push','hi',NULL,'Doodh ka sample jaanch me','{{mcc}} par {{shift}} ka aapka pour aapki maujoodgi me dobara jaanch hone tak roka gaya hai. Baaki pour par koi asar nahin.',NULL,true),
 ('dairy.quality_flag_opened','push','gu',NULL,'દૂધનો નમૂનો તપાસમાં','{{mcc}} માં {{shift}} નું તમારું પોર તમારી હાજરીમાં ફરી તપાસ થાય ત્યાં સુધી રોકાયું છે. બાકીના પોર પર કોઈ અસર નથી.',NULL,true),
 ('dairy.quality_flag_opened','inapp','en',NULL,'Milk sample under review','Your {{shift}} pour at {{mcc}} is held pending a re-test with you present. Your other pours are unaffected.',NULL,true),
 ('dairy.quality_flag_opened','inapp','hi',NULL,'Doodh ka sample jaanch me','{{mcc}} par {{shift}} ka aapka pour aapki maujoodgi me dobara jaanch hone tak roka gaya hai. Baaki pour par koi asar nahin.',NULL,true),
 ('dairy.quality_flag_opened','inapp','gu',NULL,'દૂધનો નમૂનો તપાસમાં','{{mcc}} માં {{shift}} નું તમારું પોર તમારી હાજરીમાં ફરી તપાસ થાય ત્યાં સુધી રોકાયું છે. બાકીના પોર પર કોઈ અસર નથી.',NULL,true),
 ('dairy.quality_flag_decided','sms','gu',NULL,NULL,'તમારા દૂધની તપાસ પૂરી થઈ: {{outcome}}. પ્રશ્ન હોય તો તમારા MCC સેક્રેટરીને મળો. Krishalaya','DLT_DAIRY_FLAG_DONE_GU',true),
 ('dairy.quality_flag_decided','sms','hi',NULL,NULL,'Aapke doodh ki jaanch poori hui: {{outcome}}. Sawaal ho to apne MCC secretary se milein. Krishalaya','DLT_DAIRY_FLAG_DONE_HI',true),
 ('dairy.quality_flag_decided','sms','en',NULL,NULL,'Your milk sample review is closed: {{outcome}}. Speak to your MCC secretary if you have questions. Krishalaya','DLT_DAIRY_FLAG_DONE_EN',true),
 ('dairy.quality_flag_decided','push','en',NULL,'Milk sample review closed','Your milk sample review is closed: {{outcome}}.',NULL,true),
 ('dairy.quality_flag_decided','push','hi',NULL,'Doodh sample ki jaanch poori','Aapke doodh ki jaanch poori hui: {{outcome}}.',NULL,true),
 ('dairy.quality_flag_decided','push','gu',NULL,'દૂધ નમૂનાની તપાસ પૂરી','તમારા દૂધની તપાસ પૂરી થઈ: {{outcome}}.',NULL,true),
 ('dairy.quality_flag_decided','inapp','en',NULL,'Milk sample review closed','Your milk sample review is closed: {{outcome}}.',NULL,true),
 ('dairy.quality_flag_decided','inapp','hi',NULL,'Doodh sample ki jaanch poori','Aapke doodh ki jaanch poori hui: {{outcome}}.',NULL,true),
 ('dairy.quality_flag_decided','inapp','gu',NULL,'દૂધ નમૂનાની તપાસ પૂરી','તમારા દૂધની તપાસ પૂરી થઈ: {{outcome}}.',NULL,true)
-- [PC-56 TENANT-6d-1] `ON CONFLICT` WITH NO TARGET, and that is the fix rather than a shortcut: the unique key is
-- (event_code, channel, language_code, tenant_id) and every row here has tenant_id NULL, so the four-column
-- inference matched NOTHING and a re-run of this file DUPLICATED every platform template (proven: 176 rows became
-- 277, 98 groups doubled). TENANT-6c-4 found the same NULL-key trap costing 139 duplicated lookup values.
-- Migration 0162 de-duplicates and adds a partial unique index for platform rows; an untargeted DO NOTHING is
-- what stays idempotent against BOTH indexes.
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.quality_flag_opened',  'mcc',     'mcc_centres.default_name',                'Anand 02', true),
 ('dairy.quality_flag_opened',  'shift',   'milk_collections.shift (localized)',      'morning',  true),
 ('dairy.quality_flag_decided', 'outcome', 'milk_quality_reviews.status (localized)', 'cleared',  true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-2 · W169's promise: "Preview goes to every member in Gujarati BEFORE money moves"
-- ---------------------------------------------------------------------------------------------------------------
-- W169's subtitle is *"surprises are for birthdays, not milk money"*, and its timeline gives the member a 24-hour
-- window to object between the preview and the payment. Two events carry that: the preview itself, and the outcome of
-- an objection the member raised. `user_can_opt_out = false` on both, for the reason 6b-1 gave: these are messages
-- about money this cooperative is about to move, or has decided not to. A farmer who muted dairy notifications must
-- still be told what they are being paid and what happened to their complaint.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('dairy.bill_previewed',        'Milk bill ready to check', 'important', '["sms","push","inapp"]', false, false),
 ('dairy.bill_dispute_resolved', 'Milk bill query answered', 'important', '["sms","push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('dairy.bill_previewed','sms','gu',NULL,NULL,'{{period}} નું તમારું દૂધ બિલ: {{litres}} લિટર, કપાત {{deductions}} પછી ચોખ્ખા {{net}}. {{window_ends}} પહેલાં તપાસી લો — કંઈ ખોટું લાગે તો તમારા કેન્દ્રને જણાવો. Krishalaya','DLT_DAIRY_BILL_PREVIEW_GU',true),
 ('dairy.bill_previewed','sms','hi',NULL,NULL,'{{period}} ka aapka doodh bill: {{litres}} L, {{deductions}} katauti ke baad net {{net}}. {{window_ends}} se pehle jaanch lein — kuch galat lage to apne kendra ko batayein. Krishalaya','DLT_DAIRY_BILL_PREVIEW_HI',true),
 ('dairy.bill_previewed','sms','en',NULL,NULL,'Your milk bill for {{period}}: {{litres}} L, net {{net}} after {{deductions}} of deductions. Check it before {{window_ends}} — tell your centre if anything is wrong. Krishalaya','DLT_DAIRY_BILL_PREVIEW_EN',true),
 ('dairy.bill_previewed','push','en',NULL,'Milk bill ready to check','{{period}}: {{litres}} L, net {{net}}. You have until {{window_ends}} to raise anything.',NULL,true),
 ('dairy.bill_previewed','push','hi',NULL,'Doodh bill jaanch lein','{{period}}: {{litres}} L, net {{net}}. {{window_ends}} tak kuch bhi bata sakte hain.',NULL,true),
 ('dairy.bill_previewed','push','gu',NULL,'દૂધ બિલ તપાસી લો','{{period}}: {{litres}} લિટર, ચોખ્ખા {{net}}. {{window_ends}} સુધી કંઈ પણ જણાવી શકો છો.',NULL,true),
 ('dairy.bill_previewed','inapp','en',NULL,'Milk bill ready to check','Your bill for {{period}} is {{litres}} L, net {{net}} after {{deductions}} of deductions. Every pour and every deduction is itemised. If something looks wrong, raise it before {{window_ends}} — the payment waits for your window to close.',NULL,true),
 ('dairy.bill_previewed','inapp','hi',NULL,'Doodh bill jaanch lein','{{period}} ka bill: {{litres}} L, {{deductions}} katauti ke baad net {{net}}. Har pour aur har katauti alag-alag dikhayi gayi hai. Kuch galat lage to {{window_ends}} se pehle batayein — bhugtan aapki window band hone tak rukta hai.',NULL,true),
 ('dairy.bill_previewed','inapp','gu',NULL,'દૂધ બિલ તપાસી લો','{{period}} નું બિલ: {{litres}} લિટર, {{deductions}} કપાત પછી ચોખ્ખા {{net}}. દરેક પોર અને દરેક કપાત અલગ દર્શાવી છે. કંઈ ખોટું લાગે તો {{window_ends}} પહેલાં જણાવો — તમારી વિન્ડો બંધ થાય ત્યાં સુધી પેમેન્ટ રોકાય છે.',NULL,true),
 ('dairy.bill_dispute_resolved','sms','gu',NULL,NULL,'{{period}} ના બિલ વિશે તમારી ફરિયાદ પૂરી થઈ: {{outcome}}. {{note}} પ્રશ્ન હોય તો તમારા MCC સેક્રેટરીને મળો. Krishalaya','DLT_DAIRY_BILL_DISPUTE_GU',true),
 ('dairy.bill_dispute_resolved','sms','hi',NULL,NULL,'{{period}} ke bill par aapki shikayat poori hui: {{outcome}}. {{note}} Sawaal ho to apne MCC secretary se milein. Krishalaya','DLT_DAIRY_BILL_DISPUTE_HI',true),
 ('dairy.bill_dispute_resolved','sms','en',NULL,NULL,'Your query on the {{period}} bill is closed: {{outcome}}. {{note}} Speak to your MCC secretary if you have questions. Krishalaya','DLT_DAIRY_BILL_DISPUTE_EN',true),
 ('dairy.bill_dispute_resolved','push','en',NULL,'Milk bill query answered','Your query on the {{period}} bill is closed: {{outcome}}.',NULL,true),
 ('dairy.bill_dispute_resolved','push','hi',NULL,'Doodh bill ki shikayat ka jawab','{{period}} ke bill par aapki shikayat poori hui: {{outcome}}.',NULL,true),
 ('dairy.bill_dispute_resolved','push','gu',NULL,'દૂધ બિલની ફરિયાદનો જવાબ','{{period}} ના બિલ પર તમારી ફરિયાદ પૂરી થઈ: {{outcome}}.',NULL,true),
 ('dairy.bill_dispute_resolved','inapp','en',NULL,'Milk bill query answered','Your query on the {{period}} bill is closed: {{outcome}}. {{note}}',NULL,true),
 ('dairy.bill_dispute_resolved','inapp','hi',NULL,'Doodh bill ki shikayat ka jawab','{{period}} ke bill par aapki shikayat poori hui: {{outcome}}. {{note}}',NULL,true),
 ('dairy.bill_dispute_resolved','inapp','gu',NULL,'દૂધ બિલની ફરિયાદનો જવાબ','{{period}} ના બિલ પર તમારી ફરિયાદ પૂરી થઈ: {{outcome}}. {{note}}',NULL,true)
-- [PC-56 TENANT-6d-1] `ON CONFLICT` WITH NO TARGET, and that is the fix rather than a shortcut: the unique key is
-- (event_code, channel, language_code, tenant_id) and every row here has tenant_id NULL, so the four-column
-- inference matched NOTHING and a re-run of this file DUPLICATED every platform template (proven: 176 rows became
-- 277, 98 groups doubled). TENANT-6c-4 found the same NULL-key trap costing 139 duplicated lookup values.
-- Migration 0162 de-duplicates and adds a partial unique index for platform rows; an untargeted DO NOTHING is
-- what stays idempotent against BOTH indexes.
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.bill_previewed',        'period',      'milk_bills.period_start..period_end', '01-15 Jul',  true),
 ('dairy.bill_previewed',        'litres',      'milk_bills.total_litres',             '204.526',    true),
 ('dairy.bill_previewed',        'net',         'milk_bills.net_minor + currency',     'Rs 8,412',   true),
 ('dairy.bill_previewed',        'deductions',  'milk_bills.deductions_minor + currency', 'Rs 0',    true),
 ('dairy.bill_previewed',        'window_ends', 'milk_bills.dispute_window_ends',      'Fri 9:00 am', true),
 ('dairy.bill_dispute_resolved', 'period',      'milk_bills.period_start..period_end', '01-15 Jul',  true),
 ('dairy.bill_dispute_resolved', 'outcome',     'milk_bill_disputes.status (localized)', 'upheld',   true),
 ('dairy.bill_dispute_resolved', 'note',        'milk_bill_disputes.resolution_note',  'Weight corrected and the bill rebuilt.', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-4 · THE ONE NOTICE THAT NEEDS AN ANSWER
-- ---------------------------------------------------------------------------------------------------------------
-- W169: *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
--
-- Every other dairy notice in this file TELLS a member something. This one ASKS, and the difference matters: without
-- it the consent gate is a bill that silently never pays while the member is told nothing — the same shape as
-- TENANT-6c-2's window that nothing wrote, one layer up. `user_can_opt_out = false`, because a farmer who muted dairy
-- notifications must still be asked before a fifth of their fortnight is withheld, and `critical` rather than
-- `important` because it is the only dairy message whose absence stops the money entirely.
--
-- The copy names the FIGURES and the LINES, not a percentage: "Rs 2,400 of Rs 9,000 - feed credit Rs 500, loan
-- Rs 1,900" is a sentence a member can check against their own memory of the fortnight, and "your deductions exceed
-- 25%" is not.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('dairy.bill_deduction_consent_required', 'Milk bill deductions need your agreement', 'critical', '["sms","push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('dairy.bill_deduction_consent_required','sms','gu',NULL,NULL,'{{period}} ના તમારા દૂધ બિલમાં {{gross}} માંથી {{deductions}} કપાત છે ({{lines}}). તમારી સંમતિ વગર પેમેન્ટ થશે નહીં — એપ પર હા કે ના જણાવો અથવા તમારા કેન્દ્રને કહો. Krishalaya','DLT_DAIRY_CONSENT_GU',true),
 ('dairy.bill_deduction_consent_required','sms','hi',NULL,NULL,'{{period}} ke aapke doodh bill mein {{gross}} me se {{deductions}} katauti hai ({{lines}}). Aapki sehmati ke bina bhugtan nahi hoga — app par haan ya na batayein ya apne kendra ko kahein. Krishalaya','DLT_DAIRY_CONSENT_HI',true),
 ('dairy.bill_deduction_consent_required','sms','en',NULL,NULL,'Your {{period}} milk bill has {{deductions}} of deductions out of {{gross}} ({{lines}}). No payment goes out without your agreement — say yes or no in the app, or tell your centre. Krishalaya','DLT_DAIRY_CONSENT_EN',true),
 ('dairy.bill_deduction_consent_required','push','en',NULL,'Your agreement is needed','{{deductions}} of {{gross}} is being deducted from your {{period}} bill. Nothing is paid until you answer.',NULL,true),
 ('dairy.bill_deduction_consent_required','push','hi',NULL,'Aapki sehmati chahiye','{{period}} bill se {{gross}} me se {{deductions}} kat rahi hai. Aapke jawab tak bhugtan nahi hoga.',NULL,true),
 ('dairy.bill_deduction_consent_required','push','gu',NULL,'તમારી સંમતિ જોઈએ','{{period}} બિલમાંથી {{gross}} માંથી {{deductions}} કપાત થાય છે. તમારા જવાબ સુધી પેમેન્ટ નહીં થાય.',NULL,true),
 ('dairy.bill_deduction_consent_required','inapp','en',NULL,'Your agreement is needed','Your {{period}} bill is {{gross}} and {{deductions}} of it is being deducted: {{lines}}. That is more than {{threshold_pct}}% of the bill, so it cannot be paid until you agree. You can say no — the cooperative will then correct the bill or drop the deduction, and nothing moves meanwhile.',NULL,true),
 ('dairy.bill_deduction_consent_required','inapp','hi',NULL,'Aapki sehmati chahiye','{{period}} ka bill {{gross}} hai aur usme se {{deductions}} kat rahi hai: {{lines}}. Yah bill ke {{threshold_pct}}% se zyada hai, is liye aapki sehmati ke bina bhugtan nahi hoga. Aap na bhi keh sakte hain — tab samiti bill theek karegi ya katauti hatayegi, aur tab tak kuch nahi hilega.',NULL,true),
 ('dairy.bill_deduction_consent_required','inapp','gu',NULL,'તમારી સંમતિ જોઈએ','{{period}} નું બિલ {{gross}} છે અને તેમાંથી {{deductions}} કપાત થાય છે: {{lines}}. આ બિલના {{threshold_pct}}% થી વધુ છે, તેથી તમારી સંમતિ વગર પેમેન્ટ થશે નહીં. તમે ના પણ કહી શકો — તો સમિતિ બિલ સુધારશે અથવા કપાત હટાવશે, અને ત્યાં સુધી કંઈ હલશે નહીં.',NULL,true)
-- [PC-56 TENANT-6d-1] `ON CONFLICT` WITH NO TARGET, and that is the fix rather than a shortcut: the unique key is
-- (event_code, channel, language_code, tenant_id) and every row here has tenant_id NULL, so the four-column
-- inference matched NOTHING and a re-run of this file DUPLICATED every platform template (proven: 176 rows became
-- 277, 98 groups doubled). TENANT-6c-4 found the same NULL-key trap costing 139 duplicated lookup values.
-- Migration 0162 de-duplicates and adds a partial unique index for platform rows; an untargeted DO NOTHING is
-- what stays idempotent against BOTH indexes.
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.bill_deduction_consent_required', 'period',        'milk_bills.period_start..period_end',        '01-15 Jul', true),
 ('dairy.bill_deduction_consent_required', 'gross',         'milk_bills.gross_minor + currency',           'Rs 9,414',  true),
 ('dairy.bill_deduction_consent_required', 'deductions',    'milk_bills.deductions_minor + currency',      'Rs 2,400',  true),
 ('dairy.bill_deduction_consent_required', 'lines',         'milk_bill_deductions rows (type + amount)',   'feed credit Rs 500, loan Rs 1,900', true),
 ('dairy.bill_deduction_consent_required', 'threshold_pct', 'setting dairy.deduction_consent_pct',          '25',        true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-5 · THE ARRANGEMENT ITSELF — starting, and ending
-- ---------------------------------------------------------------------------------------------------------------
-- W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
--
-- 6c-4 seeded the ASK (a bill above the threshold needs an answer). These two are the other half of the sentence: a
-- routine deduction beginning, and one ending. Both matter for the same reason the ask does — an arrangement recorded
-- silently is indistinguishable from software helping itself, and a member who cannot see that they stopped it has no
-- evidence that stopping it worked.
--
-- `important` rather than `critical`: unlike the consent ask, no money is waiting on a reply. `user_can_opt_out =
-- false` all the same — a farmer who muted dairy notifications must still be told when a standing claim on their milk
-- cheque begins.
--
-- The copy names the INSTALMENT when there is one, because "we will deduct your feed credit" and "we will deduct Rs
-- 200 a fortnight" are different promises, and the second is the one a family can plan around.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('dairy.deduction_instruction_authorised', 'Milk bill deduction arranged', 'important', '["sms","push","inapp"]', false, false),
 ('dairy.deduction_instruction_revoked',    'Milk bill deduction stopped',  'important', '["sms","push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('dairy.deduction_instruction_authorised','sms','gu',NULL,NULL,'તમારા દૂધ બિલમાંથી {{what}} કપાત શરૂ થઈ ({{how_much}}). તમે ક્યારેય પણ બંધ કરાવી શકો છો — એપ પર અથવા તમારા કેન્દ્રને કહો. Krishalaya','DLT_DAIRY_INSTRUCTION_ON_GU',true),
 ('dairy.deduction_instruction_authorised','sms','hi',NULL,NULL,'Aapke doodh bill se {{what}} katauti shuru hui ({{how_much}}). Aap jab chahein band kara sakte hain — app par ya apne kendra ko kahein. Krishalaya','DLT_DAIRY_INSTRUCTION_ON_HI',true),
 ('dairy.deduction_instruction_authorised','sms','en',NULL,NULL,'Recovery of {{what}} from your milk bill has started ({{how_much}}). You can stop it whenever you like — in the app or by telling your centre. Krishalaya','DLT_DAIRY_INSTRUCTION_ON_EN',true),
 ('dairy.deduction_instruction_authorised','push','en',NULL,'Milk bill deduction arranged','{{what}} will now be recovered from your milk bill ({{how_much}}). You can stop it any time.',NULL,true),
 ('dairy.deduction_instruction_authorised','push','hi',NULL,'Katauti ki vyavastha hui','{{what}} ab aapke doodh bill se kategi ({{how_much}}). Jab chahein band kara sakte hain.',NULL,true),
 ('dairy.deduction_instruction_authorised','push','gu',NULL,'કપાતની વ્યવસ્થા થઈ','{{what}} હવે તમારા દૂધ બિલમાંથી કપાશે ({{how_much}}). જ્યારે ઇચ્છો બંધ કરાવી શકો.',NULL,true),
 ('dairy.deduction_instruction_authorised','inapp','en',NULL,'Milk bill deduction arranged','{{what}} will now be recovered from your milk bill, {{how_much}}. Nothing is deducted beyond what the cooperative may take without asking you again, and every bill shows the lines before it is paid. You can stop this arrangement at any time.',NULL,true),
 ('dairy.deduction_instruction_authorised','inapp','hi',NULL,'Katauti ki vyavastha hui','{{what}} ab aapke doodh bill se kategi, {{how_much}}. Samiti aapse phir se poochhe bina jitna le sakti hai usse zyada nahi katega, aur har bill bhugtan se pehle saari katautiyan dikhata hai. Yah vyavastha aap jab chahein band kara sakte hain.',NULL,true),
 ('dairy.deduction_instruction_authorised','inapp','gu',NULL,'કપાતની વ્યવસ્થા થઈ','{{what}} હવે તમારા દૂધ બિલમાંથી કપાશે, {{how_much}}. સમિતિ તમને ફરી પૂછ્યા વગર જેટલું લઈ શકે તેથી વધુ કપાશે નહીં, અને દરેક બિલ પેમેન્ટ પહેલાં બધી કપાત દર્શાવે છે. આ વ્યવસ્થા તમે જ્યારે ઇચ્છો બંધ કરાવી શકો છો.',NULL,true),
 ('dairy.deduction_instruction_revoked','sms','gu',NULL,NULL,'તમારા દૂધ બિલમાંથી {{what}} ની કપાત બંધ થઈ. બાકી રકમ હજુ બાકી છે — તમારા કેન્દ્ર સાથે વાત કરો. Krishalaya','DLT_DAIRY_INSTRUCTION_OFF_GU',true),
 ('dairy.deduction_instruction_revoked','sms','hi',NULL,NULL,'Aapke doodh bill se {{what}} ki katauti band ho gayi. Bakaya rakam abhi baki hai — apne kendra se baat karein. Krishalaya','DLT_DAIRY_INSTRUCTION_OFF_HI',true),
 ('dairy.deduction_instruction_revoked','sms','en',NULL,NULL,'Recovery of {{what}} from your milk bill has stopped. The balance is still owed — please speak to your centre. Krishalaya','DLT_DAIRY_INSTRUCTION_OFF_EN',true),
 ('dairy.deduction_instruction_revoked','push','en',NULL,'Milk bill deduction stopped','{{what}} will no longer be recovered from your milk bill. The balance is still owed.',NULL,true),
 ('dairy.deduction_instruction_revoked','push','hi',NULL,'Katauti band hui','{{what}} ab aapke doodh bill se nahi kategi. Bakaya rakam abhi baki hai.',NULL,true),
 ('dairy.deduction_instruction_revoked','push','gu',NULL,'કપાત બંધ થઈ','{{what}} હવે તમારા દૂધ બિલમાંથી કપાશે નહીં. બાકી રકમ હજુ બાકી છે.',NULL,true),
 ('dairy.deduction_instruction_revoked','inapp','en',NULL,'Milk bill deduction stopped','{{what}} will no longer be recovered from your milk bill. This stops the deduction, not the debt: the balance is still owed and your centre will discuss how to settle it.',NULL,true),
 ('dairy.deduction_instruction_revoked','inapp','hi',NULL,'Katauti band hui','{{what}} ab aapke doodh bill se nahi kategi. Isse katauti rukti hai, karz nahi: bakaya rakam abhi baki hai aur aapka kendra iske bhugtan par baat karega.',NULL,true),
 ('dairy.deduction_instruction_revoked','inapp','gu',NULL,'કપાત બંધ થઈ','{{what}} હવે તમારા દૂધ બિલમાંથી કપાશે નહીં. આનાથી કપાત બંધ થાય છે, દેવું નહીં: બાકી રકમ હજુ બાકી છે અને તમારું કેન્દ્ર તેની ચુકવણી વિશે વાત કરશે.',NULL,true)
-- [PC-56 TENANT-6d-1] `ON CONFLICT` WITH NO TARGET, and that is the fix rather than a shortcut: the unique key is
-- (event_code, channel, language_code, tenant_id) and every row here has tenant_id NULL, so the four-column
-- inference matched NOTHING and a re-run of this file DUPLICATED every platform template (proven: 176 rows became
-- 277, 98 groups doubled). TENANT-6c-4 found the same NULL-key trap costing 139 duplicated lookup values.
-- Migration 0162 de-duplicates and adds a partial unique index for platform rows; an untargeted DO NOTHING is
-- what stays idempotent against BOTH indexes.
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.deduction_instruction_authorised', 'what',     'lookup_values(milk_deduction).default_name + source', 'Feed / input credit', true),
 ('dairy.deduction_instruction_authorised', 'how_much', 'dairy_deduction_instructions.max_per_cycle_minor',    'Rs 200 per cycle',    true),
 ('dairy.deduction_instruction_revoked',    'what',     'lookup_values(milk_deduction).default_name + source', 'Feed / input credit', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-2 · **A PLACEHOLDER DLT ID IS NOT A REGISTRATION** (and TENANT-6b-1 shipped four that said it was)
-- ---------------------------------------------------------------------------------------------------------------
-- 0101 made this ruling and wrote the argument out: in India a transactional SMS template must be registered with the
-- DLT registry before it can be sent, `DLT_*` placeholders are not registrations, and *"leaving them active would mean
-- the platform believing it had texted a farmer while the aggregator silently rejected the send."* It deactivated its
-- own SMS rows accordingly.
--
-- **TENANT-6b-1 SEEDED SIX `DLT_DAIRY_FLAG_*` SMS ROWS AS `is_active = true`** — placeholders every one — in the wave
-- whose whole point was W168's *"member notified in Gujarati"*. This wave was about to add four more of exactly the
-- same shape. Both sets are deactivated here, on 0101's argument, and W169's promise is kept through the channels that
-- actually work: PUSH and IN-APP now exist in all three languages for all four dairy events, which they did not before
-- (6b-1's push/inapp rows were English-only, so a Gujarati farmer whose SMS silently failed would have been told in
-- English, or not at all).
--
-- The SMS wording stays in the table, inactive, because it IS the deliverable — reviewed in this pull request and ready
-- for the day the DLT ids are issued, which is one UPDATE per row (founder-key list, beside the email/voice provider
-- gap ADMIN-1e and ADMIN-2b named).
UPDATE notification_templates SET is_active = false
 WHERE channel = 'sms' AND tenant_id IS NULL
   AND provider_template_ref LIKE 'DLT_DAIRY_%';

-- ==================================================================================================================
-- PC-56 TENANT-6d-1 · **THE SMS LEG OF EVERY OPS ALERT HAS FAILED SINCE PC-55, AND THAT IS THE CHANNEL A VILLAGE
-- OPERATOR HAS.**
-- ==================================================================================================================
-- Following W170's promise - *"alerts fire to the operator's phone before the dairy loses a rupee"* - down to the
-- phone found this. Migration 0086 catalogued `ops.alert_fired` correctly and seeded its templates for `push` and
-- `inapp` in all three languages. Its `default_channels` are `["push","sms"]`.
--
-- **There has never been an SMS template.** `NotificationService.deliver` resolves a template per channel and, finding
-- none, calls `n.markFailed('no_template')` and increments `comm.no_template` - fail-closed, recorded, unsent. So every
-- cold-chain breach, silent sensor and overdue machine since A6 has produced a push (to whoever has the app) and a
-- FAILED SMS row. A dairy centre operator in Keshod has a feature phone; SMS was the channel that mattered, and it was
-- the one that could not render.
--
-- Seeded here rather than by editing 0086 (Law 9: never edit an applied migration), and idempotent by an untargeted
-- ON CONFLICT for the reason the block below this one explains.
--
-- What is NOT changed here, and is named instead: `user_can_opt_out = true` on this event, set by 0086. An operator who
-- muted notifications is not told their tank is warming. Flipping it is a change to every ops alert on the platform -
-- fleet, warehouse and dairy - and belongs to whoever owns that spine, not to a dairy wave.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('ops.alert_fired','sms','gu',NULL,NULL,'{{title}}: {{body}}',NULL,true),
 ('ops.alert_fired','sms','hi',NULL,NULL,'{{title}}: {{body}}',NULL,true),
 ('ops.alert_fired','sms','en',NULL,NULL,'{{title}}: {{body}}',NULL,true)
-- The body is deliberately GENERIC and driven by the rule that fired it: `ops_alert_rules` covers cold-chain breaches,
-- silent sensors and overdue machines, and `OpsAlertService` already composes the sentence (`hit.body`) from the
-- evidence it actually read. A template that re-worded it per kind would be a second copy of that logic, drifting.
ON CONFLICT DO NOTHING;


-- ==================================================================================================================
-- PC-56 TENANT-6d-5 · **THE CRITICAL OPS ALERT — THE ONE THAT IS ALLOWED TO WAKE SOMEBODY.**
-- ==================================================================================================================
-- Migration 0165 catalogued `ops.alert_critical` (priority `critical`, channels push + sms + ivr,
-- `user_can_opt_out = false`) for the defect it documents: `resolveChannels()` suppresses every intrusive channel
-- during a recipient's quiet hours unless the CATALOGUE event is `critical`, and `ops.alert_fired` is catalogued
-- `important`. So a tank breaching five times at two in the morning - `severityFor()`'s own `critical` verdict - was
-- held on push, SMS and voice until the quiet window ended, while W170 promised *"alerts fire to the operator's phone
-- before the dairy loses a rupee"*.
--
-- The event needs its copy here rather than in the migration, for the reason the note below this block explains: 0122's
-- send-time gate INNER JOINs the serving version, and only THIS file backfills version rows for seed-authored copy.
-- Nine rows - three channels x three languages.
--
-- THE IVR BODY IS THE SAME SENTENCE. A voice call reads the text out; a template that re-worded the alert for the ear
-- would be a second copy of `OpsAlertService`'s composed body (`hit.body`), drifting from the evidence it was built
-- from. The one difference is the punctuation of urgency: the title is spoken first either way, so the layout is left
-- to the channel and the wording to the rule that fired.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('ops.alert_critical','push','en',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_critical','push','hi',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_critical','push','gu',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_critical','sms','en',NULL,NULL,'{{title}}: {{body}}',NULL,true),
 ('ops.alert_critical','sms','hi',NULL,NULL,'{{title}}: {{body}}',NULL,true),
 ('ops.alert_critical','sms','gu',NULL,NULL,'{{title}}: {{body}}',NULL,true),
 ('ops.alert_critical','ivr','en',NULL,NULL,'{{title}}. {{body}}',NULL,true),
 ('ops.alert_critical','ivr','hi',NULL,NULL,'{{title}}. {{body}}',NULL,true),
 ('ops.alert_critical','ivr','gu',NULL,NULL,'{{title}}. {{body}}',NULL,true)
ON CONFLICT DO NOTHING;

-- AND THE VOICE LEG OF THE ORDINARY OPS ALERT IS *NOT* SEEDED. `ops.alert_fired`'s `default_channels` are
-- `["push","sms"]` (0086) and this file does not widen them: a warning-level alert that phones somebody is exactly the
-- alert that gets muted, and muting is how the critical one stops being heard too. The voice channel belongs to the
-- event that earned it.

-- ==================================================================================================================
-- PC-56 TENANT-6d-8 · **THE NOTICE** — W170's *"route notice to 87 pourers, Gujarati voice"*
-- ==================================================================================================================
-- 0166 catalogued `dairy.shift_diverted` and said in its own text that it does not tell the members. 0167 catalogues
-- the RETRACTION (`dairy.shift_diversion_cancelled`) and adds the in-app leg to both. This is the copy, and it is the
-- first copy in this file written AFTER TENANT-6d-7 — so it can rely on two things no earlier notice could:
--
--   • the member reads it IN THEIR OWN LANGUAGE (`users.language_code`, read per recipient since 6d-7);
--   • `{{shift}}` is a PER-LANGUAGE VALUE, so the Gujarati body says *સાંજ* and not *evening*.
--
-- FOUR VARIABLES, ALL REQUIRED, ALL DECLARED BELOW: the member's own centre, the centre the milk is going to, the day
-- in digits, and the shift as a word. No optional token appears in any body — an optional variable is a sentence that
-- sometimes has a hole in it, which is the defect 6d-7 spent a whole wave removing.
--
-- THE DAY IS PRINTED EVEN WHEN IT IS TODAY. A diversion may be signed for up to a week ahead (6d-6's MAX_DAYS_AHEAD),
-- and *"tonight"* in a message read the next morning is worse than a date. Digits, because a month name is a word this
-- platform holds in no language (see domain/dairy-notice-vars.ts).
--
-- THE IVR BODY IS NOT THE SMS BODY. A voice call is heard once, by somebody who may be milking; it says the
-- instruction, then says it again. The SMS is read and re-read, so it is compact and ends with the cooperative's name
-- (the DLT convention every other transactional row in this file follows). `provider_template_ref` is NULL rather than
-- a `DLT_*` placeholder: 0101's ruling and 6c-2's finding — a placeholder is not a registration, and a row that
-- claims one would have the platform believing it had texted a farmer while the aggregator silently rejected the send.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 -- ---- THE DIVERSION: tonight's milk goes to another village -----------------------------------------------------
 ('dairy.shift_diverted','ivr','gu',NULL,NULL,'ધ્યાન આપો. {{day}} ના {{shift}} નું દૂધ {{from}} કેન્દ્ર પર લેવામાં આવશે નહીં. તમારું દૂધ {{to}} કેન્દ્ર પર આપો. ફરીથી — {{day}} ના {{shift}} નું દૂધ {{to}} કેન્દ્ર પર આપો.',NULL,true),
 ('dairy.shift_diverted','ivr','hi',NULL,NULL,'Dhyan dein. {{day}} ke {{shift}} ka doodh {{from}} par nahin liya jayega. Aapka doodh {{to}} par dein. Dobara — {{day}} ke {{shift}} ka doodh {{to}} par dein.',NULL,true),
 ('dairy.shift_diverted','ivr','en',NULL,NULL,'Please note. The {{shift}} collection on {{day}} will not be taken at {{from}}. Bring your milk to {{to}}. Again — on {{day}}, bring the {{shift}} milk to {{to}}.',NULL,true),
 ('dairy.shift_diverted','sms','gu',NULL,NULL,'{{day}} ના {{shift}} નું દૂધ {{from}} ને બદલે {{to}} કેન્દ્ર પર આપો. બાકી બધું એ જ રહેશે. Krishalaya',NULL,true),
 ('dairy.shift_diverted','sms','hi',NULL,NULL,'{{day}} ke {{shift}} ka doodh {{from}} ki jagah {{to}} par dein. Baaki sab wahi rahega. Krishalaya',NULL,true),
 ('dairy.shift_diverted','sms','en',NULL,NULL,'On {{day}}, bring the {{shift}} milk to {{to}} instead of {{from}}. Everything else stays the same. Krishalaya',NULL,true),
 ('dairy.shift_diverted','push','gu',NULL,'દૂધ {{to}} કેન્દ્ર પર આપો','{{day}} ના {{shift}} નું દૂધ {{from}} ને બદલે {{to}} કેન્દ્ર પર લેવાશે.',NULL,true),
 ('dairy.shift_diverted','push','hi',NULL,'Doodh {{to}} par dein','{{day}} ke {{shift}} ka doodh {{from}} ki jagah {{to}} par liya jayega.',NULL,true),
 ('dairy.shift_diverted','push','en',NULL,'Bring your milk to {{to}}','The {{shift}} collection on {{day}} moves from {{from}} to {{to}}.',NULL,true),
 ('dairy.shift_diverted','inapp','gu',NULL,'દૂધ {{to}} કેન્દ્ર પર આપો','{{day}} ના {{shift}} નું દૂધ {{from}} ને બદલે {{to}} કેન્દ્ર પર લેવાશે. તમારું સભ્યપદ અને તમારું કેન્દ્ર બદલાયું નથી.',NULL,true),
 ('dairy.shift_diverted','inapp','hi',NULL,'Doodh {{to}} par dein','{{day}} ke {{shift}} ka doodh {{from}} ki jagah {{to}} par liya jayega. Aapki membership aur aapka kendra nahin badla hai.',NULL,true),
 ('dairy.shift_diverted','inapp','en',NULL,'Bring your milk to {{to}}','The {{shift}} collection on {{day}} moves from {{from}} to {{to}}. Your membership and your own centre have not changed.',NULL,true),

 -- ---- THE RETRACTION: it is back at your own centre after all ---------------------------------------------------
 -- *"Your membership has not changed"* is in the body on purpose, in both events. A message telling a family to pour
 -- somewhere else is the single most alarming thing this platform can send a member — a diversion is NOT a transfer
 -- (0166's own words) and the sentence that says so belongs in the notice, not only in the schema.
 ('dairy.shift_diversion_cancelled','ivr','gu',NULL,NULL,'ધ્યાન આપો. {{day}} ના {{shift}} નું દૂધ {{to}} કેન્દ્ર પર લઈ જવાનું નથી. તમારું દૂધ {{from}} કેન્દ્ર પર જ આપો. ફરીથી — {{day}} ના {{shift}} નું દૂધ {{from}} કેન્દ્ર પર જ આપો.',NULL,true),
 ('dairy.shift_diversion_cancelled','ivr','hi',NULL,NULL,'Dhyan dein. {{day}} ke {{shift}} ka doodh {{to}} par le jaane ki zaroorat nahin hai. Aapka doodh {{from}} par hi dein. Dobara — {{day}} ke {{shift}} ka doodh {{from}} par hi dein.',NULL,true),
 ('dairy.shift_diversion_cancelled','ivr','en',NULL,NULL,'Please note. The {{shift}} collection on {{day}} is NOT moving to {{to}}. Bring your milk to {{from}} as usual. Again — on {{day}}, bring the {{shift}} milk to {{from}}.',NULL,true),
 ('dairy.shift_diversion_cancelled','sms','gu',NULL,NULL,'બદલાવ રદ. {{day}} ના {{shift}} નું દૂધ {{from}} કેન્દ્ર પર જ આપો — {{to}} પર જવાની જરૂર નથી. Krishalaya',NULL,true),
 ('dairy.shift_diversion_cancelled','sms','hi',NULL,NULL,'Badlav radd. {{day}} ke {{shift}} ka doodh {{from}} par hi dein — {{to}} jaane ki zaroorat nahin. Krishalaya',NULL,true),
 ('dairy.shift_diversion_cancelled','sms','en',NULL,NULL,'Change cancelled. On {{day}}, bring the {{shift}} milk to {{from}} as usual — no need to go to {{to}}. Krishalaya',NULL,true),
 ('dairy.shift_diversion_cancelled','push','gu',NULL,'{{from}} કેન્દ્ર પર જ આપો','{{day}} ના {{shift}} નું દૂધ {{to}} પર લઈ જવાનું નથી.',NULL,true),
 ('dairy.shift_diversion_cancelled','push','hi',NULL,'{{from}} par hi dein','{{day}} ke {{shift}} ka doodh {{to}} par le jaane ki zaroorat nahin.',NULL,true),
 ('dairy.shift_diversion_cancelled','push','en',NULL,'Bring your milk to {{from}}','The {{shift}} collection on {{day}} is not moving to {{to}} after all.',NULL,true),
 ('dairy.shift_diversion_cancelled','inapp','gu',NULL,'{{from}} કેન્દ્ર પર જ આપો','{{day}} ના {{shift}} નું દૂધ {{to}} પર લઈ જવાનું નથી. તમારું સભ્યપદ અને તમારું કેન્દ્ર બદલાયું નથી.',NULL,true),
 ('dairy.shift_diversion_cancelled','inapp','hi',NULL,'{{from}} par hi dein','{{day}} ke {{shift}} ka doodh {{to}} par le jaane ki zaroorat nahin. Aapki membership aur aapka kendra nahin badla hai.',NULL,true),
 ('dairy.shift_diversion_cancelled','inapp','en',NULL,'Bring your milk to {{from}}','The {{shift}} collection on {{day}} is not moving to {{to}} after all. Your membership and your own centre have not changed.',NULL,true)
ON CONFLICT DO NOTHING;

-- THE DECLARED CONTRACT, which since TENANT-6d-7 is CHECKED: `tenant6d7-notice-words.spec.ts` renders every one of the
-- bodies above against the variables the emitter really produces and fails on a blank, a JSON dump, an English enum in
-- vernacular copy, or a required declaration no body uses. Four variables, four uses, no optional tokens.
INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.shift_diverted',           'from',  'mcc_centres.default_name (the member''s own centre)', 'Vanthali', true),
 ('dairy.shift_diverted',           'to',    'mcc_centres.default_name (the centre taking the shift)', 'Bhesan', true),
 ('dairy.shift_diverted',           'day',   'dairy_shift_diversions.diverted_on (digits, DD/MM)',  '21/08',    true),
 ('dairy.shift_diverted',           'shift', 'dairy_shift_diversions.shift (localized)',            'evening',  true),
 ('dairy.shift_diversion_cancelled','from',  'mcc_centres.default_name (the member''s own centre)', 'Vanthali', true),
 ('dairy.shift_diversion_cancelled','to',    'mcc_centres.default_name (the centre that was to take it)', 'Bhesan', true),
 ('dairy.shift_diversion_cancelled','day',   'dairy_shift_diversions.diverted_on (digits, DD/MM)',  '21/08',    true),
 ('dairy.shift_diversion_cancelled','shift', 'dairy_shift_diversions.shift (localized)',            'evening',  true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-6e-2 · **THE EXPORT** — W2553/W2554: *"you will find the file on the ready page"*
-- ==================================================================================================================
-- 0169.4 catalogues `exports.export_ready` (inapp + push, opt-out allowed — a courtesy, not a safety notice). The
-- worker emits it in the SAME transaction that marks a job ready. Three variables, all required, all used in every
-- body: `dataset` is a PER-LANGUAGE value read from `ui_messages` (seed 0017) so the Gujarati notice does not carry
-- the platform code `dairy.insights`; `rows` is digits (DATA rows — the header is not a row, and the receipt says the
-- same); `file` is the file name exactly as the receipt prints it, so the person can match the notice to the page.
--
-- NO LINK IN THE COPY. The download link is minted on the ready page and lives fifteen minutes; a link in a
-- notification read the next morning would be a dead one, and the platform holds no per-tenant console origin to
-- build one from anyway. The notice says where the file IS, which is the sentence W2553 itself uses.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('exports.export_ready','push','gu',NULL,'તમારી {{dataset}} ફાઇલ તૈયાર છે','{{file}} — {{rows}} હરોળ. ફાઇલ કન્સોલના "એક્સપોર્ટ તૈયાર" પેજ પર છે.',NULL,true),
 ('exports.export_ready','push','hi',NULL,'Aapki {{dataset}} file taiyaar hai','{{file}} — {{rows}} rows. File console ke "Export ready" page par hai.',NULL,true),
 ('exports.export_ready','push','en',NULL,'Your {{dataset}} export is ready','{{file}} — {{rows}} rows. Find it on the console''s "Export ready" page.',NULL,true),
 ('exports.export_ready','inapp','gu',NULL,'તમારી {{dataset}} ફાઇલ તૈયાર છે','{{file}} — {{rows}} હરોળ. ફાઇલ કન્સોલના "એક્સપોર્ટ તૈયાર" પેજ પર છે; ડાઉનલોડ લિંક ત્યાંથી બનાવો, તે 15 મિનિટ માટે માન્ય રહે છે.',NULL,true),
 ('exports.export_ready','inapp','hi',NULL,'Aapki {{dataset}} file taiyaar hai','{{file}} — {{rows}} rows. File console ke "Export ready" page par hai; download link wahin se banayein, woh 15 minute tak maanya rahega.',NULL,true),
 ('exports.export_ready','inapp','en',NULL,'Your {{dataset}} export is ready','{{file}} — {{rows}} rows. Find it on the console''s "Export ready" page; make the download link there — it is valid for 15 minutes.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('exports.export_ready', 'dataset', 'ui_messages exports.dataset.<tenant_export_jobs.dataset_code> (localized)', 'dairy insights', true),
 ('exports.export_ready', 'rows',    'tenant_export_jobs.row_count (digits, DATA rows)',                          '27',             true),
 ('exports.export_ready', 'file',    'tenant_export_jobs.file_name',                                              'dairy-insights-90d-2026-09-10.csv', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-7c · **THE LIVE CLASS** — W414: *"Reminder cadence — important tier — 1 day, 1 hour, 10 min before"*
-- ==================================================================================================================
-- 0172.7 catalogues `education.live_reminder` (push + inapp, opt-out allowed — a reminder is a courtesy). The education
-- module's REGISTERED cadence job (`education-live-reminders`) claims each (class, offset) once through a UNIQUE row and
-- emits the event in the same transaction with the class's REGISTERED members as recipients. Three variables, all
-- required, all used in every body: `title` is the class title as the host typed it; `day` is DD/MM and `time` HH:MM —
-- the wall-clock the DATABASE resolved in the cooperative's own timezone (6c-1's resolution), so a class at 20:30 in
-- Anand reads 20:30 to a member in Anand. NO ENUM IN THE COPY: the offset ("a day before", "an hour before") is not a
-- token — the kinds share one body, because a member reading "starts at 20:30 on 16/07" needs no second sentence.
-- NO LINK IN THE COPY: the join link is shown on the class page inside the join window, to registered members only;
-- a link in a notification read by anyone who picks up the phone would be a link to a room the class is being held in.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('education.live_reminder','push','gu',NULL,'જીવંત વર્ગ: {{title}}','{{day}} ના રોજ {{time}} વાગ્યે શરૂ થાય છે. જોડાવાની લિંક વર્ગના પેજ પર છે.',NULL,true),
 ('education.live_reminder','push','hi',NULL,'Live class: {{title}}','{{day}} ko {{time}} baje shuru hogi. Judne ki link class ke page par hai.',NULL,true),
 ('education.live_reminder','push','en',NULL,'Live class: {{title}}','Starts at {{time}} on {{day}}. The join link is on the class page.',NULL,true),
 ('education.live_reminder','inapp','gu',NULL,'જીવંત વર્ગ: {{title}}','{{day}} ના રોજ {{time}} વાગ્યે શરૂ થાય છે. જોડાવાની લિંક વર્ગના પેજ પર છે; તે વર્ગની 15 મિનિટ પહેલાં ખુલે છે.',NULL,true),
 ('education.live_reminder','inapp','hi',NULL,'Live class: {{title}}','{{day}} ko {{time}} baje shuru hogi. Judne ki link class ke page par hai; woh class se 15 minute pehle khulti hai.',NULL,true),
 ('education.live_reminder','inapp','en',NULL,'Live class: {{title}}','Starts at {{time}} on {{day}}. The join link is on the class page; it opens 15 minutes before the class.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('education.live_reminder', 'title', 'live_sessions.title',                                                    'Mastitis: spot it early', true),
 ('education.live_reminder', 'day',   'live_sessions.scheduled_at AT TIME ZONE the tenant country''s zone (digits, DD/MM)', '16/07',            true),
 ('education.live_reminder', 'time',  'live_sessions.scheduled_at AT TIME ZONE the tenant country''s zone (digits, HH:MM)', '20:30',            true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-8e · **THE BROADCAST HAD NO WORDS TO SEND IN** — W429 / F-2
-- ==================================================================================================================
-- `tenant.broadcast` (promotional, push + in-app, opt-out-able) was catalogued in PC-27 and NO template was ever seeded
-- for it, so every push leg of every broadcast recorded `failed · no_template` — and the handler marked the broadcast
-- `sent` regardless. These six are the FRAME a cooperative's announcement is delivered in, in en · hi · gu: the subject
-- says it is an announcement from the cooperative, the body is the cooperative's own words exactly as written
-- (`{{body}}`). The words themselves are ONE text in whatever language the cooperative wrote them — a per-language
-- announcement is not modelled (named in the 8e report). 0179's `broadcast_template_gaps()` refuses to queue a broadcast
-- while any of these six does not serve, so a missing row is a refusal at enqueue, never a `no_template` per member.
-- No link in the copy: the in-app item IS the announcement.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('tenant.broadcast','push','en',NULL,'Announcement: {{title}}','{{body}}',NULL,true),
 ('tenant.broadcast','push','hi',NULL,'सूचना: {{title}}','{{body}}',NULL,true),
 ('tenant.broadcast','push','gu',NULL,'સૂચના: {{title}}','{{body}}',NULL,true),
 ('tenant.broadcast','inapp','en',NULL,'Announcement: {{title}}','{{body}}',NULL,true),
 ('tenant.broadcast','inapp','hi',NULL,'सूचना: {{title}}','{{body}}',NULL,true),
 ('tenant.broadcast','inapp','gu',NULL,'સૂચના: {{title}}','{{body}}',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('tenant.broadcast', 'title', 'tenant_broadcasts.title (the cooperative''s own words, plain text, ≤160)', 'Mandi closed on Monday', true),
 ('tenant.broadcast', 'body',  'tenant_broadcasts.body (the cooperative''s own words, plain text, ≤2000)',  'The mandi yard is closed for cleaning on Monday. Bring your produce on Tuesday from 7am.', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-9a · **THE KYC DESK** — W122: *"you are notified either way, with reasons if rejected"*; W121: *"renewal
-- reminders sent in Gujarati"* (F-15)
-- ==================================================================================================================
-- The outbox events `identity.kyc_verified / kyc_rejected / kyc_expiring / kyc_expired` had no consumer and no catalogue
-- row, so nobody was ever told. Four catalogued events now (push + in-app, opt-out allowed: a courtesy, the desk and the
-- money gate are the control), bridged in `notification-event-map.ts`. The recipient is the person the document is about —
-- for an ORGANISATION document, the person who submitted it. Variables: `document` is a PER-LANGUAGE value from
-- `ui_messages` (seed 0019, `kyc.doc_type.<code>`), `reason` likewise (`kyc.reason.<code>`), `day` the date in DD/MM/YYYY.
-- No link and no document number in the copy: a notice read by whoever picks up the phone names the document, not its number.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('kyc.approved', 'KYC document verified',          'important', '["push","inapp"]', true, false),
 ('kyc.rejected', 'KYC document needs attention',   'important', '["push","inapp"]', true, false),
 ('kyc.expiring', 'KYC document expires soon',      'important', '["push","inapp"]', true, false),
 ('kyc.expired',  'KYC document expired',           'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('kyc.approved','push','en',NULL,'Verified: {{document}}','Your {{document}} has been verified.',NULL,true),
 ('kyc.approved','push','hi',NULL,'सत्यापित: {{document}}','आपका {{document}} सत्यापित हो गया है।',NULL,true),
 ('kyc.approved','push','gu',NULL,'ચકાસાયેલ: {{document}}','તમારું {{document}} ચકાસાઈ ગયું છે.',NULL,true),
 ('kyc.approved','inapp','en',NULL,'Verified: {{document}}','Your {{document}} has been verified.',NULL,true),
 ('kyc.approved','inapp','hi',NULL,'सत्यापित: {{document}}','आपका {{document}} सत्यापित हो गया है।',NULL,true),
 ('kyc.approved','inapp','gu',NULL,'ચકાસાયેલ: {{document}}','તમારું {{document}} ચકાસાઈ ગયું છે.',NULL,true),
 ('kyc.rejected','push','en',NULL,'Action needed: {{document}}','Your {{document}} was not accepted: {{reason}}. Please submit it again.',NULL,true),
 ('kyc.rejected','push','hi',NULL,'कार्रवाई ज़रूरी: {{document}}','आपका {{document}} स्वीकार नहीं हुआ: {{reason}}। कृपया दोबारा जमा करें।',NULL,true),
 ('kyc.rejected','push','gu',NULL,'પગલું જરૂરી: {{document}}','તમારું {{document}} સ્વીકારાયું નથી: {{reason}}. કૃપા કરી ફરી જમા કરો.',NULL,true),
 ('kyc.rejected','inapp','en',NULL,'Action needed: {{document}}','Your {{document}} was not accepted: {{reason}}. Please submit it again.',NULL,true),
 ('kyc.rejected','inapp','hi',NULL,'कार्रवाई ज़रूरी: {{document}}','आपका {{document}} स्वीकार नहीं हुआ: {{reason}}। कृपया दोबारा जमा करें।',NULL,true),
 ('kyc.rejected','inapp','gu',NULL,'પગલું જરૂરી: {{document}}','તમારું {{document}} સ્વીકારાયું નથી: {{reason}}. કૃપા કરી ફરી જમા કરો.',NULL,true),
 ('kyc.expiring','push','en',NULL,'Renew soon: {{document}}','Your {{document}} is valid until {{day}}. Upload the renewal before then — the current one keeps working until it lapses.',NULL,true),
 ('kyc.expiring','push','hi',NULL,'जल्द नवीनीकरण करें: {{document}}','आपका {{document}} {{day}} तक मान्य है। उससे पहले नवीनीकरण अपलोड करें — मौजूदा दस्तावेज़ तब तक काम करता रहेगा।',NULL,true),
 ('kyc.expiring','push','gu',NULL,'જલ્દી નવીનીકરણ કરો: {{document}}','તમારું {{document}} {{day}} સુધી માન્ય છે. તે પહેલાં નવીનીકરણ અપલોડ કરો — હાલનું ત્યાં સુધી ચાલુ રહેશે.',NULL,true),
 ('kyc.expiring','inapp','en',NULL,'Renew soon: {{document}}','Your {{document}} is valid until {{day}}. Upload the renewal before then — the current one keeps working until it lapses.',NULL,true),
 ('kyc.expiring','inapp','hi',NULL,'जल्द नवीनीकरण करें: {{document}}','आपका {{document}} {{day}} तक मान्य है। उससे पहले नवीनीकरण अपलोड करें — मौजूदा दस्तावेज़ तब तक काम करता रहेगा।',NULL,true),
 ('kyc.expiring','inapp','gu',NULL,'જલ્દી નવીનીકરણ કરો: {{document}}','તમારું {{document}} {{day}} સુધી માન્ય છે. તે પહેલાં નવીનીકરણ અપલોડ કરો — હાલનું ત્યાં સુધી ચાલુ રહેશે.',NULL,true),
 ('kyc.expired','push','en',NULL,'Expired: {{document}}','Your {{document}} lapsed on {{day}}. Upload the renewed document to restore it.',NULL,true),
 ('kyc.expired','push','hi',NULL,'समाप्त: {{document}}','आपका {{document}} {{day}} को समाप्त हो गया। इसे बहाल करने के लिए नवीनीकृत दस्तावेज़ अपलोड करें।',NULL,true),
 ('kyc.expired','push','gu',NULL,'સમાપ્ત: {{document}}','તમારું {{document}} {{day}} ના રોજ સમાપ્ત થયું. ફરી ચાલુ કરવા નવીનીકૃત દસ્તાવેજ અપલોડ કરો.',NULL,true),
 ('kyc.expired','inapp','en',NULL,'Expired: {{document}}','Your {{document}} lapsed on {{day}}. Upload the renewed document to restore it.',NULL,true),
 ('kyc.expired','inapp','hi',NULL,'समाप्त: {{document}}','आपका {{document}} {{day}} को समाप्त हो गया। इसे बहाल करने के लिए नवीनीकृत दस्तावेज़ अपलोड करें।',NULL,true),
 ('kyc.expired','inapp','gu',NULL,'સમાપ્ત: {{document}}','તમારું {{document}} {{day}} ના રોજ સમાપ્ત થયું. ફરી ચાલુ કરવા નવીનીકૃત દસ્તાવેજ અપલોડ કરો.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('kyc.approved', 'document', 'ui_messages kyc.doc_type.<kyc_documents.doc_type_code> (localized)', 'FSSAI licence', true),
 ('kyc.rejected', 'document', 'ui_messages kyc.doc_type.<kyc_documents.doc_type_code> (localized)', 'Aadhaar', true),
 ('kyc.rejected', 'reason',   'ui_messages kyc.reason.<kyc_documents.reason_code> (localized)',     'the photo is blurry or unreadable', true),
 ('kyc.expiring', 'document', 'ui_messages kyc.doc_type.<kyc_documents.doc_type_code> (localized)', 'FSSAI licence', true),
 ('kyc.expiring', 'day',      'kyc_documents.valid_until (digits, DD/MM/YYYY)',                     '30/09/2026', true),
 ('kyc.expired',  'document', 'ui_messages kyc.doc_type.<kyc_documents.doc_type_code> (localized)', 'FSSAI licence', true),
 ('kyc.expired',  'day',      'kyc_documents.valid_until (digits, DD/MM/YYYY)',                     '30/09/2026', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-9b · **THE RESOLUTIONS** — W198: *"Notice in-app + SMS + voice call"*, *"results published to all
-- members"* (F-15)
-- ==================================================================================================================
-- Opening and closing a vote told nobody. Two catalogued events now (push + in-app; `important`; opt-out allowed — the
-- notice is a courtesy, the vote's record is the control), bridged in `notification-event-map.ts`; recipients = every active
-- member. Variables: `title` (the resolution's own text, plain), `closes` (DD/MM/YYYY HH:MM in the cooperative's zone, or the
-- per-language "when the board closes voting" from seed 0020), `result` (per-language, seed 0020 `governance.outcome.*`),
-- `for` / `against` / `abstain` (digits), `turnout` (digits + %). SMS and the voice call are NOT here: no DLT template, no
-- voice provider (TENANT-1e-Q3, named). `resolution.closing_soon` is not catalogued — the canon draws no closing reminder.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('resolution.opened', 'Voting opened on a resolution', 'important', '["push","inapp"]', true, false),
 ('resolution.closed', 'A resolution''s result',        'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('resolution.opened','push','en',NULL,'Vote now: {{title}}','Voting is open on "{{title}}". Vote in the app before {{closes}} — you can change your vote until it closes.',NULL,true),
 ('resolution.opened','push','hi',NULL,'अभी मतदान करें: {{title}}','"{{title}}" पर मतदान खुला है। {{closes}} से पहले ऐप में मतदान करें — बंद होने तक आप अपना मत बदल सकते हैं।',NULL,true),
 ('resolution.opened','push','gu',NULL,'હમણાં મત આપો: {{title}}','"{{title}}" પર મતદાન ખુલ્લું છે. {{closes}} પહેલાં એપમાં મત આપો — બંધ થાય ત્યાં સુધી તમે તમારો મત બદલી શકો છો.',NULL,true),
 ('resolution.opened','inapp','en',NULL,'Vote now: {{title}}','Voting is open on "{{title}}". Vote in the app before {{closes}} — you can change your vote until it closes.',NULL,true),
 ('resolution.opened','inapp','hi',NULL,'अभी मतदान करें: {{title}}','"{{title}}" पर मतदान खुला है। {{closes}} से पहले ऐप में मतदान करें — बंद होने तक आप अपना मत बदल सकते हैं।',NULL,true),
 ('resolution.opened','inapp','gu',NULL,'હમણાં મત આપો: {{title}}','"{{title}}" પર મતદાન ખુલ્લું છે. {{closes}} પહેલાં એપમાં મત આપો — બંધ થાય ત્યાં સુધી તમે તમારો મત બદલી શકો છો.',NULL,true),
 ('resolution.closed','push','en',NULL,'Result: {{title}}','"{{title}}" — {{result}}. For {{for}}, against {{against}}, abstain {{abstain}}; turnout {{turnout}}.',NULL,true),
 ('resolution.closed','push','hi',NULL,'परिणाम: {{title}}','"{{title}}" — {{result}}। पक्ष में {{for}}, विपक्ष में {{against}}, तटस्थ {{abstain}}; मतदान {{turnout}}।',NULL,true),
 ('resolution.closed','push','gu',NULL,'પરિણામ: {{title}}','"{{title}}" — {{result}}. તરફેણમાં {{for}}, વિરુદ્ધ {{against}}, તટસ્થ {{abstain}}; મતદાન {{turnout}}.',NULL,true),
 ('resolution.closed','inapp','en',NULL,'Result: {{title}}','"{{title}}" — {{result}}. For {{for}}, against {{against}}, abstain {{abstain}}; turnout {{turnout}}.',NULL,true),
 ('resolution.closed','inapp','hi',NULL,'परिणाम: {{title}}','"{{title}}" — {{result}}। पक्ष में {{for}}, विपक्ष में {{against}}, तटस्थ {{abstain}}; मतदान {{turnout}}।',NULL,true),
 ('resolution.closed','inapp','gu',NULL,'પરિણામ: {{title}}','"{{title}}" — {{result}}. તરફેણમાં {{for}}, વિરુદ્ધ {{against}}, તટસ્થ {{abstain}}; મતદાન {{turnout}}.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('resolution.opened', 'title',   'coop_resolutions.title (plain text)',                                      'Patronage bonus FY 2025-26', true),
 ('resolution.opened', 'closes',  'coop_resolutions.voting_closes in countries.timezone (DD/MM/YYYY HH:MM), else ui_messages governance.notice.no_close', '19/07/2026 18:00', true),
 ('resolution.closed', 'title',   'coop_resolutions.title (plain text)',                                      'Patronage bonus FY 2025-26', true),
 ('resolution.closed', 'result',  'ui_messages governance.outcome.<coop_resolutions.outcome> (localized)',     'passed', true),
 ('resolution.closed', 'for',     'count of coop_votes choice for (digits)',                                  '574', true),
 ('resolution.closed', 'against', 'count of coop_votes choice against (digits)',                              '31', true),
 ('resolution.closed', 'abstain', 'count of coop_votes choice abstain (digits)',                              '13', true),
 ('resolution.closed', 'turnout', 'cast / eligible_at_close (digits + %)',                                    '52%', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-11a · **THE AUCTION OUTCOMES REACH THE PEOPLE THEY AFFECT.** Before this wave the only auction notices were
-- "outbid" and "an auction you watched ended" (survey F-10): a bidder whose live auction was cancelled was never told why,
-- a winner was never told they won (`bid.won` was catalogued in 0068 with NO template — it could never send), and a seller
-- learned of a failed reserve from nothing. Migration 0186 catalogues four events; their copy lives HERE, above the
-- version backfill below, for the reason that note gives (0122's send-time gate INNER JOINs the serving version). Every
-- variable comes from the outbox payload: `auctionNo` (AUC-…), `title` (the listing title at the time), `reason` (the
-- tenant_admin's words, verbatim — a cancellation reason is the bidders' to read, not ours to paraphrase).
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('bid.won','push','en',NULL,'You won {{auctionNo}}','You won the auction for {{title}}. Your EMD is applied to the order; pay the balance within 48 hours or the EMD is forfeited to the seller.',NULL,true),
 ('bid.won','push','hi',NULL,'आप {{auctionNo}} जीत गए','आपने {{title}} की नीलामी जीती। आपकी EMD ऑर्डर में लगा दी गई है; बाकी राशि 48 घंटे में चुकाएँ, वरना EMD विक्रेता को ज़ब्त हो जाएगी।',NULL,true),
 ('bid.won','push','gu',NULL,'તમે {{auctionNo}} જીત્યા','તમે {{title}} ની હરાજી જીતી. તમારી EMD ઓર્ડરમાં લાગુ થઈ છે; બાકી રકમ 48 કલાકમાં ચૂકવો, નહીં તો EMD વેચનારને જપ્ત થશે.',NULL,true),
 ('bid.won','sms','en',NULL,NULL,'Krishalaya: you won {{auctionNo}} ({{title}}). EMD applied; pay the balance within 48 h or the EMD is forfeited to the seller.',NULL,true),
 ('bid.won','sms','hi',NULL,NULL,'कृषालय: आप {{auctionNo}} ({{title}}) जीत गए। EMD लगा दी गई; बाकी 48 घंटे में चुकाएँ वरना EMD विक्रेता को ज़ब्त।',NULL,true),
 ('bid.won','sms','gu',NULL,NULL,'કૃષાલય: તમે {{auctionNo}} ({{title}}) જીત્યા. EMD લાગુ; બાકી 48 કલાકમાં ચૂકવો નહીં તો EMD વેચનારને જપ્ત.',NULL,true),
 ('auction.cancelled','push','en',NULL,'{{auctionNo}} was cancelled','The auction for {{title}} was cancelled: {{reason}}. Every bid is void and your EMD has been returned to your wallet.',NULL,true),
 ('auction.cancelled','push','hi',NULL,'{{auctionNo}} रद्द हुई','{{title}} की नीलामी रद्द कर दी गई: {{reason}}। हर बोली रद्द है और आपकी EMD आपके वॉलेट में लौटा दी गई है।',NULL,true),
 ('auction.cancelled','push','gu',NULL,'{{auctionNo}} રદ થઈ','{{title}} ની હરાજી રદ કરવામાં આવી: {{reason}}. દરેક બોલી રદ છે અને તમારી EMD તમારા વૉલેટમાં પાછી આપવામાં આવી છે.',NULL,true),
 ('auction.cancelled','inapp','en',NULL,'{{auctionNo}} was cancelled','The auction for {{title}} was cancelled: {{reason}}. Every bid is void and your EMD has been returned to your wallet.',NULL,true),
 ('auction.cancelled','inapp','hi',NULL,'{{auctionNo}} रद्द हुई','{{title}} की नीलामी रद्द कर दी गई: {{reason}}। हर बोली रद्द है और आपकी EMD आपके वॉलेट में लौटा दी गई है।',NULL,true),
 ('auction.cancelled','inapp','gu',NULL,'{{auctionNo}} રદ થઈ','{{title}} ની હરાજી રદ કરવામાં આવી: {{reason}}. દરેક બોલી રદ છે અને તમારી EMD તમારા વૉલેટમાં પાછી આપવામાં આવી છે.',NULL,true),
 ('auction.failed_reserve','push','en',NULL,'{{auctionNo}} closed without a sale','The auction for {{title}} closed without a sale (reserve or minimum bidders not met). Every EMD has been returned.',NULL,true),
 ('auction.failed_reserve','push','hi',NULL,'{{auctionNo}} बिना बिक्री के बंद','{{title}} की नीलामी बिना बिक्री के बंद हुई (रिज़र्व या न्यूनतम बोलीदाता पूरे नहीं)। हर EMD लौटा दी गई है।',NULL,true),
 ('auction.failed_reserve','push','gu',NULL,'{{auctionNo}} વેચાણ વિના બંધ','{{title}} ની હરાજી વેચાણ વિના બંધ થઈ (રિઝર્વ અથવા લઘુત્તમ બોલીદાર પૂરા નહીં). દરેક EMD પાછી આપવામાં આવી છે.',NULL,true),
 ('auction.failed_reserve','inapp','en',NULL,'{{auctionNo}} closed without a sale','The auction for {{title}} closed without a sale (reserve or minimum bidders not met). Every EMD has been returned.',NULL,true),
 ('auction.failed_reserve','inapp','hi',NULL,'{{auctionNo}} बिना बिक्री के बंद','{{title}} की नीलामी बिना बिक्री के बंद हुई (रिज़र्व या न्यूनतम बोलीदाता पूरे नहीं)। हर EMD लौटा दी गई है।',NULL,true),
 ('auction.failed_reserve','inapp','gu',NULL,'{{auctionNo}} વેચાણ વિના બંધ','{{title}} ની હરાજી વેચાણ વિના બંધ થઈ (રિઝર્વ અથવા લઘુત્તમ બોલીદાર પૂરા નહીં). દરેક EMD પાછી આપવામાં આવી છે.',NULL,true),
 ('auction.defaulted','push','en',NULL,'{{auctionNo}} defaulted','The balance for {{title}} was not paid in time. The winner''s EMD has been forfeited to the seller and the listing is back on sale.',NULL,true),
 ('auction.defaulted','push','hi',NULL,'{{auctionNo}} में चूक','{{title}} की बाकी राशि समय पर नहीं चुकाई गई। विजेता की EMD विक्रेता को ज़ब्त कर दी गई है और लिस्टिंग फिर बिक्री पर है।',NULL,true),
 ('auction.defaulted','push','gu',NULL,'{{auctionNo}} માં ચૂક','{{title}} ની બાકી રકમ સમયસર ચૂકવાઈ નથી. વિજેતાની EMD વેચનારને જપ્ત કરવામાં આવી છે અને લિસ્ટિંગ ફરી વેચાણ પર છે.',NULL,true),
 ('auction.defaulted','inapp','en',NULL,'{{auctionNo}} defaulted','The balance for {{title}} was not paid in time. The winner''s EMD has been forfeited to the seller and the listing is back on sale.',NULL,true),
 ('auction.defaulted','inapp','hi',NULL,'{{auctionNo}} में चूक','{{title}} की बाकी राशि समय पर नहीं चुकाई गई। विजेता की EMD विक्रेता को ज़ब्त कर दी गई है और लिस्टिंग फिर बिक्री पर है।',NULL,true),
 ('auction.defaulted','inapp','gu',NULL,'{{auctionNo}} માં ચૂક','{{title}} ની બાકી રકમ સમયસર ચૂકવાઈ નથી. વિજેતાની EMD વેચનારને જપ્ત કરવામાં આવી છે અને લિસ્ટિંગ ફરી વેચાણ પર છે.',NULL,true),
 ('auction.lapsed','push','en',NULL,'{{auctionNo}} lapsed','The seller did not decide on {{title}} in time, so the auction ended with no sale. Every EMD has been returned.',NULL,true),
 ('auction.lapsed','push','hi',NULL,'{{auctionNo}} समाप्त','विक्रेता ने {{title}} पर समय पर फ़ैसला नहीं किया, इसलिए नीलामी बिना बिक्री के समाप्त हुई। हर EMD लौटा दी गई है।',NULL,true),
 ('auction.lapsed','push','gu',NULL,'{{auctionNo}} સમાપ્ત','વેચનારે {{title}} પર સમયસર નિર્ણય લીધો નહીં, તેથી હરાજી વેચાણ વિના સમાપ્ત થઈ. દરેક EMD પાછી આપવામાં આવી છે.',NULL,true),
 ('auction.lapsed','inapp','en',NULL,'{{auctionNo}} lapsed','The seller did not decide on {{title}} in time, so the auction ended with no sale. Every EMD has been returned.',NULL,true),
 ('auction.lapsed','inapp','hi',NULL,'{{auctionNo}} समाप्त','विक्रेता ने {{title}} पर समय पर फ़ैसला नहीं किया, इसलिए नीलामी बिना बिक्री के समाप्त हुई। हर EMD लौटा दी गई है।',NULL,true),
 ('auction.lapsed','inapp','gu',NULL,'{{auctionNo}} સમાપ્ત','વેચનારે {{title}} પર સમયસર નિર્ણય લીધો નહીં, તેથી હરાજી વેચાણ વિના સમાપ્ત થઈ. દરેક EMD પાછી આપવામાં આવી છે.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('bid.won',                'auctionNo', 'auctions.auction_no',                      'AUC-2026-0713-01', true),
 ('bid.won',                'title',     'listings.title at settlement',            'Ghee, buffalo', true),
 ('auction.cancelled',      'auctionNo', 'auctions.auction_no',                      'AUC-2026-0713-01', true),
 ('auction.cancelled',      'title',     'listings.title at cancellation',          'Ghee, buffalo', true),
 ('auction.cancelled',      'reason',    'auctions.cancel_reason (verbatim)',       'quality complaint on the lot', true),
 ('auction.failed_reserve', 'auctionNo', 'auctions.auction_no',                      'AUC-2026-0713-01', true),
 ('auction.failed_reserve', 'title',     'listings.title at close',                 'Ghee, buffalo', true),
 ('auction.defaulted',      'auctionNo', 'auctions.auction_no',                      'AUC-2026-0713-01', true),
 ('auction.defaulted',      'title',     'listings.title at default',               'Ghee, buffalo', true),
 ('auction.lapsed',         'auctionNo', 'auctions.auction_no',                      'AUC-2026-0713-01', true),
 ('auction.lapsed',         'title',     'listings.title at lapse',                 'Ghee, buffalo', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-11b · **A WORKER IS TOLD WHEN THE JOB IS CONFIRMED AND WHEN IT IS CANCELLED.** Before this wave no `labour.*`
-- outbox event reached anyone (survey F-24 / W164 #19 — "Cancel (workers notified with reason)" notified nobody). Migration
-- 0187 catalogues two events; their copy lives HERE, above the version backfill below (0122's send-time gate). Variables
-- come from the outbox payload: `jobNo` (JOB-…), `startDate` (DD/MM/YYYY, India), `reason` (the reason the employer or the
-- desk recorded, verbatim — the workers' to read, not ours to paraphrase).
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('labour.roster_confirmed','push','en',NULL,'{{jobNo}} is confirmed','Your job {{jobNo}} starting {{startDate}} is confirmed. Your wages are already set aside — they are paid after the employer confirms each day you work.',NULL,true),
 ('labour.roster_confirmed','push','hi',NULL,'{{jobNo}} पक्का हुआ','{{startDate}} से शुरू होने वाला आपका काम {{jobNo}} पक्का हो गया है। आपकी मज़दूरी पहले से अलग रख दी गई है — मालिक हर दिन के काम की पुष्टि करे, उसके बाद भुगतान होता है।',NULL,true),
 ('labour.roster_confirmed','push','gu',NULL,'{{jobNo}} પાકું થયું','{{startDate}} થી શરૂ થતું તમારું કામ {{jobNo}} પાકું થયું છે. તમારું વેતન પહેલેથી અલગ રાખવામાં આવ્યું છે — માલિક દરેક દિવસના કામની પુષ્ટિ કરે પછી ચુકવણી થાય છે.',NULL,true),
 ('labour.roster_confirmed','inapp','en',NULL,'{{jobNo}} is confirmed','Your job {{jobNo}} starting {{startDate}} is confirmed. Your wages are already set aside — they are paid after the employer confirms each day you work.',NULL,true),
 ('labour.roster_confirmed','inapp','hi',NULL,'{{jobNo}} पक्का हुआ','{{startDate}} से शुरू होने वाला आपका काम {{jobNo}} पक्का हो गया है। आपकी मज़दूरी पहले से अलग रख दी गई है — मालिक हर दिन के काम की पुष्टि करे, उसके बाद भुगतान होता है।',NULL,true),
 ('labour.roster_confirmed','inapp','gu',NULL,'{{jobNo}} પાકું થયું','{{startDate}} થી શરૂ થતું તમારું કામ {{jobNo}} પાકું થયું છે. તમારું વેતન પહેલેથી અલગ રાખવામાં આવ્યું છે — માલિક દરેક દિવસના કામની પુષ્ટિ કરે પછી ચુકવણી થાય છે.',NULL,true),
 ('labour.booking_cancelled','push','en',NULL,'{{jobNo}} was cancelled','The job {{jobNo}} starting {{startDate}} was cancelled: {{reason}}. Please do not travel for it.',NULL,true),
 ('labour.booking_cancelled','push','hi',NULL,'{{jobNo}} रद्द हुआ','{{startDate}} से शुरू होने वाला काम {{jobNo}} रद्द कर दिया गया: {{reason}}। कृपया इसके लिए यात्रा न करें।',NULL,true),
 ('labour.booking_cancelled','push','gu',NULL,'{{jobNo}} રદ થયું','{{startDate}} થી શરૂ થતું કામ {{jobNo}} રદ કરવામાં આવ્યું: {{reason}}. કૃપા કરીને તેના માટે મુસાફરી કરશો નહીં.',NULL,true),
 ('labour.booking_cancelled','inapp','en',NULL,'{{jobNo}} was cancelled','The job {{jobNo}} starting {{startDate}} was cancelled: {{reason}}. Please do not travel for it.',NULL,true),
 ('labour.booking_cancelled','inapp','hi',NULL,'{{jobNo}} रद्द हुआ','{{startDate}} से शुरू होने वाला काम {{jobNo}} रद्द कर दिया गया: {{reason}}। कृपया इसके लिए यात्रा न करें।',NULL,true),
 ('labour.booking_cancelled','inapp','gu',NULL,'{{jobNo}} રદ થયું','{{startDate}} થી શરૂ થતું કામ {{jobNo}} રદ કરવામાં આવ્યું: {{reason}}. કૃપા કરીને તેના માટે મુસાફરી કરશો નહીં.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('labour.roster_confirmed',  'jobNo',     'labour_bookings.booking_no',                                   'JOB-0713-04', true),
 ('labour.roster_confirmed',  'startDate', 'labour_bookings.start_date (DD/MM/YYYY)',                      '14/07/2026', true),
 ('labour.booking_cancelled', 'jobNo',     'labour_bookings.booking_no',                                   'JOB-0713-04', true),
 ('labour.booking_cancelled', 'startDate', 'labour_bookings.start_date (DD/MM/YYYY)',                      '14/07/2026', true),
 ('labour.booking_cancelled', 'reason',    'labour_cancel_reason default_name, or labour_bookings.cancel_reason_text for other (verbatim)', 'Rain forecast — rescheduling', true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-11c · **EVERY PLEDGER HEARS WHAT HAPPENED TO THE LOT, IN THEIR LANGUAGE.** Canon W136: "Whichever path —
-- recorded, and every pledger hears it in their language". Before this wave no `group_lot.*` event reached anyone. Migration
-- 0188 catalogues four events; their copy lives HERE, above the version backfill below (0122's send-time gate). Variables come
-- from the outbox payload: `lotNo` (GL-…), `product` (the product's name), `deadline` (DD/MM/YYYY HH:mm, India), `progress`
-- (whole percent), `reason` (a per-language map from seed core/0022, or the coordinator's own words for `other`), `share`
-- (the member's settled share as money text). The nudge is a notification through these channels — a VOICE nudge is not built.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('group_lot.deadline_extended','push','en',NULL,'{{lotNo}}: new deadline','The pledge deadline for {{lotNo}} ({{product}}) was extended once, to {{deadline}}. Your pledge stands; you may still withdraw it until the lot lists.',NULL,true),
 ('group_lot.deadline_extended','push','hi',NULL,'{{lotNo}}: नई अंतिम तिथि','{{lotNo}} ({{product}}) में वचन देने की अंतिम तिथि एक बार बढ़ाकर {{deadline}} कर दी गई है। आपका वचन बना रहेगा; लॉट सूचीबद्ध होने तक आप इसे वापस ले सकते हैं।',NULL,true),
 ('group_lot.deadline_extended','push','gu',NULL,'{{lotNo}}: નવી અંતિમ તારીખ','{{lotNo}} ({{product}}) માં વચન આપવાની અંતિમ તારીખ એક વાર લંબાવીને {{deadline}} કરવામાં આવી છે. તમારું વચન યથાવત્ છે; લોટ યાદીમાં મુકાય ત્યાં સુધી તમે તેને પાછું ખેંચી શકો છો.',NULL,true),
 ('group_lot.deadline_extended','inapp','en',NULL,'{{lotNo}}: new deadline','The pledge deadline for {{lotNo}} ({{product}}) was extended once, to {{deadline}}. Your pledge stands; you may still withdraw it until the lot lists.',NULL,true),
 ('group_lot.deadline_extended','inapp','hi',NULL,'{{lotNo}}: नई अंतिम तिथि','{{lotNo}} ({{product}}) में वचन देने की अंतिम तिथि एक बार बढ़ाकर {{deadline}} कर दी गई है। आपका वचन बना रहेगा; लॉट सूचीबद्ध होने तक आप इसे वापस ले सकते हैं।',NULL,true),
 ('group_lot.deadline_extended','inapp','gu',NULL,'{{lotNo}}: નવી અંતિમ તારીખ','{{lotNo}} ({{product}}) માં વચન આપવાની અંતિમ તારીખ એક વાર લંબાવીને {{deadline}} કરવામાં આવી છે. તમારું વચન યથાવત્ છે; લોટ યાદીમાં મુકાય ત્યાં સુધી તમે તેને પાછું ખેંચી શકો છો.',NULL,true),
 ('group_lot.cancelled','push','en',NULL,'{{lotNo}} was cancelled','The group lot {{lotNo}} ({{product}}) was cancelled: {{reason}}. Your pledge is released — your produce is yours to sell.',NULL,true),
 ('group_lot.cancelled','push','hi',NULL,'{{lotNo}} रद्द हुआ','सामूहिक लॉट {{lotNo}} ({{product}}) रद्द कर दिया गया: {{reason}}। आपका वचन मुक्त है — आपकी उपज आप स्वयं बेच सकते हैं।',NULL,true),
 ('group_lot.cancelled','push','gu',NULL,'{{lotNo}} રદ થયો','સામૂહિક લોટ {{lotNo}} ({{product}}) રદ કરવામાં આવ્યો: {{reason}}. તમારું વચન મુક્ત છે — તમારી ઉપજ તમે પોતે વેચી શકો છો.',NULL,true),
 ('group_lot.cancelled','inapp','en',NULL,'{{lotNo}} was cancelled','The group lot {{lotNo}} ({{product}}) was cancelled: {{reason}}. Your pledge is released — your produce is yours to sell.',NULL,true),
 ('group_lot.cancelled','inapp','hi',NULL,'{{lotNo}} रद्द हुआ','सामूहिक लॉट {{lotNo}} ({{product}}) रद्द कर दिया गया: {{reason}}। आपका वचन मुक्त है — आपकी उपज आप स्वयं बेच सकते हैं।',NULL,true),
 ('group_lot.cancelled','inapp','gu',NULL,'{{lotNo}} રદ થયો','સામૂહિક લોટ {{lotNo}} ({{product}}) રદ કરવામાં આવ્યો: {{reason}}. તમારું વચન મુક્ત છે — તમારી ઉપજ તમે પોતે વેચી શકો છો.',NULL,true),
 ('group_lot.nudge','push','en',NULL,'Pool your {{product}} in {{lotNo}}','{{lotNo}} is pooling {{product}} and is {{progress}} pledged. Pledge by {{deadline}} to sell together at the pooled price.',NULL,true),
 ('group_lot.nudge','push','hi',NULL,'{{lotNo}} में अपना {{product}} जोड़ें','{{lotNo}} में {{product}} इकट्ठा हो रहा है और {{progress}} वचन मिल चुके हैं। मिलकर बेचने के लिए {{deadline}} तक वचन दें।',NULL,true),
 ('group_lot.nudge','push','gu',NULL,'{{lotNo}} માં તમારું {{product}} જોડો','{{lotNo}} માં {{product}} ભેગું થઈ રહ્યું છે અને {{progress}} વચન મળી ગયાં છે. સાથે મળીને વેચવા માટે {{deadline}} સુધીમાં વચન આપો.',NULL,true),
 ('group_lot.nudge','inapp','en',NULL,'Pool your {{product}} in {{lotNo}}','{{lotNo}} is pooling {{product}} and is {{progress}} pledged. Pledge by {{deadline}} to sell together at the pooled price.',NULL,true),
 ('group_lot.nudge','inapp','hi',NULL,'{{lotNo}} में अपना {{product}} जोड़ें','{{lotNo}} में {{product}} इकट्ठा हो रहा है और {{progress}} वचन मिल चुके हैं। मिलकर बेचने के लिए {{deadline}} तक वचन दें।',NULL,true),
 ('group_lot.nudge','inapp','gu',NULL,'{{lotNo}} માં તમારું {{product}} જોડો','{{lotNo}} માં {{product}} ભેગું થઈ રહ્યું છે અને {{progress}} વચન મળી ગયાં છે. સાથે મળીને વેચવા માટે {{deadline}} સુધીમાં વચન આપો.',NULL,true),
 ('group_lot.settled','push','en',NULL,'{{lotNo}}: {{share}} paid','Your share of the {{lotNo}} ({{product}}) sale, {{share}}, has been paid to your wallet.',NULL,true),
 ('group_lot.settled','push','hi',NULL,'{{lotNo}}: {{share}} का भुगतान','{{lotNo}} ({{product}}) की बिक्री में आपका हिस्सा, {{share}}, आपके वॉलेट में भेज दिया गया है।',NULL,true),
 ('group_lot.settled','push','gu',NULL,'{{lotNo}}: {{share}} ચૂકવાયા','{{lotNo}} ({{product}}) ના વેચાણમાં તમારો હિસ્સો, {{share}}, તમારા વૉલેટમાં ચૂકવી દેવામાં આવ્યો છે.',NULL,true),
 ('group_lot.settled','inapp','en',NULL,'{{lotNo}}: {{share}} paid','Your share of the {{lotNo}} ({{product}}) sale, {{share}}, has been paid to your wallet.',NULL,true),
 ('group_lot.settled','inapp','hi',NULL,'{{lotNo}}: {{share}} का भुगतान','{{lotNo}} ({{product}}) की बिक्री में आपका हिस्सा, {{share}}, आपके वॉलेट में भेज दिया गया है।',NULL,true),
 ('group_lot.settled','inapp','gu',NULL,'{{lotNo}}: {{share}} ચૂકવાયા','{{lotNo}} ({{product}}) ના વેચાણમાં તમારો હિસ્સો, {{share}}, તમારા વૉલેટમાં ચૂકવી દેવામાં આવ્યો છે.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('group_lot.deadline_extended','lotNo','group_lots.lot_no','GL-2026-0712-02',true),
 ('group_lot.deadline_extended','product','products.default_name','Sesame, white',true),
 ('group_lot.deadline_extended','deadline','group_lots.pledge_deadline (DD/MM/YYYY HH:mm, India)','14/07/2026 12:00',true),
 ('group_lot.cancelled','lotNo','group_lots.lot_no','GL-2026-0712-02',true),
 ('group_lot.cancelled','product','products.default_name','Sesame, white',true),
 ('group_lot.cancelled','reason','ui_messages group_lot.cancel_reason.<code> (seed core/0022) in the reader''s language, or group_lots.cancel_reason_text for other (verbatim)','Target missed by the deadline',true),
 ('group_lot.nudge','lotNo','group_lots.lot_no','GL-2026-0712-02',true),
 ('group_lot.nudge','product','products.default_name','Sesame, white',true),
 ('group_lot.nudge','progress','pledged / target, whole percent','86%',true),
 ('group_lot.nudge','deadline','group_lots.pledge_deadline (DD/MM/YYYY HH:mm, India)','14/07/2026 12:00',true),
 ('group_lot.settled','lotNo','group_lots.lot_no','GL-2026-0712-02',true),
 ('group_lot.settled','product','products.default_name','Sesame, white',true),
 ('group_lot.settled','share','group_lot_settlement_lines.share_minor (money text, core/money moneyText)','INR 21,600.00',true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ==================================================================================================================
-- PC-56 TENANT-11d · **A BUYER HEARS THAT MEMBERS POOLED THEIR STOCK FOR THEIR NEED.** Canon W132: the buyer desk's pooled quote
-- "sends as two linked responses (one per member, status submitted)". Migration 0189 catalogues `requirement.group_quoted`; its copy
-- lives HERE, above the version backfill below (0122's send-time gate). Variables come from the outbox payload: `reqNo`
-- (REQ-mmdd-nn), `title` (the requirement's own title, as the buyer wrote it), `members` (how many members' linked responses).
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('requirement.group_quoted','push','en',NULL,'{{reqNo}}: a pooled quote arrived','{{members}} members quoted together on {{reqNo}} ({{title}}). Each member confirmed their own share. Open it to shortlist, accept or decline.',NULL,true),
 ('requirement.group_quoted','push','hi',NULL,'{{reqNo}}: एक संयुक्त भाव आया','{{reqNo}} ({{title}}) पर {{members}} सदस्यों ने मिलकर भाव दिया है। हर सदस्य ने अपने हिस्से की पुष्टि की है। शॉर्टलिस्ट, स्वीकार या अस्वीकार करने के लिए खोलें।',NULL,true),
 ('requirement.group_quoted','push','gu',NULL,'{{reqNo}}: એક સંયુક્ત ભાવ આવ્યો','{{reqNo}} ({{title}}) પર {{members}} સભ્યોએ સાથે મળીને ભાવ આપ્યો છે. દરેક સભ્યે પોતાના હિસ્સાની પુષ્ટિ કરી છે. શોર્ટલિસ્ટ, સ્વીકાર અથવા અસ્વીકાર કરવા માટે ખોલો.',NULL,true),
 ('requirement.group_quoted','inapp','en',NULL,'{{reqNo}}: a pooled quote arrived','{{members}} members quoted together on {{reqNo}} ({{title}}). Each member confirmed their own share. Open it to shortlist, accept or decline.',NULL,true),
 ('requirement.group_quoted','inapp','hi',NULL,'{{reqNo}}: एक संयुक्त भाव आया','{{reqNo}} ({{title}}) पर {{members}} सदस्यों ने मिलकर भाव दिया है। हर सदस्य ने अपने हिस्से की पुष्टि की है। शॉर्टलिस्ट, स्वीकार या अस्वीकार करने के लिए खोलें।',NULL,true),
 ('requirement.group_quoted','inapp','gu',NULL,'{{reqNo}}: એક સંયુક્ત ભાવ આવ્યો','{{reqNo}} ({{title}}) પર {{members}} સભ્યોએ સાથે મળીને ભાવ આપ્યો છે. દરેક સભ્યે પોતાના હિસ્સાની પુષ્ટિ કરી છે. શોર્ટલિસ્ટ, સ્વીકાર અથવા અસ્વીકાર કરવા માટે ખોલો.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('requirement.group_quoted','reqNo','requirements.req_no','REQ-0711-08',true),
 ('requirement.group_quoted','title','requirements.title (the buyer''s own words)','GG-20 groundnut, grade A',true),
 ('requirement.group_quoted','members','count of linked responses the pooled quote sent','2',true)
ON CONFLICT (event_code, name) DO NOTHING;

-- PC-56 TENANT-12 (F-5) · WEATHER ADVISORIES REACH THE MEMBERS WHOSE PARCELS ARE UNDER THEM. `weather.alert` and
-- `weather.alert_severe` were catalogued (core/0007 line 14) and emitted by nothing, with no template in any language. The
-- advisory push job (land-soil-weather, registered in 0190's wave) now emits one event per alert per tenant carrying
-- `recipientUserIds` (parcel owners under the alert's region, minus those whose weather prefs ask for severe only). Copy lives
-- HERE, above the version backfill (0122's send-time gate). Variables: `alertName` (a per-language map from ui_messages
-- `weather.alert_type.*`, seed core/0023), `region` (the region's name), `validTo` (YYYY-MM-DD HH:MM in India time).
-- SMS is NOT seeded: an SMS template needs a DLT registration this platform has not made; push + in-app only.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('weather.alert','push','en',NULL,'Weather advisory: {{alertName}}','{{alertName}} advisory for {{region}}, valid until {{validTo}}. Check your fields and follow your extension officer''s advice.',NULL,true),
 ('weather.alert','push','hi',NULL,'मौसम सलाह: {{alertName}}','{{region}} के लिए {{alertName}} की सलाह, {{validTo}} तक मान्य। अपने खेत देखें और अपने कृषि विस्तार अधिकारी की सलाह मानें।',NULL,true),
 ('weather.alert','push','gu',NULL,'હવામાન સલાહ: {{alertName}}','{{region}} માટે {{alertName}} ની સલાહ, {{validTo}} સુધી માન્ય. તમારા ખેતર તપાસો અને તમારા કૃષિ વિસ્તરણ અધિકારીની સલાહ માનો.',NULL,true),
 ('weather.alert','inapp','en',NULL,'Weather advisory: {{alertName}}','{{alertName}} advisory for {{region}}, valid until {{validTo}}. Check your fields and follow your extension officer''s advice.',NULL,true),
 ('weather.alert','inapp','hi',NULL,'मौसम सलाह: {{alertName}}','{{region}} के लिए {{alertName}} की सलाह, {{validTo}} तक मान्य। अपने खेत देखें और अपने कृषि विस्तार अधिकारी की सलाह मानें।',NULL,true),
 ('weather.alert','inapp','gu',NULL,'હવામાન સલાહ: {{alertName}}','{{region}} માટે {{alertName}} ની સલાહ, {{validTo}} સુધી માન્ય. તમારા ખેતર તપાસો અને તમારા કૃષિ વિસ્તરણ અધિકારીની સલાહ માનો.',NULL,true),
 ('weather.alert_severe','push','en',NULL,'SEVERE weather: {{alertName}}','Severe {{alertName}} warning for {{region}}, valid until {{validTo}}. Protect your crop, animals and family now.',NULL,true),
 ('weather.alert_severe','push','hi',NULL,'गंभीर मौसम: {{alertName}}','{{region}} के लिए गंभीर {{alertName}} चेतावनी, {{validTo}} तक मान्य। अभी अपनी फसल, पशुओं और परिवार की सुरक्षा करें।',NULL,true),
 ('weather.alert_severe','push','gu',NULL,'ગંભીર હવામાન: {{alertName}}','{{region}} માટે ગંભીર {{alertName}} ચેતવણી, {{validTo}} સુધી માન્ય. હમણાં જ તમારા પાક, પશુઓ અને પરિવારની સુરક્ષા કરો.',NULL,true),
 ('weather.alert_severe','inapp','en',NULL,'SEVERE weather: {{alertName}}','Severe {{alertName}} warning for {{region}}, valid until {{validTo}}. Protect your crop, animals and family now.',NULL,true),
 ('weather.alert_severe','inapp','hi',NULL,'गंभीर मौसम: {{alertName}}','{{region}} के लिए गंभीर {{alertName}} चेतावनी, {{validTo}} तक मान्य। अभी अपनी फसल, पशुओं और परिवार की सुरक्षा करें।',NULL,true),
 ('weather.alert_severe','inapp','gu',NULL,'ગંભીર હવામાન: {{alertName}}','{{region}} માટે ગંભીર {{alertName}} ચેતવણી, {{validTo}} સુધી માન્ય. હમણાં જ તમારા પાક, પશુઓ અને પરિવારની સુરક્ષા કરો.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('weather.alert','alertName','ui_messages weather.alert_type.<code> (per language)','Heavy rain',true),
 ('weather.alert','region','admin_regions.default_name of the alert''s region','Junagadh',true),
 ('weather.alert','validTo','weather_alerts.valid_to in Asia/Kolkata, YYYY-MM-DD HH:MM','2026-07-14 18:00',true),
 ('weather.alert_severe','alertName','ui_messages weather.alert_type.<code> (per language)','Cyclone',true),
 ('weather.alert_severe','region','admin_regions.default_name of the alert''s region','Junagadh',true),
 ('weather.alert_severe','validTo','weather_alerts.valid_to in Asia/Kolkata, YYYY-MM-DD HH:MM','2026-07-14 18:00',true)
ON CONFLICT (event_code, name) DO NOTHING;

-- PC-56 TENANT-13a (§B) · A WEBHOOK ENDPOINT STOPPED — AND THE DEVELOPER IS TOLD. W188 promises "then paused with an email to your
-- developer". Migration 0191 catalogues `webhooks.endpoint_paused`; the delivery worker emits it in the SAME transaction that pauses the
-- endpoint (six failed attempts — the ladder 1m · 5m · 30m · 2h · 12h is exhausted) or disables it (the target guard refused it at send
-- time). Recipients travel in the payload: the developer contact when that address belongs to an active member of the tenant, and
-- whoever added the endpoint. Copy lives HERE, above the version backfill below (0122's send-time gate). Email + in-app; no SMS (a
-- developer notice is not a DLT-registered template). Variables: `endpointHost` (the endpoint's host), `failures` (attempts that
-- failed), `lastResult` (the last HTTP status, or the transport class — timeout, connect, tls, dns, redirect, refused),
-- `queuedForResume` (deliveries that replay in order on resume).
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('webhooks.endpoint_paused','email','en',NULL,'Webhook endpoint paused: {{endpointHost}}','Your webhook endpoint {{endpointHost}} has stopped receiving events: {{failures}} attempt(s) failed (last result: {{lastResult}}). {{queuedForResume}} event(s) are held — nothing is lost — and they replay in order, freshly signed, when you resume the endpoint under Settings › Developers › Webhooks.',NULL,true),
 ('webhooks.endpoint_paused','email','hi',NULL,'वेबहुक एंडपॉइंट रोका गया: {{endpointHost}}','आपके वेबहुक एंडपॉइंट {{endpointHost}} पर इवेंट भेजना रुक गया है: {{failures}} प्रयास विफल रहे (अंतिम परिणाम: {{lastResult}})। {{queuedForResume}} इवेंट रोके गए हैं — कुछ भी खोया नहीं है — और सेटिंग्स › डेवलपर्स › वेबहुक में एंडपॉइंट फिर से चालू करने पर वे क्रम से, नए हस्ताक्षर के साथ भेजे जाएंगे।',NULL,true),
 ('webhooks.endpoint_paused','email','gu',NULL,'વેબહુક એન્ડપોઇન્ટ અટકાવાયો: {{endpointHost}}','તમારા વેબહુક એન્ડપોઇન્ટ {{endpointHost}} પર ઇવેન્ટ મોકલવાનું અટકી ગયું છે: {{failures}} પ્રયાસ નિષ્ફળ ગયા (છેલ્લું પરિણામ: {{lastResult}}). {{queuedForResume}} ઇવેન્ટ રોકી રખાઈ છે — કંઈ ખોવાયું નથી — અને સેટિંગ્સ › ડેવલપર્સ › વેબહુકમાં એન્ડપોઇન્ટ ફરી ચાલુ કરતાં તે ક્રમમાં, નવી સહી સાથે મોકલાશે.',NULL,true),
 ('webhooks.endpoint_paused','inapp','en',NULL,'Webhook endpoint paused: {{endpointHost}}','{{endpointHost}} has stopped receiving events after {{failures}} failed attempt(s) (last result: {{lastResult}}). {{queuedForResume}} event(s) are held and replay in order when you resume it.',NULL,true),
 ('webhooks.endpoint_paused','inapp','hi',NULL,'वेबहुक एंडपॉइंट रोका गया: {{endpointHost}}','{{failures}} विफल प्रयासों के बाद {{endpointHost}} पर इवेंट भेजना रुक गया है (अंतिम परिणाम: {{lastResult}})। {{queuedForResume}} इवेंट रोके गए हैं और फिर से चालू करने पर क्रम से भेजे जाएंगे।',NULL,true),
 ('webhooks.endpoint_paused','inapp','gu',NULL,'વેબહુક એન્ડપોઇન્ટ અટકાવાયો: {{endpointHost}}','{{failures}} નિષ્ફળ પ્રયાસો પછી {{endpointHost}} પર ઇવેન્ટ મોકલવાનું અટકી ગયું છે (છેલ્લું પરિણામ: {{lastResult}}). {{queuedForResume}} ઇવેન્ટ રોકી રખાઈ છે અને ફરી ચાલુ કરતાં ક્રમમાં મોકલાશે.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('webhooks.endpoint_paused','endpointHost','webhook_endpoints.url (host part)','sheets-bridge.anandfpo.in',true),
 ('webhooks.endpoint_paused','failures','attempts that failed in the cycle (6 when the ladder is exhausted; 1 when the guard refused)','6',true),
 ('webhooks.endpoint_paused','lastResult','webhook_delivery_attempts.status_code, or the error class (timeout, connect, tls, dns, redirect, refused)','504',true),
 ('webhooks.endpoint_paused','queuedForResume','deliveries held or exhausted on the endpoint — replayed in order on resume','12',true)
ON CONFLICT (event_code, name) DO NOTHING;

-- PC-56 TENANT-13b (A1) · A TRUST-AFFECTING SETTING CHANGES — AND EVERY MEMBER IS TOLD BEFORE IT BITES. W186: "Settings that touch
-- member money or trust (auto-confirm, approval) apply from next midnight with a member notice — never mid-order." Migration 0192
-- catalogues `tenant.setting_effective`; the settings-apply job emits it in the SAME transaction that writes the confirmed value, for
-- keys the registry flags `member_notice`. Recipients travel in the payload (every active member of the tenant). Variables:
-- `settingName` (per-language map, seed core/0024 `setting.name.<key>`), `oldValue` / `newValue` (per-language maps — numbers are
-- formatted, enum values named from seed core/0024 `setting.value.<v>`), `effectiveAt` (Asia/Kolkata, YYYY-MM-DD HH:MM). Push + in-app.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('tenant.setting_effective','push','en',NULL,'A cooperative rule changed: {{settingName}}','From {{effectiveAt}}, {{settingName}} is {{newValue}} (it was {{oldValue}}). Two administrators of your cooperative confirmed this change.',NULL,true),
 ('tenant.setting_effective','push','hi',NULL,'सहकारी समिति का नियम बदला: {{settingName}}','{{effectiveAt}} से {{settingName}} {{newValue}} है (पहले {{oldValue}} था)। आपकी समिति के दो प्रशासकों ने इस बदलाव की पुष्टि की है।',NULL,true),
 ('tenant.setting_effective','push','gu',NULL,'સહકારી મંડળીનો નિયમ બદલાયો: {{settingName}}','{{effectiveAt}} થી {{settingName}} {{newValue}} છે (પહેલાં {{oldValue}} હતું). તમારી મંડળીના બે વહીવટકર્તાઓએ આ ફેરફારની પુષ્ટિ કરી છે.',NULL,true),
 ('tenant.setting_effective','inapp','en',NULL,'A cooperative rule changed: {{settingName}}','From {{effectiveAt}}, {{settingName}} is {{newValue}} (it was {{oldValue}}). Two administrators of your cooperative confirmed this change; it never applies to an order or a bill already in progress.',NULL,true),
 ('tenant.setting_effective','inapp','hi',NULL,'सहकारी समिति का नियम बदला: {{settingName}}','{{effectiveAt}} से {{settingName}} {{newValue}} है (पहले {{oldValue}} था)। आपकी समिति के दो प्रशासकों ने इस बदलाव की पुष्टि की है; यह पहले से चल रहे किसी ऑर्डर या बिल पर लागू नहीं होता।',NULL,true),
 ('tenant.setting_effective','inapp','gu',NULL,'સહકારી મંડળીનો નિયમ બદલાયો: {{settingName}}','{{effectiveAt}} થી {{settingName}} {{newValue}} છે (પહેલાં {{oldValue}} હતું). તમારી મંડળીના બે વહીવટકર્તાઓએ આ ફેરફારની પુષ્ટિ કરી છે; તે પહેલેથી ચાલુ કોઈ ઓર્ડર કે બિલ પર લાગુ થતો નથી.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('tenant.setting_effective','settingName','ui_messages setting.name.<key> (seed core/0024, per language)','Milk bill objection window (hours)',true),
 ('tenant.setting_effective','oldValue','tenant_setting_proposals.old_value, formatted (enum values: ui_messages setting.value.<v>)','24',true),
 ('tenant.setting_effective','newValue','tenant_setting_proposals.new_value, formatted (enum values: ui_messages setting.value.<v>)','48',true),
 ('tenant.setting_effective','effectiveAt','tenant_setting_proposals.effective_at in Asia/Kolkata, YYYY-MM-DD HH:MM','2026-10-04 00:00',true)
ON CONFLICT (event_code, name) DO NOTHING;

-- PC-56 TENANT-13d (A4) · SAME ORGANISATION, NEW LOOK. Migration 0194 catalogues `tenant.brand_published`; the brand-publish transaction
-- emits it once a SECOND tenant_admin confirmed the brand (or a rollback). In-app only — "members see the new brand at next app open, with a
-- one-time note in their language" (canon W191). Variables: `displayName` (the tenant's published name, as the tenant wrote it), `version`.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('tenant.brand_published','inapp','en',NULL,'Same organisation, new look','{{displayName}} has a new look in your app — new name, logo or colours. It is the same organisation you belong to: your orders, payments and messages are exactly where they were. Two administrators confirmed this change.',NULL,true),
 ('tenant.brand_published','inapp','hi',NULL,'वही संस्था, नया रूप','{{displayName}} का आपके ऐप में नया रूप है — नया नाम, लोगो या रंग। यह वही संस्था है जिसके आप सदस्य हैं: आपके ऑर्डर, भुगतान और संदेश जहाँ थे वहीं हैं। दो प्रशासकों ने इस बदलाव की पुष्टि की है।',NULL,true),
 ('tenant.brand_published','inapp','gu',NULL,'એ જ સંસ્થા, નવો દેખાવ','{{displayName}} નો તમારી એપમાં નવો દેખાવ છે — નવું નામ, લોગો અથવા રંગો. આ એ જ સંસ્થા છે જેના તમે સભ્ય છો: તમારા ઓર્ડર, ચુકવણી અને સંદેશા જ્યાં હતા ત્યાં જ છે. બે વહીવટકર્તાઓએ આ ફેરફારની પુષ્ટિ કરી છે.',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('tenant.brand_published','displayName','tenant_branding_history.display_name of the published version','Anand FPO Mandi',true),
 ('tenant.brand_published','version','tenant_branding_history.version','2',false)
ON CONFLICT (event_code, name) DO NOTHING;

-- NOTE (TENANT-6d-1): the block above sits BEFORE this backfill on purpose. The first draft appended it to the END
-- of the file and the three new SMS rows shipped with `serving_version_id = NULL` - which is EXACTLY the defect
-- TENANT-6c-2 closed (0122's send-time gate INNER JOINs the serving version, so an unversioned template resolves to
-- NULL and the send is recorded as `no_template`). 6c-2's own live guard caught it: the fix for a fix must not be the
-- same bug. Anything added to this file after this point is silently dead.

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-2 · **EVERY TEMPLATE IN THIS FILE RESOLVED TO NOTHING UNTIL THIS BLOCK EXISTED**
-- ---------------------------------------------------------------------------------------------------------------
-- 0122 made template wording versioned and put a send-time gate in `NotificationTemplateRepository.resolve()`, which
-- INNER JOINs `notification_template_versions` on `serving_version_id` with `lifecycle = 'approved'`. It also BACKFILLED
-- a version row for every template that existed **at migration time**, and pointed each servable one at it.
--
-- **AND SEEDS RUN AFTER MIGRATIONS.** So 0122's backfill never saw a single row from this file: on a fresh database the
-- migrations complete (and 0122 backfills the templates the MIGRATIONS inserted), and only then does `pnpm seed` insert
-- these. Every template this file has added since 0122 shipped has therefore had `serving_version_id = NULL`, resolved
-- to nothing, and been recorded as `no_template` — silently, which is the word 0129's header put in capitals.
--
-- Counted on a freshly built database before this block: 123 platform templates, 81 with a serving version, **42
-- without** — `order.confirmed`, `payment.success`, `auth.otp`, `wage.paid`, `review.prompt`, `shipment.delivered`,
-- every `dispute.*`, and all of TENANT-6b-1's `dairy.quality_flag_*` rows. So W168's *"member notified in Gujarati"*,
-- which 6b-1 built the entire plumbing for, has never sent one message.
--
-- The fix lives HERE rather than in a migration, and it is the same shape as 0122's: this file is the only place in the
-- repo that inserts platform notification templates, so it owns their versions, and `pnpm seed` is documented as
-- idempotent and re-runnable (db/README.md) — which makes re-seeding the mechanism that repairs a deployed environment
-- as well as a fresh one. A copy in a migration would be a second mechanism for one fact, and it would be the copy that
-- went stale the next time a template was added here.
--
-- THE LIFECYCLE AND THE SECOND-PERSON FLAG ARE 0122'S OWN RULES, NOT NEW ONES:
--   * `is_active` decides `approved` vs `draft`. An INACTIVE row must not get a serving pointer — that is how the
--     DLT-placeholder SMS rows above (and 0101's) stay silent instead of failing at the aggregator.
--   * `needs_second_person` = `user_can_opt_out = false OR priority = 'critical'`, verbatim from 0122. Copy a farmer
--     cannot mute is copy whose wording takes two humans to change — which is every dairy money notice in this file.
--
-- Scoped to `tenant_id IS NULL` (platform-authored copy): a tenant's own wording goes through the console's approval
-- flow, and back-dating an approval onto somebody else's words would be forging a signature.
INSERT INTO notification_template_versions (
  template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
  provider_template_ref, body_sha256, lifecycle, needs_second_person, approved_at, reason)
SELECT t.id, NULL, t.event_code, t.channel, t.language_code, 1, t.subject, t.body, t.provider_template_ref,
       encode(digest(t.body, 'sha256'), 'hex'),
       CASE WHEN t.is_active THEN 'approved' ELSE 'draft' END,
       (e.user_can_opt_out = false OR e.priority = 'critical'),
       CASE WHEN t.is_active THEN now() END,
       'PC-56 TENANT-6c-2: version row for seed-file copy that had none. 0122 backfilled the templates the MIGRATIONS '
       'inserted, and seeds run after migrations — so every template added by db/seeds/core/0007 since then resolved to '
       'NULL through 0122''s send-time gate and every send was recorded as no_template, silently. 42 templates, '
       'including order.confirmed, payment.success, auth.otp and all of TENANT-6b-1''s dairy quality messages.'
  FROM notification_templates t
  JOIN notification_events e ON e.code = t.event_code
 WHERE t.tenant_id IS NULL AND t.serving_version_id IS NULL AND t.deleted_at IS NULL
ON CONFLICT (template_id, version_no) DO NOTHING;

-- Point each one at its own version 1, and ONLY where that version is servable. A row whose version is `draft` (an
-- inactive DLT placeholder) deliberately gets no pointer: it should not be sending, and 0122's gate is what makes that
-- true rather than hopeful.
UPDATE notification_templates t
   SET serving_version_id = v.id
  FROM notification_template_versions v
 WHERE v.template_id = t.id AND v.version_no = 1 AND v.lifecycle = 'approved'
   AND t.tenant_id IS NULL AND t.serving_version_id IS NULL;
