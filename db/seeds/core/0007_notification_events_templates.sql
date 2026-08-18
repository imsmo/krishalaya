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
