-- 0008 · tenant setting registry (new setting = INSERT, never a migration) · [P1]
INSERT INTO setting_definitions (key,value_type,default_value,scope,description) VALUES
 ('order.auto_confirm_hours','int','2','tenant','Hours before unconfirmed order auto-cancels'),
 ('order.quality_window_hours','int','24','tenant','Dispute window after delivery (perishable: override 6)'),
 ('listing.approval_required','bool','false','tenant','New listings need admin approval'),
 ('review.enabled','bool','true','tenant','Reviews enabled'),
 ('delivery.free_above_minor','int','39900','tenant','Free delivery threshold (₹399)'),
 ('payout.min_threshold_minor','int','50000','tenant','Minimum payout (₹500)'),
 ('payout.cycle','string','"daily"','tenant','Settlement cycle'),
 -- branding (tenant self-config, P1-10) · strings rendered on the storefront chrome; never PII
 ('branding.display_name','string','""','tenant','Storefront display name (falls back to tenant name)'),
 ('branding.logo_url','string','""','tenant','Storefront logo URL (https only; validated in UI)'),
 ('branding.primary_color','string','""','tenant','Brand primary colour (#RRGGBB)'),
 ('branding.support_email','string','""','tenant','Public support email shown on the storefront'),
 -- languages (tenant self-config, P1-10) · which platform-active languages the storefront offers + the default
 ('languages.enabled','json','["en"]','tenant','Enabled storefront languages (codes; subset of platform-active, capped by plan max_languages)'),
 ('languages.default','string','"en"','tenant','Default storefront language code')
ON CONFLICT (key) DO NOTHING;

-- [PC-56 TENANT-12 · 0190] the floor under any member-level aggregate the digital twin prints (W422). Also in 0190.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES ('twin.min_group_size', 'int', 'platform', 'security', '5'::jsonb,
        'The smallest number of distinct members behind any member-level aggregate the digital twin prints (W422 "aggregate bands only — no member-level figures, ever"). Below it the twin says "fewer than N members — not shown".',
        'Lowering this narrows the crowd a member hides in. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- [PC-56 STORE-SWEEP-a · 0223] the eleven platform facts the Trust, Contact, About and Press pages print (founder D3/D7). An EMPTY value means
-- "not published yet" — nothing is invented; the values are set in the admin realm (platform_setting_values). Also in 0223.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description) VALUES
  ('platform.legal.entity_name', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the legal entity that operates the platform — printed on Trust & your data and Contact; empty = "not published yet".'),
  ('platform.legal.registered_office', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the registered office (one line) — printed on Trust & your data and Contact; empty = "not published yet".'),
  ('platform.grievance.officer_name', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the grievance officer''s name — the Grievances block on Trust & your data (linked from every store''s footer); empty = "not published yet".'),
  ('platform.grievance.address', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the grievance officer''s postal address; empty = "not published yet".'),
  ('platform.grievance.email', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D3/D7): the grievance mailbox — never typed in code; empty = "not published yet".'),
  ('platform.grievance.ack_hours', 'int', 'platform', 'ordinary', 'null',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the published acknowledgement time in hours (a lawyer sets it); null = not printed ("not published yet").'),
  ('platform.grievance.resolve_days', 'int', 'platform', 'ordinary', 'null',
   'PC-56 STORE-SWEEP-a (0223, founder D3): the published resolution time in days (a lawyer sets it); null = not printed ("not published yet").'),
  ('platform.contact.security_email', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D7): where a security problem is reported; empty = "not published yet".'),
  ('platform.contact.partners_email', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D7): the organisations and partners mailbox; empty = "not published yet".'),
  ('platform.contact.press_email', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D7): the press mailbox (Contact, Press and About); empty = "not published yet".'),
  ('platform.contact.general_email', 'string', 'platform', 'ordinary', '""',
   'PC-56 STORE-SWEEP-a (0223, founder D7): the general mailbox; empty = "not published yet".')
ON CONFLICT (key) DO NOTHING;
