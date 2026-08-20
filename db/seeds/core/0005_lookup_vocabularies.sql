-- 0005 · controlled vocabularies (admin-extendable where flagged) · [P1]
INSERT INTO lookup_types (code,default_name,is_tenant_extendable) VALUES
 ('tenant_type','Tenant type',false),('doc_type','Document type',false),
 ('cancel_reason','Order cancel reason',true),('dispute_reason','Dispute reason',false),
 ('cert_type','Certificate type',false),('payment_purpose','Payment purpose',false),
 ('payout_purpose','Payout purpose',false),('ledger_txn_type','Ledger txn type',false),
 ('labour_task','Labour task type',true),('labour_demand_type','Labour demand type',false),
 ('boost_tier','Listing boost tier',false),('address_label','Address label',true),
 ('delivery_method','Delivery method',false),('vehicle_type','Vehicle type',false),
 ('ticket_category','Support ticket category',true),('report_reason','Moderation reason',false),
 ('vet_service','Veterinary service type',false),('animal_health_event','Animal health event type',false),
 ('export_doc','Export document type',false),
 ('irrigation','Irrigation type',false),('weather_alert','Weather alert type',false),
 ('loan_kind','Loan product kind',false),
 ('scheme_category','Government scheme category',false),
 ('claim_event','Insurance claim event type',false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('tenant_type',NULL,'fpo','FPO','{}',1),('tenant_type',NULL,'cooperative','Cooperative','{}',2),
 ('tenant_type',NULL,'dairy_union','Dairy Union','{}',3),('tenant_type',NULL,'startup','Agri-Startup','{}',4),
 ('tenant_type',NULL,'government','Government','{}',5),
 ('doc_type',NULL,'aadhaar','Aadhaar','{}',1),('doc_type',NULL,'pan','PAN','{}',2),
 ('doc_type',NULL,'land_record','Land Record','{}',3),('doc_type',NULL,'gst_cert','GST Certificate','{}',4),
 ('dispute_reason',NULL,'not_delivered','Not delivered','{}',1),('dispute_reason',NULL,'poor_quality','Poor quality','{}',2),
 ('dispute_reason',NULL,'qty_mismatch','Quantity mismatch','{}',3),('dispute_reason',NULL,'late','Late delivery','{}',4),
 ('dispute_reason',NULL,'wrong_item','Wrong item','{}',5),('dispute_reason',NULL,'damaged','Damaged in transit','{}',6),
 ('dispute_reason',NULL,'payment','Payment issue','{}',7),('dispute_reason',NULL,'bid_manipulation','Bid manipulation','{}',8),
 ('dispute_reason',NULL,'fake_certificate','Fake certificate','{}',9),
 ('boost_tier',NULL,'local','Local 30km / 3 days','{"price_minor":4900,"days":3}',1),
 ('boost_tier',NULL,'regional','Regional / 7 days','{"price_minor":14900,"days":7}',2),
 ('boost_tier',NULL,'statewide','Statewide / 14 days','{"price_minor":39900,"days":14}',3),
 ('ledger_txn_type',NULL,'order_payment','Order payment','{}',1),('ledger_txn_type',NULL,'escrow_hold','Escrow hold','{}',2),
 ('ledger_txn_type',NULL,'escrow_release','Escrow release','{}',3),('ledger_txn_type',NULL,'commission','Commission','{}',4),
 ('ledger_txn_type',NULL,'wage_payout','Wage payout','{}',5),('ledger_txn_type',NULL,'emd_hold','EMD hold','{}',6),
 ('ledger_txn_type',NULL,'payout','Wallet payout / withdrawal','{}',7),('ledger_txn_type',NULL,'refund','Refund to buyer','{}',8),
 ('ledger_txn_type',NULL,'subscription','Membership subscription','{}',9),('ledger_txn_type',NULL,'service_fee','Service marketplace fee (vet/etc.)','{}',10),('ledger_txn_type',NULL,'milk_payment','Milk procurement payment (coop → farmer)','{}',11),('ledger_txn_type',NULL,'storage_fee','Warehouse storage fee (depositor → operator)','{}',12),('ledger_txn_type',NULL,'contract_payment','Contract-farming advance/settlement (buyer → grower)','{}',13),('ledger_txn_type',NULL,'loan_disbursement','Loan disbursement (lender → borrower)','{}',14),('ledger_txn_type',NULL,'loan_repayment','Loan repayment (borrower → lender)','{}',15),('ledger_txn_type',NULL,'course_purchase','Course purchase (learner → instructor royalty + platform)','{}',16),('ledger_txn_type',NULL,'billing_adjustment','SaaS billing manual adjustment (platform ⇄ tenant, applied by billing-ops)','{}',17),('ledger_txn_type',NULL,'insurance_claim_settlement','Insurance claim settlement (platform payouts reserve to claimant wallet)','{}',19),('ledger_txn_type',NULL,'listing_boost','Listing visibility boost (seller → platform)','{}',18),
 ('payment_purpose',NULL,'wallet_recharge','Wallet recharge','{}',1),('payment_purpose',NULL,'direct_order','Direct order','{}',2),
 ('payment_purpose',NULL,'insurance_premium','Insurance premium payment','{}',3),
 ('claim_event',NULL,'drought','Drought','{}',1),('claim_event',NULL,'flood','Flood','{}',2),
 ('claim_event',NULL,'hail','Hailstorm','{}',3),('claim_event',NULL,'pest','Pest attack','{}',4),
 ('claim_event',NULL,'death','Animal or livestock death','{}',5),('claim_event',NULL,'theft','Theft','{}',6),
 ('claim_event',NULL,'fire','Fire','{}',7),('claim_event',NULL,'accident','Accident','{}',8),
 ('payout_purpose',NULL,'settlement','Seller settlement','{}',1),('payout_purpose',NULL,'wage','Worker wage','{}',2),
 ('delivery_method',NULL,'self_pickup','Self pickup','{}',1),('delivery_method',NULL,'tenant_delivery','Tenant delivery','{}',2),
 ('export_doc',NULL,'bol','Bill of Lading','{}',1),('export_doc',NULL,'awb','Air Waybill','{}',2),('export_doc',NULL,'commercial_invoice','Commercial Invoice','{}',3),('export_doc',NULL,'packing_list','Packing List','{}',4),('export_doc',NULL,'coo','Certificate of Origin','{}',5),('export_doc',NULL,'phyto','Phytosanitary Certificate','{}',6),('export_doc',NULL,'fumigation','Fumigation Certificate','{}',7),('export_doc',NULL,'insurance','Marine Insurance','{}',8),('export_doc',NULL,'inspection','Inspection Certificate','{}',9),
 ('irrigation',NULL,'rainfed','Rainfed','{}',1),('irrigation',NULL,'canal','Canal','{}',2),('irrigation',NULL,'borewell','Borewell','{}',3),('irrigation',NULL,'drip','Drip','{}',4),('irrigation',NULL,'sprinkler','Sprinkler','{}',5),
 ('weather_alert',NULL,'heavy_rain','Heavy rain','{}',1),('weather_alert',NULL,'drought','Drought','{}',2),('weather_alert',NULL,'frost','Frost','{}',3),('weather_alert',NULL,'hail','Hail','{}',4),('weather_alert',NULL,'heatwave','Heatwave','{}',5),('weather_alert',NULL,'cyclone','Cyclone','{}',6),('weather_alert',NULL,'pest_risk','Pest risk','{}',7),
 ('loan_kind',NULL,'kcc','Kisan Credit Card','{}',1),('loan_kind',NULL,'crop','Crop loan','{}',2),('loan_kind',NULL,'tractor','Tractor loan','{}',3),('loan_kind',NULL,'dairy','Dairy loan','{}',4),('loan_kind',NULL,'whr','Warehouse receipt loan','{}',5),('loan_kind',NULL,'gold','Gold loan','{}',6),('loan_kind',NULL,'bnpl','Buy-now-pay-later','{}',7),('loan_kind',NULL,'shg','SHG group loan','{}',8),('loan_kind',NULL,'tenant_wc','Tenant working capital','{}',9),
 ('scheme_category',NULL,'income_support','Income support','{}',1),('scheme_category',NULL,'insurance','Insurance','{}',2),('scheme_category',NULL,'credit','Credit','{}',3),('scheme_category',NULL,'mechanisation','Mechanisation','{}',4),('scheme_category',NULL,'irrigation','Irrigation','{}',5),('scheme_category',NULL,'livestock','Livestock','{}',6),('scheme_category',NULL,'subsidy','Input subsidy','{}',7),('scheme_category',NULL,'women','Women farmers','{}',8)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;


-- M09 education: course topic vocabulary (global lookup_values)
INSERT INTO lookup_types (code,default_name,is_tenant_extendable) VALUES ('course_topic','Course topic',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('course_topic',NULL,'crop_care','Crop care','{}',1),('course_topic',NULL,'soil','Soil health','{}',2),
 ('course_topic',NULL,'pest','Pest & disease','{}',3),('course_topic',NULL,'organic','Organic farming','{}',4),
 ('course_topic',NULL,'business','Agri-business','{}',5),('course_topic',NULL,'finlit','Financial literacy','{}',6),
 ('course_topic',NULL,'schemes','Govt schemes','{}',7),('course_topic',NULL,'digital','Digital skills','{}',8),
 ('course_topic',NULL,'safety','Farm safety','{}',9)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;


-- ambassadors: tier vocabulary (global lookup_values)
INSERT INTO lookup_types (code,default_name,is_tenant_extendable) VALUES ('ambassador_tier','Ambassador tier',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('ambassador_tier',NULL,'trainee','Trainee','{}',1),('ambassador_tier',NULL,'ambassador','Ambassador','{}',2),
 ('ambassador_tier',NULL,'senior','Senior ambassador','{}',3),('ambassador_tier',NULL,'cluster_lead','Cluster lead','{}',4),
 ('ambassador_tier',NULL,'district_coordinator','District coordinator','{}',5)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;


-- support: ticket category vocabulary (type declared above; values here)
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('ticket_category',NULL,'payment','Payment','{}',1),('ticket_category',NULL,'kyc','KYC','{}',2),
 ('ticket_category',NULL,'order','Order','{}',3),('ticket_category',NULL,'dispute','Dispute','{}',4),
 ('ticket_category',NULL,'technical','Technical','{}',5),('ticket_category',NULL,'safety','Safety','{}',6),
 ('ticket_category',NULL,'emergency_vet','Emergency vet','{}',7),('ticket_category',NULL,'women_safety','Women safety','{}',8)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;

-- ai-governance / moderation: report reason vocabulary (type 'report_reason' declared above; values here)
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('report_reason',NULL,'spam','Spam or repetitive content','{}',1),('report_reason',NULL,'fraud','Fraud or scam','{}',2),
 ('report_reason',NULL,'counterfeit','Counterfeit / misrepresented produce','{}',3),('report_reason',NULL,'inappropriate','Inappropriate or offensive content','{}',4),
 ('report_reason',NULL,'harassment','Harassment or abuse','{}',5),('report_reason',NULL,'prohibited','Prohibited / illegal item','{}',6),
 ('report_reason',NULL,'misinformation','Misinformation','{}',7),('report_reason',NULL,'other','Other','{}',99)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;

-- logistics fleet: the vehicle_type vocabulary (PC-56 TENANT-5b). The TYPE was declared in this file's first
-- statement from the beginning and NOT ONE VALUE was ever inserted — so `vehicles.vehicle_type_id` (0007, whose
-- own comment names exactly this list) could never be set to anything, every vehicle on the platform carried a
-- NULL type, and W229's "type from the lookup (bike, tempo, truck, reefer_7mt, tractor_trolley)" had no source
-- to read and no options to offer on its register form. A vocabulary with a type and no values.
--
-- `meta.refrigerated` records which types ARE reefers, so a register form can default `is_refrigerated`
-- honestly instead of leaving an operator to tick a box that contradicts the type they just chose. It is a
-- default, not a constraint: a retrofitted insulated tempo is real, and `is_refrigerated` stays the column the
-- cold-chain gate reads.
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('vehicle_type',NULL,'bike','Bike','{"refrigerated":false,"typicalCapacityKg":30}',1),
 ('vehicle_type',NULL,'tempo','Tempo','{"refrigerated":false,"typicalCapacityKg":1500}',2),
 ('vehicle_type',NULL,'truck','Truck','{"refrigerated":false,"typicalCapacityKg":7000}',3),
 ('vehicle_type',NULL,'reefer_7mt','Reefer (7 MT)','{"refrigerated":true,"typicalCapacityKg":7000}',4),
 ('vehicle_type',NULL,'tractor_trolley','Tractor + trolley','{"refrigerated":false,"typicalCapacityKg":3000}',5)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;

-- logistics fleet · the RC as a DOCUMENT TYPE (PC-56 TENANT-5b). `vehicles.rc_doc_id` (0007) points at a
-- `kyc_documents` row, and `kyc_documents.doc_type_id` points at this vocabulary — which held four values
-- (aadhaar, pan, land_record, gst_cert) while 0003's own comment names the type as
-- "aadhaar|pan|land_record|license_form20|organic_cert|vet_degree|dl|rc…". So a registration certificate could not
-- be CLASSIFIED as one: even if an FPO had uploaded an RC, there was no doc type to file it under, and W229's RC
-- column had nothing to read at the far end of its own foreign key.
--
-- Only `rc` is added here, by the wave that owns the fleet register. The other four 0003 promised — `dl` (a
-- rider's driving licence), `license_form20` (agri-input retail), `organic_cert` (organic listings) and
-- `vet_degree` (livestock services) — are still missing and belong to the waves that own those planes; naming them
-- here is the record, and adding values nobody reads would be its own defect.
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('doc_type',NULL,'rc','Vehicle registration certificate','{"subject":"vehicle"}',5)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;

-- logistics · WHY A DELIVERY FAILED (PC-56 TENANT-5d). W244 draws five bars over 90 days of failed attempts —
-- gate closed · reschedule · address · vehicle · weather — and starts a call-ahead policy pilot on what they say.
-- The reason a delivery failed was written to NO COLUMN of this database (the API took it, the domain put it in an
-- outbox payload, and the only writer of a status hop recorded `note = NULL`), so there was nothing to group and
-- no vocabulary to group it by. 0154 adds `shipment_events.reason_code`; this is the vocabulary it resolves against.
--
-- TENANT-EXTENDABLE on purpose (`is_tenant_extendable = true` above): the five classes the canon draws are the ones
-- a Gujarat FPO's riders hit, and a tenant in the hills will need "road closed" and one on an island will need
-- "ferry missed". A platform-wide enum would make every such tenant file their real reason under `other` and lose
-- the very signal this chart exists to produce.
--
-- `other` is seeded deliberately, and it is NOT the same thing as an unrecorded reason: `other` means an operator
-- looked at the list and none of it fit (with their own words in `note`), while a NULL `reason_code` means nobody
-- was ever asked. The desk reports those two separately — as `other` and as `unclassified` — because collapsing
-- them would hide how much of a tenant's history predates the column.
INSERT INTO lookup_types (code,default_name,is_tenant_extendable) VALUES
 ('shipment_failure_reason','Failed-delivery reason',true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order) VALUES
 ('shipment_failure_reason',NULL,'gate_closed','Gate closed / nobody at the drop point','{"actionable":"call_ahead"}',1),
 ('shipment_failure_reason',NULL,'reschedule_requested','Buyer asked to reschedule','{"actionable":"slot_booking"}',2),
 ('shipment_failure_reason',NULL,'address_problem','Address wrong, incomplete or unreachable','{"actionable":"address_fix"}',3),
 ('shipment_failure_reason',NULL,'vehicle_problem','Vehicle breakdown or no vehicle available','{"actionable":"fleet"}',4),
 ('shipment_failure_reason',NULL,'weather','Weather or road conditions','{"actionable":"none"}',5),
 ('shipment_failure_reason',NULL,'other','Something else (see the note)','{"actionable":"read_note"}',6)
ON CONFLICT (type_code,tenant_id,code) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- PC-56 TENANT-6c-4 · MILK BILL DEDUCTION TYPES — W169's "each line itemised"
-- ---------------------------------------------------------------------------------------------------------------
-- Before this, the vocabulary a cooperative's withholdings move by lived in a COMMENT: 0009_livestock_dairy.sql, on
-- `milk_bills.deductions`, reads `-- [{type:'feed_credit'|'loan_emi'|'insurance'|'share', amount_minor}]` while the
-- column accepted any 40-character string the caller sent. Law 6 exactly inverted.
--
-- `is_tenant_extendable = false`, and that is the Rule-Zero call: a tenant-invented deduction type would be a line
-- whose money has nowhere to go — a family's milk cheque short by an amount with no receivable to pay. A cooperative
-- chooses which of these it uses; it cannot invent a new kind of withholding.
--
-- `meta.destination` names the mechanism that moves the money, and `meta.unsupported_reason` is the refusal an
-- operator READS when there isn't one — in the data, beside the vocabulary, rather than in a string in a service.
--
-- ALSO INSERTED BY MIGRATION 0160, identically and idempotently: that migration backfills a FK against these rows,
-- and TENANT-6c-2 established that seeds run AFTER migrations. The seed states the desired vocabulary for a fresh
-- install; the migration is what a database that already exists gets. Neither is allowed to diverge from the other.
-- **`ON CONFLICT (type_code,tenant_id,code)` CANNOT FIRE FOR A PLATFORM ROW.** `tenant_id IS NULL` and Postgres
-- treats NULLs as DISTINCT in a unique index unless it is declared `NULLS NOT DISTINCT`, which 0001's is not. So every
-- `ON CONFLICT DO NOTHING` above this line is decoration for platform values, this file is NOT idempotent, and a
-- freshly built database carries 139 duplicated codes out of 311 — including `ledger_txn_type`, `payment_purpose` and
-- `boost_tier` (whose price lives in `meta`). Named in migration 0160's header and ESCALATED: de-duplicating them
-- means repointing FKs on the ledger, which needs a CODEOWNERS review and a founder ruling, not a dairy wave.
-- This block uses `WHERE NOT EXISTS` so at least the vocabulary a milk bill's deduction FKs cannot be duplicated.
INSERT INTO lookup_types (code,default_name,is_tenant_extendable)
SELECT 'milk_deduction','Milk bill deduction type',false
 WHERE NOT EXISTS (SELECT 1 FROM lookup_types WHERE code='milk_deduction');

INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
 ('milk_deduction','feed_credit','Feed / input credit','{"destination":"member_credit","source_type":"dairy_member_credit"}',1),
 ('milk_deduction','loan_emi','Loan instalment','{"destination":"loan","source_type":"loan"}',2),
 ('milk_deduction','insurance','Insurance premium','{"destination":"none","unsupported_reason":"A premium is collected through the payments module as a gateway intent (insurance_policy) and activated by payments.payment_succeeded. There is no wallet-settled premium path, so a milk-bill deduction has nothing to pay into. Belongs to the insurance module."}',3),
 ('milk_deduction','share','Cooperative share allotment','{"destination":"none","unsupported_reason":"The registry wave already ruled on this: the deduction, the consent record and the share certificate are one money movement, and coop_share_registers has no allotment act. Offering the deduction alone would take a family''s money for a certificate that never arrives."}',4)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code=v.type_code AND x.tenant_id IS NULL AND x.code=v.code);
