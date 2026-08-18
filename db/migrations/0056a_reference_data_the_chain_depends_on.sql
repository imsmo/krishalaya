-- =============================================================================================
-- 0056a_reference_data_the_chain_depends_on.sql
-- PC-56 TENANT-4d-5 CHAIN REPAIR — THE MIGRATION CHAIN COULD NOT BE APPLIED TO A FRESH DATABASE
-- =============================================================================================
-- **THIS FILE EXISTS BECAUSE MIGRATIONS RUN BEFORE SEEDS, AND FIFTEEN LATER MIGRATIONS DEPEND ON
-- SEEDED REFERENCE DATA.** It was found by running the real runner against an empty PostgreSQL 16
-- database, which is something no wave of this programme had done: every live-apply probe so far was
-- built from a base template, and the base template hid this completely.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT WAS ACTUALLY WRONG
-- ---------------------------------------------------------------------------------------------
-- `db/prod/apply.sh` and `db/prod/DB-BOOTSTRAP-RUNBOOK.md` both bring a database up in this order:
--
--     [1/6] migrate  →  node db/scripts/migrate.js        (all migrations, as the owner role)
--     [4/6] seed     →  node db/scripts/seed.js           (core/rules/catalogue REFERENCE data)
--
-- That is the right order for the tables — seeds insert into tables migrations create. It is the
-- WRONG order for the dependencies, because migration 0057 onwards insert rows whose parents live in
-- `db/seeds/core/`: `lookup_types` (0005), `languages` (0001), `roles` and `permissions` (0004),
-- `integration_providers` (0010). Every one of those inserts either FAILED a foreign key or, worse,
-- silently matched zero rows.
--
-- **AND `db/scripts/migrate.js` WRAPS EACH FILE IN ONE TRANSACTION AND `return`s ON FAILURE.** So the
-- first failure did not skip a file — it stopped the chain. Applied to an empty database the run
-- halted at **0057_upi_mandate_executions** with
--     ERROR: insert or update on table "lookup_values" violates foreign key constraint
--            "lookup_values_type_code_fkey"
-- which means **migrations 0057 through 0149 had never been applied to any database, anywhere.**
--
-- `.github/workflows/db-migrate.yml` exists for exactly this and describes itself as "continuous proof
-- that the schema BUILDS … the gate that catches a broken migration before it ever reaches
-- staging/production". It runs `node db/scripts/migrate.js` against a throwaway Postgres on every PR
-- touching `db/**`. Every wave of this programme has touched `db/**`. **That gate has therefore been
-- RED since 0057 landed, and each wave verified itself against a base template instead of reading it.**
--
-- ---------------------------------------------------------------------------------------------
-- THE FAILURE THAT WAS WORSE THAN A FAILURE
-- ---------------------------------------------------------------------------------------------
-- A foreign key violation is loud. This is not:
--
--     INSERT INTO role_permissions (role_id, permission_code)
--     SELECT r.id, 'wallet.org_view' FROM roles r WHERE r.code = 'tenant_admin'
--     ON CONFLICT DO NOTHING;
--
-- With `roles` empty, that statement inserts ZERO ROWS AND SUCCEEDS. Migrations 0128, 0139, 0142,
-- 0143 and 0144 all grant permissions in exactly this shape — several of them written specifically to
-- fix a "permission named on a screen that was granted to nobody" defect. On a fresh deployment they
-- would have granted nothing, and the defect they were written to close would have been reintroduced
-- by the deployment itself, silently, with a green migration log. Per-file "ensure my own parent row"
-- patches cannot fix that: the rows have to exist BEFORE those files run, which is what this one does.
--
-- ---------------------------------------------------------------------------------------------
-- WHY THIS FILE IS NUMBERED 0056a, AND WHY THAT IS NOT A LAW 9 VIOLATION
-- ---------------------------------------------------------------------------------------------
-- The fix has to run before 0057. A new migration numbered 0150 is unreachable — the chain halts long
-- before it — and repairing fifteen files in place would duplicate the reference catalogues across the
-- tree and still leave the silent-zero-rows grants broken. `db/scripts/migrate.js` sorts by FILENAME
-- and parses no numbers, and '0056_' < '0056a' < '0057_' bytewise, so this file slots in exactly where
-- it is needed.
--
-- Law 9 says never edit an APPLIED migration. Nothing here edits anything: 0001–0056 are untouched,
-- and this is a new file. A database already at 0056 applies it and continues; `schema_migrations` has
-- never held a row for 0057 or later, in any environment, by construction.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS FILE IS NOT
-- ---------------------------------------------------------------------------------------------
-- **IT IS NOT A SECOND COPY OF THE REFERENCE CATALOGUES, AND IT MUST NEVER BECOME ONE.** The seeds
-- remain the owners: `db/seeds/core/0004_roles_permissions.sql` holds 27 roles and ~100 permissions,
-- and Law 6 is explicit that this data lives in seed files. What is duplicated here is the MINIMAL SET
-- that migrations 0057–0149 actually reference — 7 role codes, 2 lookup types, 3 languages, 2 provider
-- codes — measured from the files rather than guessed, and every value is byte-identical to the seed's
-- own row so the seed's later `ON CONFLICT DO NOTHING` is a genuine no-op rather than a divergent
-- duplicate. `tenant4d5-chain-repair.spec.ts` asserts that equality in both directions, so a future
-- edit to either copy fails a test instead of drifting.
--
-- Every statement is guarded by `WHERE NOT EXISTS`, so this file is idempotent and is a no-op on any
-- database that has already been seeded.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 0056a.1  THE THREE LAUNCH LANGUAGES
-- ---------------------------------------------------------------------------------------------
-- `notification_templates.language_code` REFERENCES `languages(code)`. Seven migrations seed platform
-- notification copy (0086, 0101, 0112, 0114, 0119, 0123, 0129 — and 0149), because the wording belongs
-- with the feature that sends it. 0048's header records solving this the other way for ONE file, by
-- moving its templates out to the seed; that does not scale to eight, and it separates copy from the
-- migration that explains why the copy says what it says.
--
-- ONLY the three languages the platform actually ships copy in. The other fifteen locales stay
-- seed-only on purpose: this file guarantees what the chain needs and does not become a competing copy
-- of the locale catalogue.
INSERT INTO languages (code, name_native, name_english, script, direction, font_stack, number_format, is_active, voice_stt_ready, sort_order)
SELECT v.code, v.name_native, v.name_english, v.script, v.direction, v.font_stack, v.number_format, v.is_active, v.voice_stt_ready, v.sort_order
  FROM (VALUES
  ('hi', 'हिन्दी',  'Hindi',    'Devanagari', 'ltr', 'Noto Sans Devanagari', 'indian', true, true, 1::smallint),
  ('en', 'English', 'English',  'Latin',      'ltr', 'Inter',                'indian', true, true, 2::smallint),
  ('gu', 'ગુજરાતી', 'Gujarati', 'Gujarati',   'ltr', 'Noto Sans Gujarati',   'indian', true, true, 3::smallint)
) AS v(code, name_native, name_english, script, direction, font_stack, number_format, is_active, voice_stt_ready, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM languages l WHERE l.code = v.code);

