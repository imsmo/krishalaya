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
 -- [PC-56 TENANT-6d-6] DAIRY'S SECOND VERB. W170: "playbook overrides are operator + dairy lead together" - a
 -- diversion sends 87 families to another village for a shift, and one person's word is not enough. TENANT-6c-3
 -- observed in this very file that every sibling vertical has two verbs while dairy had only `manage`, which is why
 -- farmers had once been given it. This is the checker's verb, and it is deliberately NOT `settlement.close`: that is
 -- a money permission a cooperative may have given to a treasurer who has no business moving a village's milk.
 ('dairy.override','Approve dairy playbook overrides (divert a shift)','M16'),
 ('equipment.manage','Manage equipment assets + rates + rental fulfilment','M20'),('equipment.rent','Rent equipment (request/confirm bookings)','M20'),
 ('warehouse.manage','Manage warehouses + storage + assays + eNWR','M21'),('warehouse.store','Deposit produce in a warehouse','M21'),
 ('contract.manage','Manage farming contracts + advances + settlement','M22'),('contract.grow','Participate as a contract grower','M22'),
 ('export.manage','Manage exporter registrations + export shipments + docs','M23'),
 ('land.manage','Manage own land parcels + crop seasons + soil tests','M24'),
 ('loan.borrow','Apply for + repay loans','M19'),('loan.manage','Review/approve/disburse loans (lender officer)','M19'),
 ('insurance.enrol','Enrol in / cancel an insurance policy','M19'),('insurance.manage','Manage insurance products + policies (insurer/tenant admin)','M19'),
 ('scheme.apply','Apply to government schemes','M17'),
 ('service.offer','List + manage own service offerings + drive booking lifecycle','M30'),('service.book','Request + complete-and-pay service bookings','M30'),
 ('notification.manage','Read the notification event catalogue, the tenant delivery log and the broadcast history','M13'),
 -- [PC-56 TENANT-8a] TEMPLATE AUTHORING WAS ON `notification.manage`, HELD BY THE SUPPORT AGENT (F-19): the same key that
 -- messages every member also rewrote what every member receives, and there was no checker. Two verbs now — the author's
 -- and the checker's — and maker ≠ checker is 0175's trigger, so a holder of both still cannot approve their own words.
 ('notification.templates.manage','Write a notification template override (draft), submit it, withdraw your own','M13'),
 ('notification.templates.approve','Approve / reject a colleague''s template override; retire an override','M13'),
 -- [PC-56 TENANT-8e] BROADCAST-TO-EVERYONE WAS ON `notification.manage`, HELD BY THE SUPPORT AGENT (F-19): one key let a
 -- support agent message every member of the cooperative. The send is its own verb now, tenant_admin only. Drafting,
 -- sending and cancelling a broadcast are one verb (W429 draws no checker); `notification.manage` keeps the READ.
 ('notification.broadcast.send','Draft, send, schedule and cancel an announcement to the cooperative''s members (in-app + push)','M13'),
 ('notification.whatsapp.policy.manage','Record the cooperative''s WhatsApp opt-in policy (consent is not collected: no provider)','M13'),
 ('message.moderate','Moderate chat: review/unflag/lock conversations','M13'),
 -- [PC-56 TENANT-9a] THE KYC DESK HAD NO VERB OF ITS OWN (F-18): review was `user.approve`. Two now — the maker's
 -- (`kyc.manage`: the organisation's own documents, a member's on their behalf) and the desk's (`kyc.review`). Maker ≠
 -- checker and "the organisation's admin never certifies the organisation" are 0180's trigger. Also in migration 0180.
 ('kyc.manage','Upload the organisation''s KYC documents; submit a member''s document on their behalf','M01'),
 ('kyc.review','Verification desk: verify, reject or ask for more on a KYC document (never one you submitted, never your own, never your organisation''s as its admin)','M01'),
 -- [PC-56 TENANT-9c] A GST CREDIT NOTE WAS ISSUED ON `report.view` (F-8) — a read code the auditor, the gov officer and the
 -- support agent hold. It is a money verb of its own now, tenant_admin only. `kyc.read` / `governance.read` are the canon's
 -- auditor reads as real rows. Also in migration 0181.
 ('payments.credit_note.issue','Issue a GST credit note against an approved proposal (a money verb — never report.view)','M05'),
 ('kyc.read','Read the KYC desk — the organisation''s documents, the member desk and the queue (no act, no reveal)','M01'),
 ('governance.read','Read the share register, the resolutions and their tallies (never an individual ballot)','M04'),
 -- [PC-56 TENANT-9b] DRAFTING AND OPENING / CLOSING A VOTE WAS `tenant.settings` (F-18) — the code that edits a cooperative's
 -- settings. Its own verb now; a special or dividend vote is closed by a second person (0182's trigger). Also in 0182.
 ('governance.manage','Draft a resolution, edit a draft, open and close voting, withdraw (recorded; a special or dividend vote is closed by a second person)','M04'),
 -- [PC-56 TENANT-9d] ESG HAD NO VERB (F-18 — "the tenant compliance role" names no row). Two now: the read and the disclosure
 -- (words, never figures; the unsigned export). The auditor's five reads are unchanged. Also in migration 0183.
 ('esg.read','Read the ESG dashboard, the method registry, the report checklist and its receipts (figures only where a published method meets a recorded fact)',NULL),
 ('esg.disclose','Write, publish and withdraw the cooperative''s own ESG disclosures (words, never figures); generate the unsigned ESG export',NULL),
 ('course.author','Author courses + lessons (instructor)','M09'),('course.publish','Review/publish/pause courses (editor)','M09'),
 ('channel.host','Register external content channels + publish resources + host live sessions','M09'),('content.moderate','Approve/suspend channels + take down resources (M09)','M09'),
 ('ambassador.manage','Enroll/suspend/edit ambassadors + activate referrals (payouts are ambassador.payout)','M-AMB'),
 -- [PC-56 TENANT-10a] THE PAYOUT GETS ITS OWN VERB (F-3). `ambassador.manage` is held by support_agent too, and a payout moves
 -- platform money to a village agent; the verb that moves it is tenant_admin's only. Also in migration 0184.
 ('ambassador.payout','Run ambassador commission payouts','M-AMB'),
 -- [PC-56 TENANT-11a] THE AUCTION DESK'S VERBS (F-10). Staff schedule FOR a seller and record a seller's decision only with
 -- the seller's recorded consent (auction_consents); a live auction is stopped by tenant_admin only, with a reason. Also in 0186.
 ('auction.read','Read an auction''s bid stream (bidders masked as B1…Bn)','M04'),
 ('auction.schedule_on_behalf','Schedule an auction for a seller, and record the seller''s decision, each with the seller''s recorded consent','M04'),
 ('auction.cancel_live','Cancel a live auction (reason mandatory; every bidder notified, every EMD released)','M04'),
 ('auction.pause_entry','Pause / resume NEW bidders entering a live auction (existing bidders continue; reason recorded)','M04'),
 ('support.handle','Handle support tickets: assign/respond/transition/resolve','M50'),
 ('cms.manage','Retired in TENANT-8d — no route checks it (pages: cms.pages.*; banners: cms.banners.manage)','M50'),
 -- [PC-56 TENANT-8d] THE BANNERS GET THEIR OWN VERB. A banner reaches EVERY member's home screen (and the canon links offers
 -- to it), so it is not a page draft a support agent writes (cms.pages.manage) and not a page publish either: one verb
 -- writes, activates, pauses, resumes, archives and reorders a banner, held by tenant_admin only. `cms.manage` is
 -- retired: after this wave no route, service or policy reads it (grep in the 8d report); the row stays, inert, so a
 -- role grant that names it never dangles.
 ('cms.banners.manage','Write, activate, pause, resume, archive and reorder the cooperative''s app banners','M50'),
 -- [PC-56 TENANT-8c] ONE KEY WROTE, PUBLISHED AND CHECKED EVERY PAGE (F-19): `cms.manage` (tenant_admin only) authored a
 -- page, published it and archived it, and a POLICY page — terms, privacy, refund: what binds the cooperative to its
 -- members — went live on one person's word. Two verbs now: the author's and the checker's. Maker ≠ checker on a policy
 -- page is 0177's trigger, so a holder of both still cannot publish a policy page they wrote or last edited.
 ('cms.pages.manage','Write CMS pages and FAQ entries (drafts), restore an archived version as a draft, reorder the FAQ','M50'),
 ('cms.pages.publish','Publish or archive a CMS page version (a policy page: never one you wrote or last edited)','M50'),
 ('market.manage','Ingest mandi prices + generate fair-price predictions','M16'),
 ('trace.manage','Create trace lots + append farm-to-fork journey events','M16'),
 ('bulk.import','Create + manage bulk CSV import jobs',NULL)
