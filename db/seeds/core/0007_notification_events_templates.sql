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
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

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
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

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
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
 ('dairy.bill_deduction_consent_required', 'period',        'milk_bills.period_start..period_end',        '01-15 Jul', true),
 ('dairy.bill_deduction_consent_required', 'gross',         'milk_bills.gross_minor + currency',           'Rs 9,414',  true),
 ('dairy.bill_deduction_consent_required', 'deductions',    'milk_bills.deductions_minor + currency',      'Rs 2,400',  true),
 ('dairy.bill_deduction_consent_required', 'lines',         'milk_bill_deductions rows (type + amount)',   'feed credit Rs 500, loan Rs 1,900', true),
 ('dairy.bill_deduction_consent_required', 'threshold_pct', 'setting dairy.deduction_consent_pct',          '25',        true)
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
