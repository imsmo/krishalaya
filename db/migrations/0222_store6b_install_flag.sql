-- ==================================================================================================================
-- MIGRATION 0222 — PC-56 STORE-6b · YOUR UNSENT WORDS STAY ON YOUR PHONE AND LEAVE ONLY WHEN YOU SAY — one flag row
-- (survey_store6.md §3 B5 / §6 Q8; founder decision D3 (Q8), 2026-10-17.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0221 are applied; nothing here edits them: `feature_flags` gains ONE row by
-- INSERT … ON CONFLICT DO NOTHING, the 0207 / 0208 / 0215 / 0219 / 0221 precedent; seed core/0009 carries the same row.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written.
-- ==================================================================================================================
--
-- THE SWITCH (answered by the storefront's allow-listed `GET /v1/storefront/flags` — apps/api/src/core/tenancy-context/
-- storefront-public.controller.ts — which grows from 15 to 16 keys):
--
--   storefront_install_prompt  OFF · TENANT-scoped (the store's organisation) · FAIL-CLOSED. Founder D3 (Q8): when ON for an organisation, its
--                              store shows the install invitation — a bottom sheet on the SECOND visit of a device ("Add <organisation> to
--                              your home screen?" → the browser's own install prompt), "Not now" honoured 30 days per device. A device act:
--                              no API call, no audit row, nothing stored on the server. OFF (or unreadable) = no sheet; the browser's own
--                              install and the `/app` page stay. Law 10: OFF until an organisation is switched on. The platform host has no
--                              organisation in context, so the tenant-scoped key is absent there and reads OFF (the 6a Q1 limit, named).
--
-- The drafts on the phone (D1/D2/D4) and the `/sync` page need NO switch and NO row: nothing is sent or stored on the server; drafts live in
-- the browser's IndexedDB under the HOTFIX-8 owner marker and are wiped by its Clear-Site-Data.
--
-- No reserved slug: `sync` (the new storefront route `/sync`, "On this phone") is reserved since 0204 (verified: 0204:150) and listed in
-- apps/api/src/modules/tenancy/domain/signup.ts:105 — `reserved_tenant_slugs` stays at 51.
--
-- REVERSAL (hand-run, never by the runner; revert the API allow-list first — it names the key):
--   DELETE FROM feature_flags WHERE key = 'storefront_install_prompt';   -- (and seed core/0009's row)
-- ==================================================================================================================

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('storefront_install_prompt',
   'PC-56 STORE-6b (founder Q8): the install invitation — a bottom sheet on the second visit of a device naming the organisation, "Not now" honoured 30 days per device; a device act, no API call, no audit row. Per organisation, fail-closed',
   false, 100, '{}')
ON CONFLICT (key) DO NOTHING;