ON CONFLICT (code) DO NOTHING;
-- [PC-56 TENANT-8c] `cms.manage` no longer touches pages; its name says so on a database seeded before this wave too.
-- [PC-56 TENANT-8d] … and it no longer touches banners either: retired, and its name says so.
UPDATE permissions SET default_name = 'Retired in TENANT-8d — no route checks it (pages: cms.pages.*; banners: cms.banners.manage)'
 WHERE code = 'cms.manage' AND default_name IS DISTINCT FROM 'Retired in TENANT-8d — no route checks it (pages: cms.pages.*; banners: cms.banners.manage)';
-- [PC-56 TENANT-8a] `notification.manage` no longer authors templates; its name says so on a database seeded before
-- this wave too (the INSERT above does nothing to an existing row). Re-runnable: a second run changes nothing.
-- [PC-56 TENANT-8e] … and no longer SENDS a broadcast either (notification.broadcast.send): it reads.
UPDATE permissions SET default_name = 'Read the notification event catalogue, the tenant delivery log and the broadcast history'
 WHERE code = 'notification.manage' AND default_name IS DISTINCT FROM 'Read the notification event catalogue, the tenant delivery log and the broadcast history';

-- grants (sample of the full PRD §10 matrix; complete in admin UI)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code='farmer'        AND p.code IN ('listing.create','listing.update','listing.publish','order.create','offer.create','requirement.post','auction.bid','wallet.view','worker.book'))
   OR (r.code='vyapari'       AND p.code IN ('order.create','offer.create','requirement.post','auction.bid','auction.create','wallet.view'))
   OR (r.code='tenant_admin'  AND p.code IN ('listing.approve','listing.moderate','order.manage','user.approve','dispute.resolve','report.view','tenant.settings','payout.approve','wallet.adjust','booking.manage','logistics.manage','promotion.manage','membership.manage'))
   OR (r.code='support_agent' AND p.code IN ('dispute.resolve','report.view'))
   -- [PC-56 TENANT-9c] THE AUDITOR'S SET IS EXACTLY FIVE READS (0181); the AuditorReadOnlyGuard refuses it every non-GET.
   OR (r.code='auditor'       AND p.code IN ('ledger.read','report.view','audit.read','kyc.read','governance.read'))
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
   -- [PC-56 TENANT-6c-3] `dairy_farmer` REMOVED from this grant. `dairy.manage` is the cooperative/MCC OPERATOR's verb
   -- — create MCCs and rate cards, enrol members, record collections, generate/approve/PAY milk bills — and granting it
   -- to a farmer role let any member set what every other member is paid and pay a bill out of the cooperative's
   -- wallet. Every sibling vertical in this file has two verbs (loan.borrow / loan.manage, insurance.enrol /
   -- insurance.manage, contract.grow / contract.manage); dairy has only the manage verb, which is why farmers were
   -- given it. Nothing a member does needs it: every member-facing dairy route authorises by OWNERSHIP and carries no
   -- permission at all. Migration 0159 removes it from installs that already ran this seed.
   OR (r.code IN ('tenant_admin') AND p.code IN ('dairy.manage','dairy.override'))
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
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('notification.templates.manage'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('notification.templates.approve'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('notification.broadcast.send','notification.whatsapp.policy.manage'))
   OR (r.code IN ('tenant_admin','support_agent','ai_ops') AND p.code IN ('message.moderate'))
   -- [PC-56 TENANT-7d] THE INSTRUCTOR ROLE HELD NO VERB. `instructor` ("Education Instructor", M09, line 16 above) was
   -- seeded with NO permission at all: a member given the platform's own instructor role could not author a course,
   -- while six other roles could. The role's one verb is course.author.
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','vet','instructor','tenant_admin') AND p.code IN ('course.author'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('course.publish'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','vet','tenant_admin') AND p.code IN ('channel.host'))
   OR (r.code IN ('tenant_admin','support_agent','ai_ops') AND p.code IN ('content.moderate'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('ambassador.manage'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('support.handle'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('cms.manage'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('cms.banners.manage'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('cms.pages.manage'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('cms.pages.publish'))
   OR (r.code IN ('tenant_admin','support_agent') AND p.code IN ('market.manage'))
   OR (r.code IN ('farmer','pashupalak','dairy_farmer','vyapari','organic_store','pharma_store','fpo_coordinator','tenant_admin') AND p.code IN ('trace.manage'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('bulk.import'))
   -- [PC-56 TENANT-9a] the verification desk (0180). `member.pii.reveal` is NOT widened to the coordinator (0128's ruling):
   -- a desk officer who must open evidence is given the reveal by a staff override, a decision somebody records.
   OR (r.code IN ('tenant_admin') AND p.code IN ('kyc.manage','kyc.review'))
   OR (r.code IN ('fpo_coordinator') AND p.code IN ('kyc.review'))
   -- [PC-56 TENANT-9c] the credit note's own money verb (no tenant finance role exists) and the two reads (0181).
   OR (r.code IN ('tenant_admin') AND p.code IN ('payments.credit_note.issue','kyc.read','governance.read'))
   -- [PC-56 TENANT-9b] the resolutions' acts (0182). No board role exists; the canon's "Drafting is board members" is named.
   OR (r.code IN ('tenant_admin') AND p.code IN ('governance.manage'))
   -- [PC-56 TENANT-9d] ESG (0183). No compliance or finance role exists; the canon's "tenant compliance role" is named.
   OR (r.code IN ('tenant_admin','fpo_coordinator') AND p.code IN ('esg.read'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('esg.disclose'))
   -- [PC-56 TENANT-10a] the ambassador payout's own money verb (0184). `ambassador.manage` keeps enrol/suspend/activate.
   OR (r.code IN ('tenant_admin') AND p.code IN ('ambassador.payout'))
   -- [PC-56 TENANT-11a] the auction desk (0186). `auction.read` is broad (the bid stream is masked server-side).
   OR (r.code IN ('farmer','vyapari','customer','dairy_farmer','pashupalak','organic_store','pharma_store','fpo_coordinator','tenant_admin',
                  'tenant_staff','ambassador','sardar','support_agent','ai_ops') AND p.code IN ('auction.read'))
   OR (r.code IN ('tenant_admin','fpo_coordinator') AND p.code IN ('auction.schedule_on_behalf'))
   OR (r.code IN ('tenant_admin') AND p.code IN ('auction.cancel_live','auction.pause_entry'))
ON CONFLICT DO NOTHING;
