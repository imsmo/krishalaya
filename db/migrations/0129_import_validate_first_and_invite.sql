-- ============================================================================
-- MIGRATION 0129 — AN IMPORT THAT TELLS YOU WHAT IT WILL DO BEFORE IT DOES IT (PC-56 TENANT-1b-4)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- WHAT W156 PROMISES, AND WHICH THREE PARTS THE RAIL COULD NOT KEEP
-- ---------------------------------------------------------------------------
-- W156 (tenant Bulk Import Members): "CSV/Excel — one row per person. **Validates every row first**; imports create
-- pending_verification users who get an app invite SMS in their language. **Idempotent by phone number.**" The screen then
-- shows a triage — 220 rows in the file, 214 valid, 4 already members ("matched by phone — skipped, never duplicated"),
-- 2 fixable — and only THEN a button reading "Import 214 valid rows". Its restricted state adds: "**every import batch is
-- recorded with the file hash**."
--
-- `bulk_import_jobs` (0030) is a real rail with a real applier registry, a real object-store fetch, capped per-row error
-- recording and a proper state machine. Three of the screen's promises had nothing behind them:
--
--   1. **NO VALIDATE-FIRST PASS.** `CsvImportProcessor` claims the job and applies rows as it streams. There is no state
--      between "uploaded" and "applied", so the triage the screen shows could not exist, and an operator's only way to
--      find out what a file would do was to let it do it. On a member register that means 220 half-created people.
--   2. **NO FILE HASH.** The job carries a `storage_key` and an `original_filename`. An object-store key is not evidence:
--      two uploads of a corrected file share neither key nor hash, and nothing recorded WHICH bytes were applied.
--   3. **NO MEMBERS APPLIER AT ALL.** Only 'products' is registered, so `importType: 'members'` was a 422.
--
-- This file adds the columns and the vocabulary. The pass, the hash and the applier are code.
--
-- ---------------------------------------------------------------------------
-- 129.1  THE VALIDATION PASS AS TWO NEW STATES
-- ---------------------------------------------------------------------------
-- **A DRY RUN NEEDS A STATE, NOT A FLAG.** Earlier waves computed dry runs on READ (the erasure scope engine, the risk
-- plane), which is right when the answer is cheap and the operator is looking at it now. This one is different: parsing a
-- 220-row file, normalising every phone number and probing the register for each is work an operator waits for, and the
-- ANSWER has to survive until they come back and press the button. So it is a state with a stored report.
ALTER TABLE bulk_import_jobs
  ADD COLUMN file_sha256 char(64),
  ADD COLUMN validated_at timestamptz,
  -- The triage the screen renders. jsonb rather than columns because the SHAPE is the applier's business: a members
  -- import counts duplicates-by-phone, a products import would count unknown categories, and a column set fixed today
  -- would be wrong for the third applier. Bounded by the app (the row-level issue list is capped like bulk_import_errors).
  ADD COLUMN validation jsonb;

COMMENT ON COLUMN bulk_import_jobs.file_sha256 IS
  'SHA-256 of the exact bytes fetched from the object store, recorded when the file is first read (W156: "every import batch is recorded with the file hash"). NOT unique: re-importing a corrected file is legitimate and common. The console SHOWS a prior job with the same hash as a warning, because re-running an identical file is usually a mistake and occasionally the point.';
COMMENT ON COLUMN bulk_import_jobs.validation IS
  'The validate-first triage: total rows, how many would be created, how many are already members (matched by phone), and a capped list of fixable rows with their reasons. Written by the validation pass and read by the console before the operator confirms.';

