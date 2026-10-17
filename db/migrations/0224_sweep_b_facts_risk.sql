-- ==================================================================================================================
-- MIGRATION 0224 — PC-56 STORE-SWEEP-b · THE SENSITIVE FACTS TAKE TWO ADMINISTRATORS — seven platform facts become `security`
-- (survey_store_sweep.md §6 Q4; STORE-SWEEP-a's founder question Q1; founder decision D6, 2026-10-17.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0223 are applied; nothing here edits them: SEVEN existing
-- `setting_definitions` rows — inserted by 0223 — are UPDATEd in place; seed core/0008 carries the same seven rows as `security` now.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written. No flag, no reserved slug, no new table.
-- ==================================================================================================================
--
-- THE SEVEN (founder D6 — a mailbox or the grievance officer printed on every store's Grievances link must not be changed by one person):
--
--   platform.grievance.email          the grievance mailbox
--   platform.contact.security_email   where a security problem is reported
--   platform.contact.partners_email   organisations and partners
--   platform.contact.press_email      press
--   platform.contact.general_email    everything else
--   platform.grievance.officer_name   the grievance officer's name
--   platform.grievance.address        the grievance officer's postal address
--
-- STAY `ordinary` (one administrator, with a reason): platform.legal.entity_name, platform.legal.registered_office,
-- platform.grievance.ack_hours, platform.grievance.resolve_days.
--
-- WHAT `security` DOES: apps/admin-api settings-ops `requiresChecker(riskClass)` (domain/setting-value.ts) is true for `money_path` and
-- `security`; `SettingsOpsService.setValue` then refuses a write with no `proposedByAdminId` (SETTING_CHECKER_REQUIRED — "it takes two
-- administrators") and `assertSecondPerson` refuses a proposer who is also the approver. The values themselves are untouched (an empty value
-- still means "not published yet"); the storefront read (`GET /v1/storefront/platform-facts`) does not look at the risk class.
--
-- WHERE THE UPDATE APPLIES — on EVERY database that runs this file, including one built from empty: migrations run before seeds (migrate.js
-- interleaves no seed with 0223/0224), so 0223 has inserted the seven as `ordinary` and this UPDATE turns them `security` (7 rows). Seed
-- core/0008 now carries them as `security` too, but its `ON CONFLICT (key) DO NOTHING` never touches a row that exists — the seed is the
-- registry's mirror, this migration is what changes a database. Re-running seed 0008 on an existing database changes nothing.
--
-- REVERSAL (hand-run, never by the runner):
--   UPDATE setting_definitions SET risk_class = 'ordinary', lock_note = NULL
--    WHERE key IN ('platform.grievance.email', 'platform.contact.security_email', 'platform.contact.partners_email',
--                  'platform.contact.press_email', 'platform.contact.general_email', 'platform.grievance.officer_name',
--                  'platform.grievance.address');
--   -- (and seed core/0008's seven rows back to 'ordinary')
-- ==================================================================================================================

UPDATE setting_definitions
   SET risk_class = 'security',
       lock_note  = 'PC-56 STORE-SWEEP-b (0224, founder D6): a published trust fact — printed on Trust & your data and Contact, linked from every store''s Grievances link. Two administrators: one proposes with a reason, a different one approves.'
 WHERE key IN ('platform.grievance.email', 'platform.contact.security_email', 'platform.contact.partners_email',
               'platform.contact.press_email', 'platform.contact.general_email', 'platform.grievance.officer_name',
               'platform.grievance.address');
