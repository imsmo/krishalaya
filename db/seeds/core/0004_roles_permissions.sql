-- 0004 · all 24 PRD roles + permission catalog + role→permission grants · [P1]
-- Dynamic RBAC: role #25 or a new permission is an INSERT here, never a deploy.
INSERT INTO roles (code,default_name,scope,requires_kyc,requires_approval,module_code) VALUES
 ('super_admin','Super Admin / SaaS Owner','platform',true,false,NULL),
 ('platform_finance','Platform Finance','platform',true,true,NULL),
 ('platform_support','Platform Support','platform',false,true,NULL),
 ('platform_compliance','Platform Compliance','platform',true,true,NULL),
 ('tenant_admin','Tenant Admin','tenant',true,true,'M01'),
 ('tenant_staff','Tenant Staff','tenant',false,true,'M01'),
 ('customer','Customer','tenant',false,false,'M01'),
 ('farmer','Farmer / Vendor','tenant',true,true,'M03'),
 ('vyapari','Vyapari / Trader','tenant',true,true,'M04'),
 ('pharma_store','Pharma / Agri-Input Store','tenant',true,true,'M10'),
 ('organic_store','Organic Store / Producer','tenant',true,true,'M11'),
 ('delivery_partner','Delivery Partner','tenant',true,true,'M07'),
 ('instructor','Education Instructor','tenant',false,true,'M09'),
 ('support_agent','Support Agent','tenant',false,true,NULL),
 ('auditor','Auditor / Accountant','tenant',false,true,NULL),
 ('ambassador','Village Ambassador','tenant',true,true,NULL),
 ('fpo_coordinator','FPO Coordinator','tenant',true,true,NULL),
 ('ai_ops','AI Operations Officer','tenant',false,true,NULL),
 ('pashupalak','Pashupalak / Livestock Farmer','tenant',true,true,'M15'),
 ('dairy_farmer','Dairy Farmer / MCC Operator','tenant',true,true,'M16'),
 ('vet','Veterinarian / AI Inseminator','tenant',true,true,'M15'),
 ('banker','Banker / NBFC Loan Officer','tenant',true,true,'M19'),
 ('insurance_agent','Insurance Agent / Surveyor','tenant',true,true,'M19'),
 ('equipment_owner','Equipment Owner / CHC Operator','tenant',true,true,'M20'),
 ('gov_officer','Government Officer / Scheme Operator','tenant',true,true,'M17'),
 ('worker','Agricultural Worker','tenant',true,true,'M28'),
 ('sardar','Sardar / Mukadam','tenant',true,true,'M28')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code,default_name,module_code) VALUES
 ('listing.create','Create listing','M03'),('listing.update','Edit listing','M03'),
 ('listing.publish','Publish listing','M03'),('listing.approve','Approve listing','M03'),
 ('listing.moderate','Moderate/hide listing','M03'),
 ('order.create','Place order','M06'),('order.manage','Manage orders','M06'),
 ('offer.create','Make/respond to listing offers','M03'),
 ('requirement.post','Post a requirement (demand)','M12'),('requirement.quote','Quote on a requirement','M12'),
 ('logistics.manage','Manage shipments / dispatch','M07'),
 ('review.create','Write a verified-purchase review','M03'),('review.moderate','Moderate reviews','M03'),
 ('dispute.raise','Raise an order dispute',NULL),
 ('promotion.manage','Manage promotions + coupons','M03'),
 ('membership.manage','Manage membership tiers','M13'),
 ('auction.bid','Place bid','M04'),('auction.create','Create auction','M04'),
 ('wallet.view','View wallet','M05'),('wallet.adjust','Manual wallet adjust','M05'),
 ('payout.approve','Approve payouts','M05'),
 ('user.approve','Approve users (KYC)','M01'),('user.impersonate','Impersonate user','M01'),
 ('dispute.resolve','Resolve disputes',NULL),('report.view','View reports',NULL),
 ('tenant.settings','Manage tenant settings','M01'),('flag.toggle','Toggle feature flags',NULL),
 ('worker.book','Book worker','M28'),('booking.manage','Manage labour bookings','M28'),
 ('ledger.read','Read ledger (auditor)','M05'),('scheme.process','Process scheme applications','M17'),
 ('audit.read','Read the append-only audit trail (auditor)',NULL),
 ('ai.review','AI review queue',NULL),('plan.manage','Manage plans (god mode)',NULL),
 ('tenant.manage','Manage tenants (god mode)',NULL),
 ('product.manage','Manage own products + batches','M02'),
 ('catalogue.configure','Enable/disable categories for the tenant','M02'),
 ('animal.manage','Manage own animals (livestock registry)','M15'),('vet.book','Book a veterinarian','M15'),('vet.manage','Manage vet profile + services','M15'),
 ('dairy.manage','Manage dairy MCC + collections + milk bills','M16'),
 ('equipment.manage','Manage equipment assets + rates + rental fulfilment','M20'),('equipment.rent','Rent equipment (request/confirm bookings)','M20'),
 ('warehouse.manage','Manage warehouses + storage + assays + eNWR','M21'),('warehouse.store','Deposit produce in a warehouse','M21'),
 ('contract.manage','Manage farming contracts + advances + settlement','M22'),('contract.grow','Participate as a contract grower','M22'),
 ('export.manage','Manage exporter registrations + export shipments + docs','M23'),
 ('land.manage','Manage own land parcels + crop seasons + soil tests','M24'),
 ('loan.borrow','Apply for + repay loans','M19'),('loan.manage','Review/approve/disburse loans (lender officer)','M19'),
 ('insurance.enrol','Enrol in / cancel an insurance policy','M19'),('insurance.manage','Manage insurance products + policies (insurer/tenant admin)','M19'),
 ('scheme.apply','Apply to government schemes','M17'),
 ('service.offer','List + manage own service offerings + drive booking lifecycle','M30'),('service.book','Request + complete-and-pay service bookings','M30'),
 ('notification.manage','Author notification templates + read tenant delivery log','M13'),
 ('message.moderate','Moderate chat: review/unflag/lock conversations','M13'),
 ('course.author','Author courses + lessons (instructor)','M09'),('course.publish','Review/publish/pause courses (editor)','M09'),
 ('channel.host','Register external content channels + publish resources + host live sessions','M09'),('content.moderate','Approve/suspend channels + take down resources (M09)','M09'),
 ('ambassador.manage','Enroll/suspend ambassadors + activate referrals + run commission payouts','M-AMB'),
 ('support.handle','Handle support tickets: assign/respond/transition/resolve','M50'),
 ('cms.manage','Author/publish CMS pages + manage banners','M50'),
 ('market.manage','Ingest mandi prices + generate fair-price predictions','M16'),
 ('trace.manage','Create trace lots + append farm-to-fork journey events','M16'),
 ('bulk.import','Create + manage bulk CSV import jobs',NULL)
