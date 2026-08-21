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
ON CONFLICT (event_code,channel,language_code,tenant_id) DO NOTHING;

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
