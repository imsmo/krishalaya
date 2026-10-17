-- ==================================================================================================================
-- MIGRATION 0221 — PC-56 STORE-6a · OFFLINE IS A KIND PAGE, MONEY WAITS FOR SIGNAL, THE APP IS THE ORGANISATION'S — two flag rows
-- (survey_store6.md §5 item 2 / §3 B3 + B10 + B14; founder decisions D2 (Q9) and D4 (B3, Law 10), 2026-10-17.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0220 are applied; nothing here edits them: `feature_flags` gains TWO rows
-- by INSERT … ON CONFLICT DO NOTHING, the 0207 / 0208 / 0215 / 0219 precedent; seed core/0009 carries the same two rows.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written.
-- ==================================================================================================================
--
-- THE TWO SWITCHES (both answered by the storefront's allow-listed `GET /v1/storefront/flags` — apps/api/src/core/tenancy-context/
-- storefront-public.controller.ts — which grows from 13 to 15 keys):
--
--   storefront_pwa            ON  · PLATFORM-scoped (evaluated with no tenant — one worker per ORIGIN serves every path store) · FAIL-OPEN.
--                             The storefront's service worker (`/sw.js`, the route app/sw.js/route.ts). OFF = the route serves a
--                             SELF-UNREGISTERING worker (unregister + delete every `kv-*` cache) — a bad worker is undone by a flag flip,
--                             not a deploy. A flag-store outage reads ON (like `storefront_browse`): an outage must never unregister every
--                             phone's worker.
--                             **LAW 10 EXCEPTION, NAMED:** seeded ON, not OFF — the worker has been live on every storefront since PC-24c
--                             (and versioned by the build since HOTFIX-8); seeding it OFF would switch a live feature off on deploy. The
--                             `org_self_signup` precedent (0205, STORE-1c): a switch over something already shipped is seeded in the state
--                             production is in.
--   storefront_offline_reads  OFF · TENANT-scoped (the HOST's organisation) · FAIL-CLOSED. Founder D2 (Q9): when ON, the public pages a person
--                             opened (listing, organisation, trace, verify, certificate, browse) may be kept on their phone — capped at 20
--                             pages / 7 days, never with a session cookie, never prefetched, photos never — and are shown offline with an
--                             "as of" band. OFF (or unreadable) = no page is marked cacheable and nothing is kept. Law 10: OFF until an
--                             organisation is switched on.
--
-- No reserved slug: `offline`, `app` and `queued` (the three new storefront routes) are reserved since 0204 (verified: 0204:143,150,153) and
-- listed in apps/api/src/modules/tenancy/domain/signup.ts — `reserved_tenant_slugs` stays at 51.
--
-- REVERSAL (hand-run, never by the runner; revert the API allow-list first — it names both keys):
--   DELETE FROM feature_flags WHERE key IN ('storefront_pwa', 'storefront_offline_reads');   -- (and seed core/0009's two rows)
-- ==================================================================================================================

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('storefront_pwa',
   'PC-56 STORE-6a (founder D4, Law 10 exception — ON since PC-24c): the storefront service worker (/sw.js). Platform-scoped, fail-open. OFF = /sw.js serves a self-unregistering worker that deletes every kv-* cache',
   true, 100, '{}'),
  ('storefront_offline_reads',
   'PC-56 STORE-6a (founder D2): the public pages a person opened (listing, organisation, trace, verify, certificate, browse) may be kept on their phone — 20 pages / 7 days, never signed in, never prefetched, no photos — and shown offline with an as-of band. Per organisation, fail-closed',
   false, 100, '{}')
ON CONFLICT (key) DO NOTHING;