ON CONFLICT (code) DO NOTHING;

-- grants (sample of the full PRD §10 matrix; complete in admin UI)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code='farmer'        AND p.code IN ('listing.create','listing.update','listing.publish','order.create','offer.create','requirement.post','auction.bid','wallet.view','worker.book'))
   OR (r.code='vyapari'       AND p.code IN ('order.create','offer.create','requirement.post','auction.bid','auction.create','wallet.view'))
   OR (r.code='tenant_admin'  AND p.code IN ('listing.approve','listing.moderate','order.manage','user.approve','dispute.resolve','report.view','tenant.settings','payout.approve','wallet.adjust','booking.manage','logistics.manage','promotion.manage','membership.manage'))
   OR (r.code='support_agent' AND p.code IN ('dispute.resolve','report.view'))
   OR (r.code='auditor'       AND p.code IN ('ledger.read','report.view','audit.read'))
   OR (r.code='tenant_admin'  AND p.code IN ('audit.read'))
   OR (r.code='ai_ops'        AND p.code IN ('ai.review','listing.moderate'))
   OR (r.code='super_admin'   AND p.code IN ('plan.manage','tenant.manage','user.impersonate','flag.toggle'))
   OR (r.code='gov_officer'   AND p.code IN ('scheme.process','report.view'))
   OR (r.code='tenant_admin'  AND p.code IN ('product.manage','catalogue.configure'))
   OR (r.code IN ('farmer','pharma_store','organic_store','vyapari') AND p.code IN ('product.manage','order.manage'))
   OR (r.code IN ('farmer','vyapari','pharma_store','organic_store') AND p.code IN ('requirement.quote'))
   OR (r.code IN ('farmer','vyapari','customer','pharma_store','organic_store') AND p.code IN ('review.create'))
   OR (r.code IN ('tenant_admin','support_agent','ai_ops') AND p.code IN ('review.moderate'))
   OR (r.code IN ('farmer','vyapari','customer','pharma_store','organic_store') AND p.code IN ('dispute.raise'))
   OR (r.code='customer' AND p.code IN ('order.create','offer.create','requirement.post'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer') AND p.code IN ('animal.manage','vet.book'))
   OR (r.code='vet' AND p.code IN ('vet.manage','animal.manage'))
   OR (r.code='tenant_admin' AND p.code IN ('vet.manage'))
   OR (r.code IN ('dairy_farmer','tenant_admin') AND p.code IN ('dairy.manage'))
   OR (r.code='equipment_owner' AND p.code IN ('equipment.manage','equipment.rent'))
   OR (r.code IN ('farmer','pashupalak','vyapari','customer') AND p.code IN ('equipment.rent'))
   OR (r.code='tenant_admin' AND p.code IN ('warehouse.manage'))
   OR (r.code IN ('farmer','vyapari','customer') AND p.code IN ('warehouse.store'))
   OR (r.code IN ('vyapari','tenant_admin') AND p.code IN ('contract.manage'))
   OR (r.code IN ('farmer','pashupalak') AND p.code IN ('contract.grow'))
   OR (r.code IN ('vyapari','tenant_admin') AND p.code IN ('export.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer') AND p.code IN ('land.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari') AND p.code IN ('loan.borrow'))
   OR (r.code IN ('banker','tenant_admin') AND p.code IN ('loan.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari') AND p.code IN ('insurance.enrol'))
   OR (r.code IN ('insurance_agent','tenant_admin') AND p.code IN ('insurance.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','customer') AND p.code IN ('scheme.apply'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','vet','equipment_owner') AND p.code IN ('service.offer'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','customer') AND p.code IN ('service.book'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('notification.manage'))
   OR (r.code IN ('tenant_admin','support_agent','ai_ops') AND p.code IN ('message.moderate'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','vet','tenant_admin') AND p.code IN ('course.author'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('course.publish'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','vet','tenant_admin') AND p.code IN ('channel.host'))
   OR (r.code IN ('tenant_admin','support_agent','ai_ops') AND p.code IN ('content.moderate'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('ambassador.manage'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('support.handle'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('cms.manage'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('market.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','organic_store','pharma_store','fpo_coordinator','tenant_admin') AND p.code IN ('trace.manage'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('bulk.import'))
ON CONFLICT DO NOTHING;
