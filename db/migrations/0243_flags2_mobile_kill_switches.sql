-- ==================================================================================================================
-- MIGRATION 0243 — PC-56 FLAGS-2 · EVERY MOBILE FLAG CAN BE SWITCHED OFF WITHOUT AN APP RELEASE.
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (Nothing here edits an applied one: `feature_flags` gains 32 rows by
-- INSERT … ON CONFLICT (key) DO NOTHING, the 0221 precedent; seed core/0009 carries the same 32 rows.)
-- NOT MONEY. No table, policy or grant changes.
-- ==================================================================================================================
--
-- WHAT WAS WRONG (docs/production-backlog/LAUNCH-FLAGS.md, findings 1 and 2):
--   1. The app hydrates its flags from GET /v1/config/flags (FlagsService.allEnabled — every feature_flags row). Only 7 of its 39 keys
--      had a server row, so the other 32 — buyer_app, buyer_checkout, wallet, notifications, system_screens, release_gate, … — could only
--      be changed by shipping a new build: the "kill-switch" promised by flags.ts's header did not exist for them.
--   2. PC-50 set five Phase-2 operator apps ON in the build (mcc_operator, vet, store_owner, delivery_partner, equipment_owner) while their
--      server modules (dairy, livestock, equipment, logistics) are OFF — a user with one of those roles would open an app of refusals.
--
-- THE ROWS: each key the app knows and the server did not, at the build's own default — EXCEPT the five above, OFF. So the only change
-- a phone sees is finding 2's fix; every launch decision in LAUNCH-FLAGS.md is then one row's is_enabled. No server code reads these keys
-- (verified: no isEnabled/@FeatureFlag/assertEnabled names any of them in apps/api, apps/admin-api or the web apps).
--
-- REVERSAL (hand-run): DELETE FROM feature_flags WHERE description LIKE 'PC-56 FLAGS-2 %';   -- (and seed core/0009's 32 rows)
-- ==================================================================================================================

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('farmer_app', 'PC-56 FLAGS-2 (mobile-only key, Law 10): the farmer app (role vertical shipped Wave 0). Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', true, 100, '{}'),
  ('buyer_app', 'PC-56 FLAGS-2 (mobile-only key, Law 10): the buyer app tab group. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('buyer_checkout', 'PC-56 FLAGS-2 (mobile-only key, Law 10): buyer cart → checkout → place order (pays only when payments_addmoney is ON). Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('orders_fulfilment', 'PC-56 FLAGS-2 (mobile-only key, Law 10): order lifecycle actions, proof of delivery, track, review, report. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('payments_addmoney', 'PC-56 FLAGS-2 (mobile-only key, Law 10): wallet add-money / pay an order through Razorpay. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('wallet', 'PC-56 FLAGS-2 (mobile-only key, Law 10): wallet: transactions, withdraw, payout history. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('wallet_p2p', 'PC-56 FLAGS-2 (mobile-only key, Law 10): peer-to-peer wallet transfer (no backend endpoint yet). Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('offers_chat', 'PC-56 FLAGS-2 (mobile-only key, Law 10): offers negotiation + chat + masked call. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('notifications', 'PC-56 FLAGS-2 (mobile-only key, Law 10): push + in-app notification centre. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('farmer_profile', 'PC-56 FLAGS-2 (mobile-only key, Law 10): farmer profile, farm, bank, documents, help. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('system_screens', 'PC-56 FLAGS-2 (mobile-only key, Law 10): global search, settings, DPDP export/delete, change phone, feedback. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('release_gate', 'PC-56 FLAGS-2 (mobile-only key, Law 10): forced-update floor (block the app below the minimum supported version). Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('ota_updates', 'PC-56 FLAGS-2 (mobile-only key, Law 10): expo-updates over-the-air check/fetch/reload (expo-updates not installed yet). Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('voice_listing', 'PC-56 FLAGS-2 (mobile-only key, Law 10): mic → speech-to-text listing. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('voice_assistant', 'PC-56 FLAGS-2 (mobile-only key, Law 10): "Tap to speak" on the farm assistant. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('tips_assistant', 'PC-56 FLAGS-2 (mobile-only key, Law 10): tips library, crop hub, AI assistant, voice search. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('mandi_weather', 'PC-56 FLAGS-2 (mobile-only key, Law 10): mandi prices, price alerts, weather advisories. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('schemes_govt', 'PC-56 FLAGS-2 (mobile-only key, Law 10): government schemes browse/apply/status. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('worker_active_job', 'PC-56 FLAGS-2 (mobile-only key, Law 10): worker active job: attendance geofence, earnings, withdraw. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('labour_hire', 'PC-56 FLAGS-2 (mobile-only key, Law 10): farmer/employer hiring workers. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('worker_app', 'PC-56 FLAGS-2 (mobile-only key, Law 10): the worker app tab group. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('trader_app', 'PC-56 FLAGS-2 (mobile-only key, Law 10): the trader app tab group. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('ambassador_app', 'PC-56 FLAGS-2 (mobile-only key, Law 10): village ambassador home + referral onboarding + earnings. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('ambassador_training', 'PC-56 FLAGS-2 (mobile-only key, Law 10): ambassador commissions, withdraw, training. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('tenant_admin_lite', 'PC-56 FLAGS-2 (mobile-only key, Law 10): organisation admin lite console. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('vyapari', 'PC-56 FLAGS-2 (mobile-only key, Law 10): wholesale trader console. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('fpo_coordinator', 'PC-56 FLAGS-2 (mobile-only key, Law 10): FPO group-lot coordinator console. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('mcc_operator', 'PC-56 FLAGS-2 (mobile-only key, Law 10): MCC counter app — build default ON (PC-50) but the dairy module is OFF; OFF here so the app does not open onto refusals. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('vet', 'PC-56 FLAGS-2 (mobile-only key, Law 10): vet professional app — build default ON (PC-50) but the livestock module is OFF; OFF here. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('store_owner', 'PC-56 FLAGS-2 (mobile-only key, Law 10): agri-input store owner app — build default ON (PC-50); OFF here until its server surfaces are verified for launch. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('delivery_partner', 'PC-56 FLAGS-2 (mobile-only key, Law 10): rider app — build default ON (PC-50) but the logistics module is OFF; OFF here. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}'),
  ('equipment_owner', 'PC-56 FLAGS-2 (mobile-only key, Law 10): equipment owner app — build default ON (PC-50) but the equipment module is OFF; OFF here. Mirrors apps/mobile/src/core/flags/flags.ts so GET /v1/config/flags can switch it without an app release.', false, 100, '{}')
ON CONFLICT (key) DO NOTHING;
