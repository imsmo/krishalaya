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