-- ---------------------------------------------------------------------------------------------
-- 0056a.2  THE TWO LOOKUP VOCABULARIES LATER MIGRATIONS EXTEND
-- ---------------------------------------------------------------------------------------------
-- `lookup_values.type_code` REFERENCES `lookup_types(code)`. 0057 and 0111 add `ledger_txn_type`
-- values; 0088 and 0089 add `payout_purpose` values. Both parent types are seeded in
-- `db/seeds/core/0005_lookup_vocabularies.sql`, i.e. after every one of them.
--
-- Note the precedent this follows rather than invents: 0134 and 0138 already create their OWN lookup
-- types inside the migration that needs them. These two are simply older and were assumed.
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
SELECT v.code, v.default_name, false
  FROM (VALUES
  ('ledger_txn_type', 'Ledger txn type'),
  ('payout_purpose',  'Payout purpose')
) AS v(code, default_name)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_types t WHERE t.code = v.code);

-- ---------------------------------------------------------------------------------------------
-- 0056a.3  THE SEVEN ROLE CODES LATER MIGRATIONS BIND PERMISSIONS AND PAYOUT RULES TO
-- ---------------------------------------------------------------------------------------------
-- Measured, not guessed — these are every role code referenced by a migration at or after 0057:
--   0125 `payout_purpose_roles`  → farmer, dairy_farmer, pashupalak, vyapari, organic_store, worker, sardar
--   0128 `role_permissions`      → tenant_admin, farmer, vyapari, pharma_store, organic_store,
--                                  pashupalak, dairy_farmer
--   0139 / 0142 / 0143 / 0144    → tenant_admin
--   0128 `role_permissions`      → ambassador (group_lot.coordinate), support_agent
--
-- 0125 FAILS LOUDLY without them (`payout_purpose_roles.role_code` has a foreign key). 0128, 0139,
-- 0142, 0143 and 0144 do NOT — they are `SELECT r.id FROM roles r WHERE r.code = …`, which quietly
-- grants nothing. That asymmetry is the whole argument for fixing this once, here, rather than
-- per-file: a loud failure gets fixed, and a silent one ships.
--
-- Columns and values are copied verbatim from `db/seeds/core/0004_roles_permissions.sql`.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT v.code, v.default_name, v.scope, v.requires_kyc, v.requires_approval, v.module_code
  FROM (VALUES
  ('tenant_admin',  'Tenant Admin',                   'tenant', true, true, 'M01'),
  ('farmer',        'Farmer / Vendor',                'tenant', true, true, 'M03'),
  ('vyapari',       'Vyapari / Trader',               'tenant', true, true, 'M04'),
  ('pharma_store',  'Pharma / Agri-Input Store',      'tenant', true, true, 'M10'),
  ('organic_store', 'Organic Store / Producer',       'tenant', true, true, 'M11'),
  ('pashupalak',    'Pashupalak / Livestock Farmer',  'tenant', true, true, 'M15'),
  ('dairy_farmer',  'Dairy Farmer / MCC Operator',    'tenant', true, true, 'M16'),
  ('worker',        'Agricultural Worker',            'tenant', true, true, 'M28'),
  ('sardar',        'Sardar / Mukadam',               'tenant', true, true, 'M28'),
  -- 0128 grants `group_lot.coordinate` to `ambassador`. Found by the guard rather than by reading: that
  -- statement is `SELECT r.id FROM roles r WHERE r.code = 'ambassador'`, so without this row it inserts
  -- zero rows and succeeds, and the village ambassador silently cannot coordinate a group lot.
  ('ambassador',    'Village Ambassador',             'tenant', true, true, NULL),
  -- 0128 also grants to `support_agent`. Both this row and `ambassador` were missed by the first reading of
  -- 0128 and caught by `tenant4d5-chain-repair.spec.ts`'s static guard, which is the argument for having the
  -- guard: the failure mode is a grant that inserts nothing and reports success, so an eye is not enough.
  ('support_agent', 'Support Agent',                  'tenant', false, true, NULL)
) AS v(code, default_name, scope, requires_kyc, requires_approval, module_code)
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = v.code);

