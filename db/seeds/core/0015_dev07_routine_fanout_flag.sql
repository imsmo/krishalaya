-- 0015 · feature flag for the Q24/DELTA-059 routine notification fan-out policy (DEV-07, Development Program).
-- Added as its OWN file rather than appended to 0009_feature_flags.sql, following the exact precedent + reasoning
-- of 0013_selfserve_onboarding_flag.sql (keep new pilot-era seed work isolated from a file other in-flight edits
-- may touch) — same idempotent ON CONFLICT pattern as every other feature_flags insert (Law 10 / Golden Law 8).
--
-- Q24 ruling (Design_Program/12_G0-2_DECISION_REGISTER.md, decided at G0-4, 2026-07-22), verbatim:
--   "ROUTINE tier = ONE primary channel per farmer preference + auto-fallback to SMS on non-delivery.
--    Money/security tiers stay multi-channel as already designed (Critical/Important tiers unaffected)."
-- Implemented in apps/api/src/modules/communication/domain/channel-resolution.ts (applyRoutinePolicy) and wired
-- into services/notification.service.ts's fanout() behind THIS flag (ROUTINE_FANOUT_FLAG constant, same string).
--
-- Default OFF (Golden Law 8: nothing ships turned ON without an explicit founder flag flip). Flipping
-- is_enabled=false at any time is the kill-switch back to the pre-existing multi-channel-for-everything
-- behavior for informational/promotional events — zero code path change, zero redeploy.
--
-- [DEV-S1 2026-07-24] FLIPPED ON per founder sitting DEV-S1 2026-07-24 ("Founder, direct, 2026-07-24"):
-- is_enabled false -> true. Kill-switch unchanged — flip is_enabled back to false at any time to instantly
-- revert every tenant to the pre-existing multi-channel fan-out, zero code path change, zero redeploy.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('notification_routine_single_channel',
   'Q24/DELTA-059 (decided G0-4 2026-07-22): collapse informational/promotional (routine-tier) notification '
   'fan-out to ONE primary channel + auto SMS-fallback-on-non-delivery, instead of the pre-existing multi-channel '
   'fan-out. Critical/important tiers are unaffected (always multi-channel). OFF = old behavior (kill-switch).',
   true, 100, '{}')
ON CONFLICT (key) DO NOTHING;
