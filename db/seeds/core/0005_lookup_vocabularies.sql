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