-- ---------------------------------------------------------------------------------------------
-- 0056a.4  THE TWO INTEGRATION PROVIDERS LATER MIGRATIONS NAME
-- ---------------------------------------------------------------------------------------------
-- `provider_dependencies.provider_code` REFERENCES `integration_providers(code)`, and 0123 names four
-- codes. `agmarknet` is created by 0104 and is fine. The other two are not, for two DIFFERENT reasons:
--
--   • `razorpay` is seeded by `db/seeds/core/0010_integration_providers.sql` — the ordering problem;
--   • **`msg91` IS CREATED NOWHERE IN THE ENTIRE REPOSITORY.** `grep -rn "INSERT INTO
--     integration_providers" db/` returns 0010 (sandbox, razorpay, razorpayx), 0104 (agmarknet) and
--     0105 (pfms, ikhedut, pmkisan). The SMS/OTP provider named in 0002's own column comment — the one
--     carrying every one-time password this platform sends — was never registered. That row would
--     have failed its foreign key even on a fully seeded database.
--
-- 0104 and 0105 already establish that a migration naming a provider registers it. `razorpay`'s values
-- are byte-identical to the seed's.
INSERT INTO integration_providers (code, default_name, category, is_active)
SELECT v.code, v.default_name, v.category, true
  FROM (VALUES
  ('razorpay', 'Razorpay',            'payment'),
  ('msg91',    'MSG91 (DLT SMS/OTP)', 'sms')
) AS v(code, default_name, category)
 WHERE NOT EXISTS (SELECT 1 FROM integration_providers p WHERE p.code = v.code);

-- ---------------------------------------------------------------------------------------------
-- 0056a.5  INDIA, AND THE RUPEE — the country and currency later migrations write statutory rows for
-- ---------------------------------------------------------------------------------------------
-- `tax_rules.country_code` REFERENCES `countries(code)` and 0140_invoice_statutory_truth seeds India's
-- GST rules; `countries.currency_code` in turn REFERENCES `currencies(code)`, so the pair has to land in
-- that order. Both parents are seeded (`db/seeds/core/0002_countries_regions_gj_mh.sql` and
-- `0003_currencies_units.sql`), i.e. after every migration that needs them, so 0140 failed with
--     ERROR: insert or update on table "tax_rules" violates foreign key constraint
--            "tax_rules_country_code_fkey"
--
-- ONLY India and only the rupee. This platform's other launch geographies are a seed concern and a
-- founder decision, and the migrations in this chain write statutory rows for exactly one country —
-- which is itself the fact 0147 turned into a defect when a hardcoded Indian regex blocked every other.
-- Guaranteeing more here would be this file quietly deciding which countries the platform operates in.
--
-- Values byte-identical to the seeds. `currencies` also carries the `minor_units` that TENANT-4d-5's
-- notice plane divides by, so this row is load-bearing for the billing copy as well as for tax.
INSERT INTO currencies (code, default_name, symbol, minor_units, is_active)
SELECT 'INR', 'Indian Rupee', '₹', 2, true
 WHERE NOT EXISTS (SELECT 1 FROM currencies c WHERE c.code = 'INR');

INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active)
SELECT 'IN', 'India', 'INR', '+91', 'Asia/Kolkata', true
 WHERE NOT EXISTS (SELECT 1 FROM countries c WHERE c.code = 'IN');
