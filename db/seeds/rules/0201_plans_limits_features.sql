-- 0201 · plans, plan_features, plan_limits (Revenue Playbook tiers as DATA) · [P1]
INSERT INTO features (code,default_name,module_code,description) VALUES
 ('bidding','Bidding/Auctions','M04',NULL),('voice_listing','Voice listing','M03',NULL),
 ('ai_grading','AI photo grading','M03',NULL),('whatsapp_commerce','WhatsApp commerce','M13',NULL),
 ('labour','Labour marketplace','M28',NULL),('dairy_mcc','Dairy MCC','M16',NULL),
 ('ambassador_network','Ambassador network',NULL,NULL),('custom_domain','Custom domain','M01',NULL),
 ('api_access','API access','M01',NULL),
 -- PC-56 TENANT-13d · removing the "Powered by Krishalaya" mark (trust surfaces keep it regardless). Branding itself is on every plan.
 ('white_label_unbranded','Remove "Powered by Krishalaya"','M01',NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO plans (id,code,version,default_name,country_code,currency_code,monthly_price_minor,annual_price_minor,setup_fee_minor,is_public,is_active) VALUES
 ('22222222-0000-7000-8000-000000000001','starter',1,'Starter','IN','INR',499900,4999900,0,true,true),
 ('22222222-0000-7000-8000-000000000002','growth',1,'Growth','IN','INR',1499900,14999900,2500000,true,true),
 ('22222222-0000-7000-8000-000000000003','professional',1,'Professional','IN','INR',4999900,49999900,10000000,true,true),
 ('22222222-0000-7000-8000-000000000004','enterprise',1,'Enterprise','IN','INR',0,0,0,false,true),
 ('22222222-0000-7000-8000-000000000005','government',1,'Government','IN','INR',0,0,0,false,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan_limits (plan_id,limit_code,limit_value) VALUES
 ('22222222-0000-7000-8000-000000000001','max_farmers',100),('22222222-0000-7000-8000-000000000001','max_orders_month',1000),('22222222-0000-7000-8000-000000000001','max_languages',1),
 ('22222222-0000-7000-8000-000000000002','max_farmers',5000),('22222222-0000-7000-8000-000000000002','max_orders_month',10000),('22222222-0000-7000-8000-000000000002','max_languages',3),
 ('22222222-0000-7000-8000-000000000003','max_farmers',50000),('22222222-0000-7000-8000-000000000003','max_orders_month',100000),('22222222-0000-7000-8000-000000000003','max_languages',12),
 ('22222222-0000-7000-8000-000000000004','max_farmers',-1),('22222222-0000-7000-8000-000000000004','max_orders_month',-1),('22222222-0000-7000-8000-000000000004','max_languages',-1)
ON CONFLICT (plan_id,limit_code) DO NOTHING;

INSERT INTO plan_features (plan_id,feature_code,is_included,config) VALUES
 ('22222222-0000-7000-8000-000000000001','voice_listing',true,'{}'),('22222222-0000-7000-8000-000000000001','labour',true,'{}'),
 ('22222222-0000-7000-8000-000000000002','bidding',true,'{}'),('22222222-0000-7000-8000-000000000002','voice_listing',true,'{}'),('22222222-0000-7000-8000-000000000002','labour',true,'{}'),('22222222-0000-7000-8000-000000000002','whatsapp_commerce',true,'{}'),
 ('22222222-0000-7000-8000-000000000003','bidding',true,'{}'),('22222222-0000-7000-8000-000000000003','ai_grading',true,'{}'),('22222222-0000-7000-8000-000000000003','custom_domain',true,'{}'),('22222222-0000-7000-8000-000000000003','api_access',true,'{}'),('22222222-0000-7000-8000-000000000003','ambassador_network',true,'{}'),
 ('22222222-0000-7000-8000-000000000003','white_label_unbranded',true,'{}')
ON CONFLICT (plan_id,feature_code) DO NOTHING;
