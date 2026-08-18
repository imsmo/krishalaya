-- =============================================================================================
-- 0147_tax_identity_formats.sql · PC-56 TENANT-4d-3 — A TAX IDENTITY IS NOT AN INDIAN REGEX
-- =============================================================================================
-- W2424-W2427 are the shared B2 form chain for W120's "Update GST details": an error state that lists
-- EVERY invalid field with its reason and preserves what you typed, a review step showing the diff
-- against current values, a success state whose promise is "the audit trail has the entry (actor · time ·
-- reason · before/after)", and a failure state that is all-or-nothing with a retry path.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): ONE REGEX BLOCKS EVERY COUNTRY BUT INDIA — RULE ZERO, IN ONE LINE
-- ---------------------------------------------------------------------------------------------
-- `domain/tenant.entity.ts` reads, unconditionally, for every tenant on the platform:
--
--     const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;   // 15-char GSTIN
--     const PAN_RE   = /^[A-Z]{5}[0-9]{4}[A-Z]$/;                      // 10-char PAN
--     ...
--     if (patch.gstin !== undefined) set('gstin', optUpper(patch.gstin, GSTIN_RE, 'gstin'));
--
-- GSTIN and PAN are Indian identifiers. `tenants.country_code` exists, is NOT NULL, and is never
-- consulted. So a Bangladeshi co-operative — the Y6-7 market the founder's own rule zero names — cannot
-- record its BIN: the platform rejects it as "gstin is malformed". A Kenyan tenant cannot record a KRA
-- PIN. The field is not merely mislabelled for them; the write is REFUSED. That is precisely "a shortcut
-- that blocks a country", sitting in one line, and it is the kind of thing that is invisible until the
-- first non-Indian tenant tries to onboard and cannot.
--
-- The formats move OUT of TypeScript and INTO this table, keyed by country (Law 6: "if you are writing a
-- string a tenant admin should control — stop, it belongs in a table"; here it is a string a COUNTRY
-- controls). Adding Bangladesh is then a seed row, not a code change and not a release.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: "EVERY INVALID FIELD IS LISTED WITH ITS REASON" — AND ONLY THE FIRST ONE IS
-- ---------------------------------------------------------------------------------------------
-- W2424's own words. `Tenant.updateProfile` validates field by field and each helper THROWS on the spot
-- (`optUpper` → `throw new InvalidTenantProfileError('gstin is malformed')`). A form submitted with a bad
-- GSTIN, a bad PAN and a bad owner email reports ONE error; the tenant fixes it, resubmits, and is told
-- about the next one. Three round trips to learn three facts the server knew on the first. The validator
-- becomes a pure function that COLLECTS every error and returns them together (no schema change — recorded
-- here because it is the same defect as the one above, seen from the screen's side).
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: THE CHECK DIGIT NOBODY CHECKED, ON A FIELD THAT IS NOW FROZEN ONTO INVOICES
-- ---------------------------------------------------------------------------------------------
-- A GSTIN's 15th character is a computed check digit (mod-36 weighted). The regex above accepts
-- `[0-9A-Z]` there, so `24AABCU9603R1Z4` — one digit off, a plausible typo — passes validation today.
-- That mattered less when the GSTIN only sat on a profile row. TENANT-4d-2 (§146.3) now SNAPSHOTS it onto
-- every invoice at issue, precisely so a document cannot be re-addressed later. A typo therefore becomes
-- permanent, per-document, statutory error — on exactly the field a finance team files with.
-- `checksum_algo` names the algorithm per format; the code implements the named algorithms and, where a
-- country's format has NO algorithm we implement, the console says the check digit was NOT VERIFIED
-- rather than showing a tick it has not earned.
--
-- **AND IT ADVISES RATHER THAN REFUSES — A STATED LIMIT, NOT AN OVERSIGHT.** The implementation (Luhn mod
-- 36, right to left, factor starting at 2) agrees with the published specimen `27AAPFU0939F1ZV`, and it
-- could NOT be checked against an authoritative GSTN source from the environment this wave was built in
-- (no external network). A checksum subtly wrong in a way one specimen cannot reveal would REFUSE numbers
-- that are genuinely a tenant's own — blocking a correct registration, which is a trust cost rule zero
-- forbids. So a mismatch is surfaced at the REVIEW step (W2425), in front of a human already reading the
-- diff, and the tenant may proceed deliberately. FOUNDER DECISION to promote it to a hard refusal once
-- verified against the GSTN specification: one line in `validateAll`.
-- Most illustrative GSTINs in circulation are NOT checksum-valid (they are built on the canonical dummy
-- PAN `AABCU9603R`), which is itself why a mismatch cannot mean "reject". The seeded example above IS
-- checksum-valid, deliberately — a form must not show a specimen that fails its own validation.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: THE `reason` COLUMN THE SUCCESS SCREEN PROMISES IS NEVER WRITTEN
-- ---------------------------------------------------------------------------------------------
-- W2426: "the audit trail has the entry (actor · time · REASON · before/after)". `AuditWriter.AuditEntry`
-- has a `reason` field and `audit_log` has the column; `TenantService.updateProfile` passes oldValue and
-- newValue and never a reason. So three of the four promised facts are recorded and the fourth is a dead
-- column for this action. The review step (W2425) is where a human is already looking at the diff, which
-- is the only honest place to ask for it. No schema change — the column exists.
--
-- ---------------------------------------------------------------------------------------------
-- NAMED, NOT FIXED HERE
-- ---------------------------------------------------------------------------------------------
--   • THE TENANT PROFILE PLANE HAS NO SDK SURFACE AT ALL. `GET /v1/tenants/me` and
--     `PATCH /v1/tenants/me` have existed since TENANT-1; `packages/sdk-js` has no method for either, so
--     no console screen could reach them even if one existed. Added in this wave (that is the GAP-UI),
--     recorded here because it is why W2424-W2427 had nothing behind them.
--   • THE GSTIN'S STATE CODE IS NOT CROSS-CHECKED AGAINST THE TENANT'S REGION. 0140 established that an
--     invoice may read "the state from a party's GSTIN prefix"; a tenant whose GSTIN says 27
--     (Maharashtra) while its `region_id` sits in Gujarat is one of those two facts being wrong, and the
--     platform cannot tell which. Cross-checking needs `admin_regions.gst_state_code` populated beyond
--     0140's two seeded states — a data task, not a code one. Named.
--   • FSSAI AND CIN GET FORMATS HERE BUT NO CHECK DIGIT. FSSAI is 14 digits with no public checksum;
--     CIN's last 6 are a sequence. Both validate on shape and length only, and say so.
--   • THE GRACE PERIOD IS STILL A SENTENCE, NOT A STATE — with the SaaS billing cadence and dunning, it
--     is TENANT-4d-4. W120 states that gap honestly today (0146 §146.6 and its console block); nothing
--     ships claiming otherwise. This wave closes the last four canon SCREENS of TENANT-4; 4d-4 closes
--     the promise behind W120's footnote.
--
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 147.1  THE FORMATS, AS DATA, PER COUNTRY
-- ---------------------------------------------------------------------------------------------
-- PLATFORM REFERENCE DATA: no `tenant_id`, therefore no RLS and no place in the tenant-RLS sweeps — the
-- same shape as `countries` and `currencies`. It is OPERATOR-AUTHORED, which is also the answer to the
-- obvious objection about storing a regex: the pattern is never user input, `kv_app` gets SELECT only
-- (§147.4), and the validator caps the candidate's LENGTH before it ever runs the pattern, so a
-- pathological expression cannot be fed a long string to backtrack over.
CREATE TABLE tax_identity_formats (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  country_code   char(2) NOT NULL REFERENCES countries(code),
  -- The field this format governs. CHECKed against the columns that actually exist on `tenants`, because a
  -- format row for a field nothing reads is a row that looks like configuration and governs nothing.
  field_code     varchar(30) NOT NULL
                   CHECK (field_code IN ('gstin', 'pan', 'cin_or_reg_no', 'fssai_license')),
  -- An i18n KEY, never a literal (Law 7). "GSTIN" is the Indian label for this field; the Bangladeshi row
  -- will say BIN, and the screen must render whichever the tenant's country supplies.
  label_key      varchar(80) NOT NULL,
  -- Anchored by CHECK: an unanchored pattern would match a substring, which for an identifier is the
  -- difference between validating it and finding it somewhere inside a paragraph.
  pattern        text NOT NULL CHECK (pattern LIKE '^%' AND pattern LIKE '%$' AND length(pattern) <= 400),
  -- Enforced BEFORE the pattern runs. Also what the input field's maxlength renders from.
  max_length     smallint NOT NULL CHECK (max_length BETWEEN 1 AND 64),
  -- Shown to the tenant as "for example …". A real, well-known specimen — never a live tenant's number.
  example        varchar(64),
  -- The check-digit algorithm, BY NAME. NULL means "this format has no check digit we can verify", which
  -- the console states as NOT VERIFIED rather than as a pass. The code implements named algorithms; a
  -- name it does not implement is treated exactly like NULL and logged, never silently as a pass.
  checksum_algo  varchar(30) CHECK (checksum_algo IS NULL OR checksum_algo IN ('gstin_mod36')),
  is_required    boolean NOT NULL DEFAULT false,
  sort_order     smallint NOT NULL DEFAULT 100
);
CALL add_std_columns('tax_identity_formats');

CREATE UNIQUE INDEX uq_tax_identity_format_country_field
  ON tax_identity_formats (country_code, field_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_tax_identity_format_country ON tax_identity_formats (country_code, sort_order);

COMMENT ON TABLE tax_identity_formats IS
  'PC-56 TENANT-4d-3: the tax/registration identifier formats a tenant may record, PER COUNTRY. Before this table `domain/tenant.entity.ts` applied a hardcoded Indian GSTIN and PAN regex to every tenant on the platform, so a tenant outside India could not record its own tax identity at all — the write was refused as "malformed". Adding a country is now a seed row. A country with NO rows is not blocked: its identifiers are accepted as length-capped plain text and the console says the format is not recorded for that country, which is the honest state rather than a fabricated pattern.';
COMMENT ON COLUMN tax_identity_formats.checksum_algo IS
  'PC-56 TENANT-4d-3: the check-digit algorithm by NAME, or NULL where the format has none we can verify. A GSTIN''s 15th character is a real mod-36 check digit and the old regex accepted any alphanumeric there, so a one-character typo passed — and since 0146 snapshots the GSTIN onto every invoice at issue, that typo would become a permanent statutory error on documents. NULL (or an unimplemented name) renders as "check digit not verified", never as a tick.';

-- ---------------------------------------------------------------------------------------------
-- 147.2  INDIA'S FOUR, SEEDED — the formats that were in TypeScript, now rows
-- ---------------------------------------------------------------------------------------------
-- Only India is seeded, deliberately. Inventing a pattern for a country whose identifier rules nobody on
-- this programme has verified would be worse than having no row: a wrong pattern REFUSES a correct
-- number, which is the very defect this migration exists to fix.
INSERT INTO tax_identity_formats (country_code, field_code, label_key, pattern, max_length, example, checksum_algo, is_required, sort_order)
SELECT * FROM (VALUES
  ('IN', 'gstin',         'tax.field.gstin', '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$', 15::smallint, '27AAPFU0939F1ZV', 'gstin_mod36', false, 10::smallint),
  ('IN', 'pan',           'tax.field.pan',   '^[A-Z]{5}[0-9]{4}[A-Z]$',                    10::smallint, 'AABCU9603R',      NULL,          false, 20::smallint),
  -- 21 chars: 1 listing letter + 5 industry digits + 2 state letters + 4 year digits + 3 ownership letters
  -- + 6 registration digits (e.g. U74999MH2015PTC123456). Shape only — the tail is a sequence, not a digest.
  ('IN', 'cin_or_reg_no', 'tax.field.cin',   '^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$', 21::smallint, 'U74999MH2015PTC123456', NULL, false, 30::smallint),
  -- 14 digits. No public check digit, so shape and length only — stated, not implied.
  ('IN', 'fssai_license', 'tax.field.fssai', '^[0-9]{14}$',                                14::smallint, '10012011000123',  NULL,          false, 40::smallint)
) AS v(country_code, field_code, label_key, pattern, max_length, example, checksum_algo, is_required, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM tax_identity_formats f WHERE f.country_code = v.country_code AND f.field_code = v.field_code);

-- ---------------------------------------------------------------------------------------------
-- 147.3  THE FLAG (Law 10) — default OFF
-- ---------------------------------------------------------------------------------------------
-- With this ON, a tenant_admin can edit its own tax identity from the console (W2424-W2427). OFF is the
-- behaviour before this wave: the API route existed, the SDK had no method for it, and no screen reached
-- it — so a tenant could not change a GSTIN that now prints on its invoices without asking an operator.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'tenant_tax_identity_form',
       'PC-56 TENANT-4d-3: the tenant-facing "Update GST details" chain (W2424-W2427) — validate-all-fields preview, review diff with a reason, audited write. OFF keeps the profile plane operator-only, which is the behaviour before this wave.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'tenant_tax_identity_form');

-- ---------------------------------------------------------------------------------------------
-- 147.4  GRANTS — reference data is READ-ONLY to the application
-- ---------------------------------------------------------------------------------------------
-- The api reads formats to validate with; it never writes them. Authoring belongs to the platform
-- (admin-api / migrations), which is also what makes the stored patterns trusted input rather than
-- user input.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 5, FOUND BY PROBING THIS FILE'S OWN GRANTS ON A REAL POSTGRES:
--            A NEW TABLE IS BORN FULLY WRITABLE BY THE RELAY, AND NO MIGRATION SAYS SO
-- ---------------------------------------------------------------------------------------------
-- 0018 §"outbox relay role" set:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kv_relay;
--
-- so EVERY table created in `public` since 0018 grants kv_relay SELECT+INSERT+UPDATE+DELETE the moment it
-- exists, with no GRANT statement anywhere naming it. The first draft of this section said "kv_relay has no
-- business here at all" and was simply false: a probe as that role read the table, and the privilege list
-- showed `arwd` — the outbox relay could DELETE the platform's tax-format reference rows, which would silently
-- turn every tenant's identifier validation into "no format recorded for your country".
--
-- This is the same shape as 0146 §146.6 seen from the other side. There, 0079 REVOKED a privilege the relay
-- genuinely needed on `saas_invoices`, on a wrong grep. Here, the default GRANTS one it does not need at all.
-- Both are invisible in TypeScript and invisible in review; only asking the database as the role reveals them.
--
-- Fixed for this table, explicitly and last (a REVOKE must follow the CREATE, since the default privilege is
-- applied at creation time):
REVOKE ALL ON tax_identity_formats FROM kv_relay;
GRANT SELECT ON tax_identity_formats TO kv_app;
GRANT SELECT, INSERT, UPDATE ON tax_identity_formats TO kv_admin;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tax_identity_formats FROM kv_app;
-- NAMED, NOT SWEPT: how many of the ~130 tables created since 0018 are unintentionally relay-writable is an
-- audit of its own — `SELECT` against `information_schema.role_table_grants` per table, cross-referenced with
-- which ones any kv_relay code path actually touches. A blanket revoke would break the relay (it legitimately
-- writes outbox_events, and the jobs write across tenants); a blanket keep is what we have now. That audit is
-- a wave, not a footnote, and guessing either way here would be worse than naming it.