-- The status CHECK from 0030 has to grow. Dropped and re-added rather than left alone, because the state machine in
-- `domain/bulk-import.state.ts` mirrors it and a database that accepts fewer states than the code emits is a runtime error
-- nobody sees until an import stalls.
ALTER TABLE bulk_import_jobs DROP CONSTRAINT bulk_import_jobs_status_check;
ALTER TABLE bulk_import_jobs ADD CONSTRAINT bulk_import_jobs_status_check CHECK (
  status IN ('pending', 'validating', 'validated', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled')
);

-- `validated` is an ACTIVE state for the purpose of the per-tenant active-job cap: a file waiting for somebody to press a
-- button is still holding a slot, and five abandoned validations should not let a sixth start.
DROP INDEX IF EXISTS idx_bulk_jobs_active;
CREATE INDEX idx_bulk_jobs_active ON bulk_import_jobs(tenant_id)
  WHERE status IN ('pending', 'validating', 'validated', 'processing');

-- Finding a previous job that applied the SAME bytes. Partial, because a job with no hash yet is not a comparison.
CREATE INDEX idx_bulk_jobs_file_hash ON bulk_import_jobs(tenant_id, file_sha256)
  WHERE file_sha256 IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 129.2  THE INVITE, AND WHAT ITS WORDS HAVE TO CARRY
-- ---------------------------------------------------------------------------
-- W156: "**Consent matters**: the invite SMS says **who added them and why**, in their language, with a decline path. A
-- member who never installs the app still exists for payouts and records — the app is a door, not a wall."
--
-- Every clause there is a requirement on the TEMPLATE, so the variables are declared and required rather than left to
-- whoever writes the copy: `inviter_name`, `org_name`, `reason`. A template that renders "You have been added to Anand
-- FPO" without saying who did it or why is a message a farmer cannot act on, and the person who receives it has no idea
-- whether it is real.
--
-- **`user_can_opt_out` IS TRUE**, which is the decline path in the only form this platform can honour today: the member's
-- own notification preference, plus a named human to tell. A self-service decline LINK needs a signed token and this
-- platform has no signing key yet (standing debt) — so the template names the person who added them instead, which for a
-- voice-first rural member is the better path anyway. TENANT-1b-4-Q1.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('member.invited', 'Added to an organisation', 'important', '["sms","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
  ('member.invited', 'org_name',     'tenants.name',   'Anand FPO',        true),
  ('member.invited', 'inviter_name', 'users.full_name','Rameshbhai Solanki', true),
  ('member.invited', 'reason',       'literal',        'bulk member import from the SHG meeting', true),
  ('member.invited', 'role_name',    'roles.code',     'farmer',           true)
ON CONFLICT (event_code, name) DO NOTHING;

-- **THREE LANGUAGES, BECAUSE "IN THEIR LANGUAGE" IS THE PROMISE AND ENGLISH-ONLY WOULD BREAK IT ON DAY ONE.** The SMS
-- copy is deliberately short: it is one segment of GSM-7 where it can be, because a two-segment invite costs twice as much
-- across 75M households and the second segment usually carries nothing a farmer needed.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
  ('member.invited', 'sms', 'en', NULL, NULL,
   '{{inviter_name}} added you to {{org_name}} as {{role_name}} ({{reason}}). You do not have to install anything - your records and payments work either way. To be removed from these messages, tell {{inviter_name}}.',
   NULL, true),
  ('member.invited', 'sms', 'hi', NULL, NULL,
   '{{inviter_name}} ne aapko {{org_name}} me {{role_name}} ke roop me joda ({{reason}}). App install karna zaroori nahi - aapke record aur bhugtan dono tarah chalte hain. Ye sandesh band karane ke liye {{inviter_name}} se kahein.',
   NULL, true),
  ('member.invited', 'sms', 'gu', NULL, NULL,
   '{{inviter_name}} e tamne {{org_name}} ma {{role_name}} tarike umerya ({{reason}}). App install karvi jaruri nathi - tamara record ane chukavni banne rite chale che. A sandesha bandh karva {{inviter_name}} ne kaho.',
   NULL, true),
  ('member.invited', 'inapp', 'en', NULL, 'You were added to {{org_name}}',
   '{{inviter_name}} added you to {{org_name}} as {{role_name}}. Reason given: {{reason}}. Your records and any money owed to you are unaffected by whether you use the app. If this was not expected, please contact {{inviter_name}}.',
   NULL, true)
ON CONFLICT DO NOTHING;

-- **AND THE VERSION ROWS, WITHOUT WHICH EVERY LINE OF COPY ABOVE IS DEAD.** 0122 made template wording versioned and put a
-- send-time gate in `NotificationTemplateRepository.resolve()`: it joins `notification_template_versions` on
-- `serving_version_id` with `lifecycle = 'approved'`. **A SEEDED TEMPLATE THAT SKIPS VERSIONING RESOLVES TO NOTHING AND THE
-- SEND IS RECORDED AS `no_template` — SILENTLY.** 0123 hit this and fed the gate; so does this file. Checked before writing
-- rather than discovered when the first import sent 214 invisible invites.
INSERT INTO notification_template_versions (
  template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
  provider_template_ref, body_sha256, lifecycle, needs_second_person, approved_at, reason)
SELECT t.id, NULL, t.event_code, t.channel, t.language_code, 1, t.subject, t.body, NULL,
       encode(digest(t.body, 'sha256'), 'hex'), 'approved',
       -- Not security copy and the member CAN opt out, so a second person is not required to change the wording later.
       false, now(),
       'Seeded with 0129 alongside the member.invited event: platform-authored consent copy naming the inviter and the reason, approved on insert.'
  FROM notification_templates t
 WHERE t.event_code = 'member.invited' AND t.tenant_id IS NULL
ON CONFLICT (template_id, version_no) DO NOTHING;

UPDATE notification_templates t
   SET serving_version_id = v.id
  FROM notification_template_versions v
 WHERE v.template_id = t.id AND v.version_no = 1
   AND t.event_code = 'member.invited' AND t.serving_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- 129.3  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **THE FILE HASH IS NOT UNIQUE, AND THAT IS DELIBERATE.** The obvious move is a unique index so the same file cannot be
-- imported twice. It would be wrong: an operator who fixes two rows and re-uploads has a NEW hash, while an operator who
-- re-runs the identical file after a partial failure legitimately wants the same one — and the per-row idempotency key
-- (`bulkrow:<job>:<n>`) plus the members applier's own phone matching are what actually prevent duplicates. A unique hash
-- would block the safe case and not the dangerous one.
--
-- NO SELF-SERVICE DECLINE LINK. It needs a signed token and there is no signing key on this platform yet (standing debt).
-- The template names the human who added them, which is honourable and works on a feature phone. TENANT-1b-4-Q1.
--
-- NO EXCEL PARSING. W156 says "CSV/Excel" and the processor parses CSV only. The template the console offers is a CSV, so
-- the promise the screen makes to a user is kept; an .xlsx upload will fail its parse with a clear message rather than
-- half-importing. TENANT-1b-4-Q2.
--
-- NO ROLE-NAME TRANSLATION TABLE. W156 shows a row where the role reads "khedut" (Gujarati for farmer) and offers "mapped
-- to farmer? confirm". The validation pass marks such a row FIXABLE and reports the suggestion; it does not silently
-- accept it. Guessing that a Gujarati word means a particular role code is how somebody becomes a `dairy_farmer` because
-- two words looked alike — and the roles vocabulary is data that a tenant in another country will fill differently.
