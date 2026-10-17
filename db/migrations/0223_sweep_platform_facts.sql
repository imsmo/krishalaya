-- ==================================================================================================================
-- MIGRATION 0223 — PC-56 STORE-SWEEP-a · WHAT THE PLATFORM PROMISES IS WHAT THE CODE DOES — eleven platform facts as data
-- (survey_store_sweep.md §3 B3 / §5 item 2; founder decisions D3 (Q4) and D7 (Q10), 2026-10-17.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0222 are applied; nothing here edits them: `setting_definitions` gains ELEVEN
-- rows by INSERT … ON CONFLICT (key) DO NOTHING, the 0190 / 0194 precedent; seed core/0008 carries the same eleven rows.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written.
-- ==================================================================================================================
--
-- THE FACTS (Law 6 — a legal entity, an office, an officer and five mailboxes are business data, never strings in code; founder D3/D7):
--
--   platform.legal.entity_name        string  ""    the legal entity that operates the platform
--   platform.legal.registered_office  string  ""    its registered office (postal address, one line)
--   platform.grievance.officer_name   string  ""    the grievance officer's name
--   platform.grievance.address        string  ""    the grievance officer's postal address
--   platform.grievance.email          string  ""    the grievance mailbox
--   platform.grievance.ack_hours      int     null  the published acknowledgement time, in hours
--   platform.grievance.resolve_days   int     null  the published resolution time, in days
--   platform.contact.security_email   string  ""    where a security problem is reported
--   platform.contact.partners_email   string  ""    organisations and partners
--   platform.contact.press_email      string  ""    press
--   platform.contact.general_email    string  ""    everything else
--
-- AN EMPTY VALUE MEANS "NOT PUBLISHED YET". The storefront prints each fact when it is set and an honest "not published yet" line per fact
-- when it is empty — never a placeholder, never a guessed mailbox or domain, and never the canon's "48 hours / 30 days / Indian intermediary
-- rules" figures (a lawyer sets those; the founder publishes them here). Nothing is invented: the int facts default to JSON null, not a number.
-- The values are SET IN THE ADMIN REALM (apps/admin-api settings-ops: `platform_setting_values`, reason ≥ 20 characters, audited in
-- `platform_config_changes`) — no data migration carries a value. All eleven are `ordinary` risk (one administrator, with a reason).
--
-- THE READ: `GET /v1/storefront/platform-facts` (apps/api/src/core/tenancy-context/storefront-public.controller.ts — `@Public()`, rate-limited
-- like `stats`, no tenant) reads the eleven through `kv_platform_setting(key)` (0194: the platform_setting_values row, else this default);
-- an empty string or null answers `null`.
--
-- NO FLAG ROW — A NAMED LAW 10 EXCEPTION (the STORE-4c "never switched off" precedent): the information and legal pages (Help, the quality
-- promise, Trust & your data, Contact, About, Press) and this read get NO switch. A grievance address must not have a kill-switch.
--
-- No reserved slug: `help`, `about`, `contact`, `quality-promise`, `trust-data`, `press`, `pricing`, `blog` (every route this wave builds or
-- redirects) are reserved since 0204 (verified: each appears once in 0204 and once in apps/api/src/modules/tenancy/domain/signup.ts) —
-- `reserved_tenant_slugs` stays at 51.
--
-- REVERSAL (hand-run, never by the runner; remove the API route first — it names the keys):
--   DELETE FROM platform_setting_values  WHERE key         LIKE 'platform.legal.%' OR key LIKE 'platform.grievance.%' OR key LIKE 'platform.contact.%';
--   DELETE FROM platform_config_changes  WHERE setting_key LIKE 'platform.legal.%' OR setting_key LIKE 'platform.grievance.%' OR setting_key LIKE 'platform.contact.%';
--   DELETE FROM setting_definitions      WHERE key         LIKE 'platform.legal.%' OR key LIKE 'platform.grievance.%' OR key LIKE 'platform.contact.%';
--   -- (and seed core/0008's eleven rows)
-- ==================================================================================================================

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
