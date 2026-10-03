-- 0014 · lookup_values vocabulary for payout failure reasons (KV-BL-023, Sprint S3).
-- Added as its OWN file rather than appended to 0005_lookup_vocabularies.sql (same reasoning as
-- 0013: keep new pilot-blocking seed work isolated from files with other in-flight edits) — same
-- idempotent ON CONFLICT pattern as every other lookup_values insert (Law 10).
--
-- WHY lookup_values (not a code-only map, not TranslationService bundles):
--   `payments.failure_code` is a FREE VARCHAR the gateway hands back (RazorpayX `error.code`, sandbox
--   `account_invalid`, etc — confirmed by grep, no fixed vocabulary: see 03_API_CONTRACT_DELTA.md §payouts
--   and docs/design-data/SCREEN-DATA-CATALOG.md line ~9366). That is an UNBOUNDED, provider-owned string —
--   never safe to show a farmer directly, and never safe to translate 1:1 (a new provider error code must
--   never crash or silently show English). The fix is two layers:
--     1. `mapProviderFailureCode()` (payout-failure-reason.map.ts) — a pure, code-owned function that buckets
--        the unbounded provider string into a SMALL stable set of internal reason codes (below), falling back
--        to 'other' for anything unrecognized (never throws, never shows the raw code).
--     2. THIS controlled vocabulary — the bucket codes resolve to a human label exactly like every other
--        lookup_values type in this codebase (`payout_purpose`, `dispute_reason`, etc: PayoutRepository already
--        queries lookup_values directly for `payout_purpose`, same convention followed here for
--        `failureReasonLabels()`), locale-resolved via the SAME `translations` table LEFT JOIN pattern
--        `LookupsService.values()` uses (COALESCE(translations.text, default_name) — degrades to the English
--        default_name when no translations row exists yet, same as every other lookup_values type in this
--        repo today; no seed populates `translations` rows for ANY lookup type yet, so this is the established
--        floor, not a new gap).
--   TranslationService (core/i18n/translation.service.ts) was NOT used here: that mechanism is for STATIC,
--   code-authored copy (error messages, keyed `error.<code>`) baked into the deployed bundle — appropriate for
--   fixed system strings, wrong for a value an ops/support admin may want to retune per-tenant later without a
--   redeploy (lookup_values already supports a tenant override row shadowing the platform default — see
--   LookupsService.values()'s `tenant_id IS NULL OR tenant_id = $2` + "a tenant row shadows a platform row"
--   comment). notification_templates (the third mechanism in this codebase) was also not used: that renders a
--   whole multi-channel message body, overkill for one short response-field label.
--
-- 'other' (sort_order 99, lowest priority) is the fallback bucket for both a genuine bank-side rejection with
-- no more specific bucket AND a completely unrecognized/future provider code — mapProviderFailureCode() never
-- returns anything outside this set, so failureReasonLocalized always resolves to a real label.
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('payout_failure_reason', 'Payout failure reason', false)
ON CONFLICT (code) DO NOTHING;

-- [PC-56 TENANT-12 · F-16] NOT EXISTS + a target-less ON CONFLICT: `(type_code,tenant_id,code)` can never fire for a platform
-- row (NULLs are distinct), so every re-run used to DUPLICATE these values. Now a re-run inserts nothing.
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order)
SELECT v.type_code, v.tenant_id::uuid, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
  ('payout_failure_reason', NULL, 'insufficient_funds', 'Insufficient balance in the source account', '{}', 1),
  ('payout_failure_reason', NULL, 'invalid_account',    'Bank account details need to be corrected',    '{}', 2),
  ('payout_failure_reason', NULL, 'bank_declined',       'Your bank declined this transfer',             '{}', 3),
  ('payout_failure_reason', NULL, 'timeout',             'The transfer timed out — you can retry',       '{}', 4),
  ('payout_failure_reason', NULL, 'other',               'Payment could not be completed — contact support if this repeats', '{}', 99)
  ) AS v(type_code, tenant_id, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NOT DISTINCT FROM v.tenant_id::uuid AND x.code = v.code)
ON CONFLICT DO NOTHING;
