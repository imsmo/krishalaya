-- ============================================================================
-- MIGRATION 0106 — A REJECTION REASON A MACHINE CAN COUNT (PC-56 ADMIN-4b)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS: W078's MOST VALUABLE PANEL CANNOT BE BUILT FROM FREE TEXT.
-- ---------------------------------------------------------------------------
-- W078 (Scheme performance) shows "Rejection reasons (fixable)" — 42% Aadhaar–bank seeding mismatch, 28% land-record
-- name variance, 18% duplicate application, 12% window missed — each wired to a remedy (an ambassador task, a 7/12
-- correction camp per taluka, a dedupe check at draft, the W073 calendar nudges). It is the highest-leverage number
-- on the platform: it converts a refusal into a queue of fixable work.
--
-- `scheme_applications.rejection_reason` is `text`, and the reject DTO validates it as
-- `z.string().max(1000).optional()` — no enum, no required-ness, not even a minimum length. So the honest options were:
--
--   (a) KEYWORD-MATCH THE FREE TEXT. Rejected. A regex over officer prose would produce percentages that look
--       authoritative and are guesses — and this particular chart is one a founder allocates ambassador time against.
--       A chart that is 80% right about where to send people is worse than no chart, because nobody audits it.
--   (b) LEAVE IT AS A NAMED GAP FOREVER. Rejected too: the field is written on every rejection, so every day this is
--       deferred is another day of data that can never be counted. The cost of waiting compounds.
--   (c) ADD A CODED REASON ALONGSIDE THE PROSE, count only what is coded, and SAY what the denominator is.
--
-- (c) is what this migration does. The code is NULLABLE and the prose is untouched: an officer keeps writing what
-- happened in their own words, and adds a code. Nothing existing breaks, and nothing existing is retro-coded —
-- historical rows stay NULL and the console reports them as UNCODED rather than distributing them across the codes,
-- because an "Other 100%" slice that is really "we did not ask" is the same lie as a keyword match, just tidier.
--
-- THE CODE LIST IS THE CANON'S OWN LIST plus the ones a rejection actually needs. Every entry is a REMEDY, which is
-- the test for whether it belongs: a code nobody can act on is a code that only makes a pie chart rounder.
--   aadhaar_seeding_mismatch  → ambassador task + AePS assist flow      (W078's 42%)
--   land_record_name_variance → 7/12 correction camp list per taluka    (W078's 28%)
--   duplicate_application     → dedupe check at draft                   (W078's 18%)
--   window_missed             → the W073 D−14/D−7/D−2 calendar nudges   (W078's 12%)
--   documents_missing         → a document checklist the farmer can finish
--   ineligible_landholding / ineligible_category / ineligible_region → eligibility_rules were right and the farmer
--       does not qualify. NOT "fixable", and separated for exactly that reason: mixing a genuine ineligibility into a
--       fixable bucket would send an ambassador to a farm where there is nothing to fix.
--   portal_rejected           → the government portal refused it; our records were fine
--   withdrawn_by_applicant    → not a rejection by us at all, and counting it as one would defame our own approval rate
--   other                     → the escape hatch, and the console shows its share PROMINENTLY: a large 'other' is a
--                               signal the code list is wrong, and hiding that would let the list rot.
-- ============================================================================

ALTER TABLE scheme_applications
  ADD COLUMN rejection_reason_code varchar(32);

ALTER TABLE scheme_applications ADD CONSTRAINT ck_scheme_app_rejection_code CHECK (
  rejection_reason_code IS NULL OR rejection_reason_code IN (
    'aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed',
    'documents_missing', 'ineligible_landholding', 'ineligible_category', 'ineligible_region',
    'portal_rejected', 'withdrawn_by_applicant', 'other'
  )
);

-- A code without a rejection is a contradiction: it would count a live application in a rejection breakdown. The
-- reverse is deliberately ALLOWED — a rejected row with no code is the historical state, and it is exactly what the
-- console reports as uncoded.
ALTER TABLE scheme_applications ADD CONSTRAINT ck_scheme_app_code_needs_rejection CHECK (
  rejection_reason_code IS NULL OR status IN ('rejected', 'appealed')
);

COMMENT ON COLUMN scheme_applications.rejection_reason_code IS
  'Machine-countable rejection reason (0106). NULL means UNCODED, never "other": uncoded rows are reported as uncoded so the denominator of any rejection breakdown is visible. The free-text rejection_reason is unchanged and is still where the officer says what actually happened.';

-- The breakdown query: rejected rows, by code, within a bounded window. Partial so it stays small — the vast majority
-- of applications are never rejected.
CREATE INDEX idx_scheme_apps_rejection_code ON scheme_applications (rejection_reason_code, decided_at DESC)
  WHERE status = 'rejected' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE CROSS-TENANT OVERSIGHT READ PATH (W074)
-- ---------------------------------------------------------------------------
-- Every existing index on this table is tenant-scoped (`idx_schemeapps_user` on applicant, `idx_schemeapps_open` on
-- (tenant_id, status)) because every existing reader is a tenant. The platform oversight list is the first reader
-- that deliberately spans tenants (Law 11, kv_admin bypasses RLS), and it pages by keyset on (created_at, id) — with
-- no index in that order it would sort the whole table on every page.
CREATE INDEX idx_scheme_apps_oversight ON scheme_applications (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- The status tab-counts on W074 are a cross-tenant GROUP BY status. Partial on the live states because the counts
-- that matter are the ones somebody can act on; closed/rejected history is counted from the same index without it
-- having to carry every row ever filed.
CREATE INDEX idx_scheme_apps_status_counts ON scheme_applications (status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- W078's MEDIAN TIME TO DISBURSAL reads `scheme_application_events`, which is PARTITIONED BY created_at and indexed
-- only on (application_id, created_at) — an index built for "show me this application's history", not for "find every
-- disbursal in the last quarter". Without this, the median scans every partition in range.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_schemeapp_events_to_status ON scheme_application_events (to_status, created_at DESC);

-- ---------------------------------------------------------------------------
-- NO NEW TABLE, AND TWO THINGS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO notification-tracking column or table for W076's "Celebration SMS sent 14,020" tile. `dbt_transfers` is
--     append-only and partitioned (kv_app holds INSERT only, per 0078), so a per-transfer notified flag would have to
--     be a side table on the `dbt_bounces` pattern. It is not created here because NOTHING WOULD WRITE TO IT: no code
--     path notifies a farmer on credit observation, and SMS cannot be delivered at all without DLT ids the platform
--     does not have. An empty table would turn an honest "not built" into a permanent, credible-looking zero.
--   • NO materialised rollup for W078. The KPIs are computed on read against bounded windows. A nightly rollup is the
--     right answer at 75M households and the wrong answer today, because a stale rollup is indistinguishable from a
--     live one on screen and there is no volume yet to justify the ambiguity.
