-- =============================================================================================
-- 0149_billing_notifications.sql · PC-56 TENANT-4d-5 — THE PLATFORM LEARNS TO TELL A TENANT
-- =============================================================================================
-- W120's footnote, in full, for the third wave running: "If a renewal payment fails, service enters a
-- **grace period** — nothing switches off for 7 days while we retry and notify you. Your members never
-- feel a billing hiccup." TENANT-4d-1's W118: "at 90% of any limit you get a console + email notice."
--
-- 4d-4 built the grace window and left the last clause named as a gap. This is that clause.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): SEVEN BILLING EVENTS, ZERO SUBSCRIBERS — A TENANT HAS NEVER BEEN TOLD
--                          ANYTHING ABOUT ITS OWN BILL
-- ---------------------------------------------------------------------------------------------
-- `apps/api/src/modules/communication/events/notification-event-map.ts` is the ONE bridge from a module's
-- outbox event to a notification. It carries 22 rows. **NOT ONE OF THEM IS A TENANCY EVENT.** So:
--
--   tenancy.saas_invoice_issued          a bill was raised            → nobody told
--   tenancy.saas_invoice_paid            a bill was settled           → nobody told
--   tenancy.saas_invoice_overdue         a bill is past its due date  → nobody told
--   tenancy.trial_ending                 access is about to end       → nobody told
--   tenancy.usage_limit_alert            a quota is nearly spent      → nobody told  (W118's promise)
--   tenancy.subscription_grace_started   service will stop in N days  → nobody told  (0148, new)
--   tenancy.subscription_renewed         the period rolled            → nobody told  (0148, new)
--
-- Every one of them is emitted through the outbox, relayed by the OutboxRelayRunner, and dropped. This is
-- the event-with-no-subscriber defect at the largest scale this programme has found it: not one event, but
-- the entire billing correspondence of a platform that intends to bill in three languages across 75M
-- households. An FPO's service could enter a grace window and expire eight days later having received no
-- message on any channel, ever, from anybody.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: AND THE MAP ROWS ALONE WOULD HAVE CHANGED NOTHING
-- ---------------------------------------------------------------------------------------------
-- The map file already documents this trap, in a comment ADMIN-6b wrote after walking into it:
-- "**AND THE ROW ALONE WOULD NOT HAVE FIXED IT.** The event's payload was `{ v: 1, payoutId, amountMinor }`
--  — no user id, so `DomainEventFanoutHandler` would have found no recipient and returned early, silently
--  … a map row pointing at a payload with no recipient is the shape of fix that looks done and changes
--  nothing."
--
-- All seven tenancy payloads carry `tenantId` and no user id. A tenant is not a person and cannot receive an
-- SMS. So the wave is the RECIPIENT QUESTION, and the answer is `domain/billing-notice.ts`: the holders of
-- `tenant.settings` — **the same permission the billing console requires** — resolved with the same four
-- clauses `RoleCacheService` uses (role permissions ∪ per-staff grants − per-staff denies − members this
-- tenant has suspended). Not a role, because `roles` is a platform table with no tenant id and hardcoding
-- `tenant_admin` would block a white-label that names its roles differently — Rule Zero, in one line. Not a
-- `billing_email` column, because that is a staler copy of a fact the RBAC tables already hold and would be
-- empty on a phone-first platform. The permission is the honest answer because it is the key that opens the
-- screen where the tenant can actually pay the bill.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: A SEEDED TEMPLATE WITH NO APPROVED VERSION SENDS NOTHING, SILENTLY
-- ---------------------------------------------------------------------------------------------
-- 0122 made template wording versioned and put a send-time gate in
-- `NotificationTemplateRepository.resolve()`: it joins `notification_template_versions` on
-- `serving_version_id` with `lifecycle = 'approved'`. A template row that skips versioning resolves to
-- NOTHING and the send is recorded as `no_template`. 0123 hit it; 0129 hit it and wrote it down. So every
-- template below gets a version row and a `serving_version_id`, in this same file, checked before writing
-- rather than discovered when the first grace window closed in silence.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: A MISSING VARIABLE RENDERS AS A HOLE, AND `{{totalMinor}}` IS 795400
-- ---------------------------------------------------------------------------------------------
-- `NotificationTemplate.render()` documents its own choice: "Missing keys render as '' (never leak '{{x}}'
-- to a user)" — correct for a user-facing string, and it means a body referencing a key the payload does not
-- carry sends "Invoice  for  is due on ." It renders, it dispatches, it is logged as `sent`, nothing fails.
--
-- And every billing payload on this platform carries money as a string of MINOR UNITS, so the naive body
-- "You owe {{totalMinor}}" tells an FPO it owes 795400. The one seeded precedent hedges — 'dispute.refunded'
-- sends "A refund of {{amountMinor}} (minor units) was issued" — which is honest and unreadable, and not
-- good enough for the document a tenant pays against.
--
-- Both are closed by the emitter, not by the copy: `BillingNoticeService` formats `amountText` with integer
-- arithmetic against that currency's own `minor_units` (INR 2, JPY 0, KWD 3 — never a hardcoded ÷100, which
-- is the shape that blocks a country) and REFUSES TO SEND AT ALL if it cannot. `NOTICE_VARIABLES` declares
-- what each notice carries, `notification_event_variables` declares it to the authoring UI, and
-- `tenant4d5-billing-notices.spec.ts` reads every template body seeded here, extracts its `{{tokens}}`, and
-- asserts each one is a variable the emitter actually sends — so a later wave cannot seed a hole.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 5: THE OVERDUE EVENT CARRIED A VERDICT AND NO EVIDENCE
-- ---------------------------------------------------------------------------------------------
-- `SaasInvoice.markOverdue()` emitted `{ invoiceId, tenantId, invoiceNo }` — an invoice is overdue, and
-- neither how much is owed nor the date it was due. So the only consumer this event could ever have had had
-- nothing to put in the sentence. Same shape 0146 defect 2 found on `payments.payment_succeeded` and 0148
-- defect 2 found on `saas_invoice_paid`, one layer up again. It now carries the currency, the due date, and
-- `outstandingMinor` — the REMAINDER, not the total, because 0146 made part-payment reachable and quoting
-- the full amount would overstate the debt of exactly the tenant who has already paid some of it.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 6: `usage-limit-alerts.job.ts` DOES NOT COMPILE, AND NOTHING COULD SEE THAT
-- ---------------------------------------------------------------------------------------------
-- TENANT-4d-1 corrected W118's threshold in that file by writing `DEFAULT_ALERT_THRESHOLD_PCT / 100` into a
-- default parameter and never adding the import. `tsc` reports TS2304 on it. The wave that wrote it passed a
-- clean typecheck because:
--   • `apps/api/tsconfig.json` includes only `src/main.ts`, `src/app.module.ts`, `src/core/**`,
--     `src/shared/**` and `src/modules/listings/**`; every other module is checked only through what those
--     transitively import. The job was a DI provider nowhere and imported by nothing, so
--     `tsc --listFiles` never mentions it. **AN UNWIRED FILE IS ALSO AN UNTYPECHECKED FILE.**
--   • the 4d-1 spec covering that line asserts on the file's SOURCE TEXT
--     (`expect(s).toContain('DEFAULT_ALERT_THRESHOLD_PCT / 100')`), so it read the characters, found them,
--     and passed. A text assertion cannot fail on an unresolved symbol.
-- So the honest statement of the pre-wave world is not "the usage alert used the wrong threshold": the job
-- that sends W118's promised notice could not have been loaded into a Node process. Wiring it (this wave)
-- is both the fix and the detector.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 7: `Subscription.rollPeriod` WAS NOT IDEMPOTENT, AND AN UPGRADE BOUGHT A FREE MONTH
-- ---------------------------------------------------------------------------------------------
-- Three headers (the entity's, the service's, the handler's) claimed "a re-delivered paid event finds the
-- period already rolled and `rollPeriod` returns false". **No code implemented it.** After a roll the status
-- is `active` and the period end is in the FUTURE, which the method read as "paid early" and rolled again
-- from `now`. `core/outbox/outbox.dispatcher.ts` is explicit that delivery is at-least-once and that a
-- handler set which throws quarantines the event for a DLQ requeue — so every replay granted a full free
-- period. **AND THIS WAVE IS WHAT MAKES REPLAY ROUTINE**, because it registers a SECOND handler (the
-- notification fanout) on `tenancy.saas_invoice_paid`, inside the same transaction as the period roll.
--
-- The same missing guard had a second victim already live: `PlanChangeService` raises a mid-cycle proration
-- invoice against the subscription, and paying one rolled the period — a tenant who upgraded got a free
-- month. Fixed twice over, deliberately, because the two guards fail differently: the entity now refuses a
-- period that has not ended (WHEN), and the handler now requires a non-null `period_tag` (WHAT) — which is
-- the field 0148 added to the payload for exactly this purpose and then never read.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 8: AN EMAIL TO A USER WITH NO EMAIL ADDRESS WAS RECORDED AS `sent`
-- ---------------------------------------------------------------------------------------------
-- `NotificationService.deliverPush` has resolved the recipient's own device tokens and recorded `no_device`
-- since P0-10. **No other external channel asked the equivalent question.** The gateway port's contract is
-- that "the external product resolves device tokens / contact" from a bare `userId`, so a send on a channel
-- the recipient has no address for was dispatched, came back `accepted` (the notifier took the request), and
-- was written into the delivery log as `sent`.
--
-- Harmless while nothing seeded an email template. W118 promises a tenant "a console + email notice" and
-- this file seeds exactly that, on a platform where `users.email` is nullable and usually null — so without
-- a check the delivery log, which is what a support agent and a regulator both read, would have asserted
-- that the notice went out. `no_address` is now recorded, counted and not sent: the same shape of truth as
-- `no_device` and `no_template`.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------------------------
-- **NO AUTOMATED NOTICE IS WRITTEN TO `saas_invoice_dunning_attempts`, AND THAT IS A DECISION.** The obvious
-- move is to record each automated overdue notice there so the operator's chase console can see it. It would
-- be wrong twice. The table's `actor_user_id` is NOT NULL and its channel list (`email|sms|whatsapp|call|
-- in_app`, including *call*) models A HUMAN CHASING A DEBT; an automated notice has no actor, and filling the
-- column with a system uuid would be a status recording an act nobody performed — a defect class already on
-- this programme's list. And the `notifications` delivery log already records every send in more detail than
-- the dunning table can hold (channel, final status, template VERSION, provider ref, cost), so a second row
-- would be two mechanisms over one fact.
--
-- THE COST OF THAT DECISION IS NAMED RATHER THAN HIDDEN: the operator's chase console counts only human
-- attempts, so it will UNDER-REPORT contact with a tenant the platform has already messaged three times, and
-- an operator may chase somebody who has been told. Joining the delivery log into that console is admin-api
-- work (Law 11) and belongs to an ADMIN wave. `tenant4d5-billing-notices.spec.ts` pins that no automated path
-- writes to the dunning table, so this stays a decision and does not decay into an oversight.
--
-- NO PER-LOCALE MONEY GROUPING. `amountText` groups every three digits and prefixes the ISO 4217 CODE rather
-- than a symbol. The code is unambiguous in all three scripts the platform ships and needs no locale data;
-- three-digit grouping is wrong for the Indian lakh/crore convention and is therefore not CLAIMED to be
-- localised. Correct grouping needs a locale per RECIPIENT and the payload is shared across recipients, so it
-- is a follow-up with a real design, not an approximation smuggled in here.
--
-- NO RETRY. "While we retry" still has no subject: there is no autopay mandate for a SaaS subscription
-- anywhere in the payments module. W120's fourth sentence therefore moves from `no_notification` to
-- `notify_only` — "we will tell you, and you pay it yourself" — rather than to `exists`. 0148's own test
-- ("'we retry and notify you' STAYS a gap — neither half of it exists") fails by design in this wave and is
-- inverted to pin the new truth, exactly as 4d-2's two planted tests were inverted by 4d-4.
--
-- NO NEW OPT-OUT SURFACE. Preferences and quiet hours already exist per (user, event_code, channel) and the
-- catalog rows below set `user_can_opt_out` per event. The three notices that precede a LOSS OF SERVICE
-- (overdue, grace started, trial ending) are NOT opt-out-able: a tenant who could switch off the only warning
-- before their FPO's platform stopped working has been handed a trap, which is a trust cost Rule Zero forbids
-- regardless of how much it looks like user choice.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 149.1  THE CATALOG — seven events, and a channel choice per event that is defensible on cost
-- ---------------------------------------------------------------------------------------------
-- CHANNELS ARE NOT UNIFORM AND MUST NOT BE. An SMS costs real money per message per tenant per event, and
-- 0129 already established the standing argument in this repository ("a two-segment invite costs twice as
-- much across 75M households and the second segment usually carries nothing a farmer needed"). So a costed
-- channel is spent only where service is at stake:
--   • SMS where the tenant is about to LOSE something (overdue, grace started, trial ending);
--   • in-app everywhere, because the console is free and is the record;
--   • email where a written trail is the point (the bill itself) or where the canon says the word (W118).
-- `inapp` is FIRST in every list on purpose: `applyRoutinePolicy` treats the first non-passive channel as
-- the primary for routine tiers, and every event below is 'important' (money tier, explicitly unaffected by
-- that collapse) — but ordering it first means a later re-tiering cannot silently promote SMS.
--
-- PRIORITY IS 'important' AND NEVER 'critical' FOR ALL SEVEN. `resolveChannels` lets 'critical' BYPASS QUIET
-- HOURS, and no billing fact is worth waking a farmer-cooperative administrator at 02:00. Quiet-hours
-- suppression of the SMS while the in-app notice still lands is the correct behaviour here, not a shortfall.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('saas.invoice_issued',        'Your invoice is ready',        'important', '["inapp","email"]',        true,  false),
  ('saas.invoice_paid',          'Payment received',             'important', '["inapp"]',                true,  false),
  -- The three that precede a loss of service. user_can_opt_out = false: see the header.
  ('saas.invoice_overdue',       'Your invoice is overdue',      'important', '["inapp","sms"]',          false, false),
  ('saas.grace_started',         'Service continues for now',    'important', '["inapp","sms"]',          false, false),
  ('saas.trial_ending',          'Your trial is ending',         'important', '["inapp","sms"]',          false, false),
  ('saas.subscription_renewed',  'Subscription renewed',         'important', '["inapp"]',                true,  false),
  -- W118: "at 90% of any limit you get a console + email notice" — the console half is inapp, and the email
  -- half is seeded because the canon says the word. Where the recipient has no email address on file the
  -- delivery log now records `no_address` (defect 8) instead of claiming a send.
  ('saas.usage_limit_alert',     'Approaching a plan limit',     'important', '["inapp","email"]',        true,  false)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 149.2  DEFECT 9 — 0122's CHECK MAKES THE PLATFORM'S OWN VARIABLES UNDECLARABLE
-- ---------------------------------------------------------------------------------------------
-- **CAUGHT BY THE LIVE APPLY, NOT BY REVIEW.** 0122 created
--     name varchar(64) NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$')
-- which admits snake_case only. Every variable 0122 itself declared is snake_case (`order_id`,
-- `payment_status`, `receipt_url`, `lot_name`, `scheme_name`), so the constraint looked settled.
--
-- IT IS NOT, AND THE EVIDENCE WAS ALREADY IN THE REPOSITORY. `NotificationTemplate.render()` interpolates
-- straight out of the outbox payload, its token regex is `[a-zA-Z0-9_.]`, and this is a TypeScript codebase
-- whose payloads are camelCase throughout — so the seeded bodies in `db/seeds/core/0007` already read
-- `{{orderNo}}` and `{{amountMinor}}`, and 0048's tenant broadcast reads `{{title}}`/`{{body}}`. **NOT ONE
-- camelCase VARIABLE ON THIS PLATFORM CAN BE DECLARED**, which is why every M13 fanout code and every code
-- added since (`payout.credited`, `impersonation.session_started`, `member.invited`) has an EMPTY variable
-- catalogue — and 0122's own promise, that "a required variable missing from a body is refused at authoring
-- time", therefore covers five events out of thirty.
--
-- The alternative was to rename this wave's payload keys to snake_case, which would mean the emitter writing
-- `invoice_no` AND `invoiceNo` into every payload — two names for one value, and the drift starts on day one.
-- So the constraint widens. It still refuses anything that is not a variable name: it must begin with a
-- lowercase letter (no constants, no class names, no leading digits or underscores), and it still admits the
-- dotted path form 0122 added for nested payload access.
--
-- WHAT THIS DOES NOT DO: back-fill the variable catalogues of the ~25 events that have none. That is a real
-- audit — each needs its seeded bodies read and its emitter's payload confirmed — and it is named in the
-- tracker rather than guessed at here. This file declares its own seven, correctly, for the first time.
ALTER TABLE notification_event_variables DROP CONSTRAINT IF EXISTS notification_event_variables_name_check;
ALTER TABLE notification_event_variables
  ADD CONSTRAINT notification_event_variables_name_check
  CHECK (name ~ '^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$');

-- ---------------------------------------------------------------------------------------------
-- 149.3  THE DECLARED VARIABLES (0122) — what an author may reference, with a source and a sample
-- ---------------------------------------------------------------------------------------------
-- Every name here is a key `BillingNoticeService` provably puts in the payload; `NOTICE_VARIABLES` in
-- `domain/billing-notice.ts` is the same list in TypeScript and a spec asserts the two agree, in both
-- directions. `is_required = true` for anything whose absence would leave a hole in a sentence a tenant
-- reads, which is all of them: 0122's own rule is that a required variable missing from a body is refused at
-- authoring time, and every body below is a complete sentence rather than a headline plus optional detail.
--
-- `amountText` is source_ref 'derived' and not a column, because it IS derived — minor units divided by that
-- currency's own exponent, prefixed with the ISO code — and pointing it at `saas_invoices.total_minor` would
-- tell an author it is a raw column they may reformat.
INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
  ('saas.invoice_issued',  'invoiceNo',  'saas_invoices.invoice_no', 'KRI-202607-0001', true),
  ('saas.invoice_issued',  'amountText', 'derived',                  'INR 7,954.00',    true),
  ('saas.invoice_issued',  'dueDate',    'saas_invoices.due_date',   '2026-07-31',      true),
  ('saas.invoice_paid',    'invoiceNo',  'saas_invoices.invoice_no', 'KRI-202607-0001', true),
  ('saas.invoice_paid',    'amountText', 'derived',                  'INR 7,954.00',    true),
  ('saas.invoice_overdue', 'invoiceNo',  'saas_invoices.invoice_no', 'KRI-202607-0001', true),
  ('saas.invoice_overdue', 'amountText', 'derived',                  'INR 3,977.00',    true),
  ('saas.invoice_overdue', 'dueDate',    'saas_invoices.due_date',   '2026-07-31',      true),
  ('saas.grace_started',   'graceUntil', 'subscriptions.grace_until', '2026-08-07',     true),
  ('saas.subscription_renewed', 'periodEnd', 'subscriptions.current_period_end', '2026-09-01', true),
  ('saas.trial_ending',    'trialEndsOn', 'subscriptions.current_period_end', '2026-08-21', true),
  ('saas.usage_limit_alert', 'metricCode', 'plan_limits.limit_code', 'members',         true),
  ('saas.usage_limit_alert', 'pct',        'derived',                '92',              true),
  ('saas.usage_limit_alert', 'used',       'usage_counters.used_value', '4600',          true),
  ('saas.usage_limit_alert', 'limit',      'plan_limits.limit_value',   '5000',          true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 149.4  THE COPY — THREE LANGUAGES, BECAUSE ENGLISH-ONLY BREAKS THE PROMISE ON DAY ONE
-- ---------------------------------------------------------------------------------------------
-- Law 7, and 0129's ruling verbatim: "THREE LANGUAGES, BECAUSE 'IN THEIR LANGUAGE' IS THE PROMISE AND
-- ENGLISH-ONLY WOULD BREAK IT ON DAY ONE." A billing notice in English to a Gujarati-speaking FPO secretary
-- is a notice that was not given.
--
-- hi/gu are TRANSLITERATED for SMS and scripted for in-app, matching 0129's own seeded pattern: a Devanagari
-- or Gujarati SMS is a UCS-2 message with a 70-character segment, so a scripted SMS of this length would cost
-- three segments where a transliterated one costs one — and the transliterated form is what a feature phone
-- reliably renders. The in-app body has no segment cost and no font risk, so it is in script.
--
-- NO `provider_template_ref` ON ANY SMS ROW, and that is a real limitation stated rather than hidden: India's
-- DLT regime requires a registered template id for transactional SMS and the platform holds registrations for
-- the OTP and wage templates only (see 0007's DLT_* refs). These bodies are written to be registrable — fixed
-- wording, variables only in the {{slots}} — but until a registration exists the SMS half of a notice may be
-- rejected by the Indian operator, which the delivery log will record as a `failed` send with the provider's
-- reason. The in-app half is unaffected. Registering these six templates is founder/ops work, and it is named
-- in the tracker rather than pretended away with a placeholder ref that would fail at send time anyway.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
  -- ---- the bill was raised -------------------------------------------------------------------
  ('saas.invoice_issued','inapp','en',NULL,'Invoice {{invoiceNo}} is ready',
   'Your invoice {{invoiceNo}} for {{amountText}} is ready and is due on {{dueDate}}. You can view it and pay it from Billing.',NULL,true),
  ('saas.invoice_issued','inapp','hi',NULL,'इनवॉइस {{invoiceNo}} तैयार है',
   'आपका इनवॉइस {{invoiceNo}}, राशि {{amountText}}, तैयार है और {{dueDate}} तक देय है। बिलिंग में देखें और भुगतान करें।',NULL,true),
  ('saas.invoice_issued','inapp','gu',NULL,'ઇન્વૉઇસ {{invoiceNo}} તૈયાર છે',
   'તમારું ઇન્વૉઇસ {{invoiceNo}}, રકમ {{amountText}}, તૈયાર છે અને {{dueDate}} સુધી ચૂકવવાનું છે. બિલિંગમાં જોઈને ચૂકવો.',NULL,true),
  ('saas.invoice_issued','email','en',NULL,'Invoice {{invoiceNo}} — {{amountText}}',
   'Your invoice {{invoiceNo}} for {{amountText}} is ready and is due on {{dueDate}}. You can view the invoice and pay it from the Billing screen in your console.',NULL,true),
  ('saas.invoice_issued','email','hi',NULL,'इनवॉइस {{invoiceNo}} — {{amountText}}',
   'आपका इनवॉइस {{invoiceNo}}, राशि {{amountText}}, तैयार है और {{dueDate}} तक देय है। अपने कंसोल की बिलिंग स्क्रीन से इनवॉइस देखें और भुगतान करें।',NULL,true),
  ('saas.invoice_issued','email','gu',NULL,'ઇન્વૉઇસ {{invoiceNo}} — {{amountText}}',
   'તમારું ઇન્વૉઇસ {{invoiceNo}}, રકમ {{amountText}}, તૈયાર છે અને {{dueDate}} સુધી ચૂકવવાનું છે. તમારા કન્સોલની બિલિંગ સ્ક્રીન પરથી ઇન્વૉઇસ જોઈને ચૂકવો.',NULL,true),
  -- ---- the bill was settled ------------------------------------------------------------------
  -- A RECEIPT, NOT A THANK-YOU. It names the invoice and the amount so it can be filed against a statement,
  -- which is the only reason a finance clerk keeps one.
  ('saas.invoice_paid','inapp','en',NULL,'Payment received',
   'We received {{amountText}} for invoice {{invoiceNo}}. It is now settled and your receipt is on the invoice.',NULL,true),
  ('saas.invoice_paid','inapp','hi',NULL,'भुगतान प्राप्त हुआ',
   'इनवॉइस {{invoiceNo}} के लिए {{amountText}} प्राप्त हुए। यह अब चुकता है और रसीद इनवॉइस पर उपलब्ध है।',NULL,true),
  ('saas.invoice_paid','inapp','gu',NULL,'ચુકવણી મળી',
   'ઇન્વૉઇસ {{invoiceNo}} માટે {{amountText}} મળ્યા. તે હવે ચૂકતે થયું છે અને રસીદ ઇન્વૉઇસ પર છે.',NULL,true),
  -- ---- the bill is overdue -------------------------------------------------------------------
  -- `amountText` here is the REMAINDER, not the invoice total (defect 5). The SMS says what is owed and by
  -- when it was owed, and nothing else — no threat, no "final notice", because service has not stopped.
  ('saas.invoice_overdue','inapp','en',NULL,'Invoice {{invoiceNo}} is overdue',
   'Invoice {{invoiceNo}} was due on {{dueDate}} and {{amountText}} is still outstanding. Paying it from Billing keeps your service running.',NULL,true),
  ('saas.invoice_overdue','inapp','hi',NULL,'इनवॉइस {{invoiceNo}} बकाया है',
   'इनवॉइस {{invoiceNo}} की देय तिथि {{dueDate}} थी और {{amountText}} अभी बकाया है। बिलिंग से भुगतान करने पर आपकी सेवा चालू रहेगी।',NULL,true),
  ('saas.invoice_overdue','inapp','gu',NULL,'ઇન્વૉઇસ {{invoiceNo}} બાકી છે',
   'ઇન્વૉઇસ {{invoiceNo}} ની ચુકવણી તારીખ {{dueDate}} હતી અને {{amountText}} હજુ બાકી છે. બિલિંગમાંથી ચૂકવવાથી તમારી સેવા ચાલુ રહેશે.',NULL,true),
  ('saas.invoice_overdue','sms','en',NULL,NULL,
   'Krishalaya: invoice {{invoiceNo}} was due {{dueDate}}. {{amountText}} outstanding. Pay from Billing in your console to keep service running.',NULL,true),
  ('saas.invoice_overdue','sms','hi',NULL,NULL,
   'Krishalaya: invoice {{invoiceNo}} ki dey tithi {{dueDate}} thi. {{amountText}} bakaya hai. Seva chalu rakhne ke liye console ki Billing se bhugtan karein.',NULL,true),
  ('saas.invoice_overdue','sms','gu',NULL,NULL,
   'Krishalaya: invoice {{invoiceNo}} ni chukavni tarikh {{dueDate}} hati. {{amountText}} baki che. Seva chalu rakhva console ni Billing mathi chukavo.',NULL,true),
  -- ---- the grace window opened ---------------------------------------------------------------
  -- W120's own promise, said back to the tenant in its own words: nothing switches off, and here is the date.
  -- It does NOT say "we are retrying", because we are not — there is no autopay mandate to retry against, and
  -- telling a tenant to wait for a charge that will never be attempted is the fake surface 4d-2 refused and
  -- this wave still refuses.
  ('saas.grace_started','inapp','en',NULL,'Service continues until {{graceUntil}}',
   'A subscription payment is outstanding. Nothing switches off: your service and your members'' access continue until {{graceUntil}}. Pay the open invoice from Billing before then.',NULL,true),
  ('saas.grace_started','inapp','hi',NULL,'सेवा {{graceUntil}} तक चालू रहेगी',
   'सदस्यता का भुगतान बकाया है। कुछ भी बंद नहीं हो रहा: आपकी सेवा और आपके सदस्यों की पहुँच {{graceUntil}} तक चालू रहेगी। उससे पहले बिलिंग से बकाया इनवॉइस का भुगतान करें।',NULL,true),
  ('saas.grace_started','inapp','gu',NULL,'સેવા {{graceUntil}} સુધી ચાલુ રહેશે',
   'સભ્યપદની ચુકવણી બાકી છે. કંઈ બંધ થતું નથી: તમારી સેવા અને તમારા સભ્યોની પહોંચ {{graceUntil}} સુધી ચાલુ રહેશે. તે પહેલાં બિલિંગમાંથી બાકી ઇન્વૉઇસ ચૂકવો.',NULL,true),
  ('saas.grace_started','sms','en',NULL,NULL,
   'Krishalaya: a subscription payment is outstanding. Nothing switches off - your service continues until {{graceUntil}}. Pay the open invoice from Billing before then.',NULL,true),
  ('saas.grace_started','sms','hi',NULL,NULL,
   'Krishalaya: sadasyata ka bhugtan bakaya hai. Kuch band nahi ho raha - seva {{graceUntil}} tak chalu rahegi. Us se pehle Billing se bhugtan karein.',NULL,true),
  ('saas.grace_started','sms','gu',NULL,NULL,
   'Krishalaya: sabhyapad ni chukavni baki che. Kai bandh thatu nathi - seva {{graceUntil}} sudhi chalu rahese. Te pehla Billing mathi chukavo.',NULL,true),
  -- ---- the period rolled ---------------------------------------------------------------------
  ('saas.subscription_renewed','inapp','en',NULL,'Subscription renewed',
   'Your subscription is renewed and runs to {{periodEnd}}. Nothing else is needed.',NULL,true),
  ('saas.subscription_renewed','inapp','hi',NULL,'सदस्यता नवीकृत हुई',
   'आपकी सदस्यता नवीकृत हो गई है और {{periodEnd}} तक चलेगी। कुछ और करने की आवश्यकता नहीं है।',NULL,true),
  ('saas.subscription_renewed','inapp','gu',NULL,'સભ્યપદ નવીકૃત થયું',
   'તમારું સભ્યપદ નવીકૃત થયું છે અને {{periodEnd}} સુધી ચાલશે. બીજું કંઈ કરવાની જરૂર નથી.',NULL,true),
  -- ---- the trial is ending -------------------------------------------------------------------
  ('saas.trial_ending','inapp','en',NULL,'Your trial ends on {{trialEndsOn}}',
   'Your trial ends on {{trialEndsOn}}. Choose a plan from Billing before then to keep your organisation''s access and data working exactly as they do today.',NULL,true),
  ('saas.trial_ending','inapp','hi',NULL,'आपका ट्रायल {{trialEndsOn}} को समाप्त होगा',
   'आपका ट्रायल {{trialEndsOn}} को समाप्त हो रहा है। उससे पहले बिलिंग से कोई प्लान चुनें, जिससे आपके संगठन की पहुँच और डेटा आज की तरह ही चलते रहें।',NULL,true),
  ('saas.trial_ending','inapp','gu',NULL,'તમારું ટ્રાયલ {{trialEndsOn}} ના રોજ પૂરું થશે',
   'તમારું ટ્રાયલ {{trialEndsOn}} ના રોજ પૂરું થાય છે. તે પહેલાં બિલિંગમાંથી પ્લાન પસંદ કરો, જેથી તમારી સંસ્થાની પહોંચ અને ડેટા આજની જેમ ચાલુ રહે.',NULL,true),
  ('saas.trial_ending','sms','en',NULL,NULL,
   'Krishalaya: your trial ends on {{trialEndsOn}}. Choose a plan from Billing in your console before then to keep your access and data working.',NULL,true),
  ('saas.trial_ending','sms','hi',NULL,NULL,
   'Krishalaya: aapka trial {{trialEndsOn}} ko samapt ho raha hai. Us se pehle console ki Billing se plan chunein, taki aapki pahunch aur data chalte rahein.',NULL,true),
  ('saas.trial_ending','sms','gu',NULL,NULL,
   'Krishalaya: tamaru trial {{trialEndsOn}} na roj puru thay che. Te pehla console ni Billing mathi plan pasand karo, jethi tamari pahonch ane data chalu rahe.',NULL,true),
  -- ---- a quota is nearly spent (W118) --------------------------------------------------------
  -- `pct` is an integer already rounded by the emitter, so the body never does arithmetic. `used` and `limit`
  -- are raw counts (members, hectares, calls) and are NOT money — no amountText here, deliberately.
  ('saas.usage_limit_alert','inapp','en',NULL,'{{pct}}% of your {{metricCode}} limit used',
   'You have used {{used}} of {{limit}} {{metricCode}} on your plan ({{pct}}%). Nothing is blocked yet. You can review usage and upgrade from Billing.',NULL,true),
  ('saas.usage_limit_alert','inapp','hi',NULL,'{{metricCode}} सीमा का {{pct}}% उपयोग हो चुका',
   'आपने अपने प्लान की {{limit}} {{metricCode}} में से {{used}} का उपयोग किया है ({{pct}}%)। अभी कुछ भी रोका नहीं गया है। बिलिंग से उपयोग देखें और प्लान बढ़ाएँ।',NULL,true),
  ('saas.usage_limit_alert','inapp','gu',NULL,'{{metricCode}} મર્યાદાનો {{pct}}% વપરાયો',
   'તમે તમારા પ્લાનની {{limit}} {{metricCode}} માંથી {{used}} વાપર્યા છે ({{pct}}%). હજુ કંઈ અટકાવ્યું નથી. બિલિંગમાંથી વપરાશ જુઓ અને પ્લાન વધારો.',NULL,true),
  ('saas.usage_limit_alert','email','en',NULL,'{{pct}}% of your {{metricCode}} limit used',
   'You have used {{used}} of {{limit}} {{metricCode}} on your current plan ({{pct}}%). Nothing is blocked yet. You can review usage and upgrade from the Billing screen in your console.',NULL,true),
  ('saas.usage_limit_alert','email','hi',NULL,'{{metricCode}} सीमा का {{pct}}% उपयोग हो चुका',
   'आपने अपने वर्तमान प्लान की {{limit}} {{metricCode}} में से {{used}} का उपयोग किया है ({{pct}}%)। अभी कुछ भी रोका नहीं गया है। कंसोल की बिलिंग स्क्रीन से उपयोग देखें और प्लान बढ़ाएँ।',NULL,true),
  ('saas.usage_limit_alert','email','gu',NULL,'{{metricCode}} મર્યાદાનો {{pct}}% વપરાયો',
   'તમે તમારા વર્તમાન પ્લાનની {{limit}} {{metricCode}} માંથી {{used}} વાપર્યા છે ({{pct}}%). હજુ કંઈ અટકાવ્યું નથી. કન્સોલની બિલિંગ સ્ક્રીન પરથી વપરાશ જુઓ અને પ્લાન વધારો.',NULL,true)
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 149.5  THE VERSION ROWS, WITHOUT WHICH EVERY LINE OF COPY ABOVE IS DEAD (defect 3)
-- ---------------------------------------------------------------------------------------------
-- 0122 put a send-time gate in `NotificationTemplateRepository.resolve()` that joins
-- `notification_template_versions` on `serving_version_id` with `lifecycle = 'approved'`. **A SEEDED TEMPLATE
-- THAT SKIPS VERSIONING RESOLVES TO NOTHING AND THE SEND IS RECORDED AS `no_template` — SILENTLY.** 0123 hit
-- it, 0129 hit it and left the warning; this file fed the gate before writing a word of copy.
--
-- `needs_second_person = true` for the three notices that precede a loss of service. This is not security
-- copy, but it is the last thing a tenant hears before their organisation's platform stops working, and a
-- single operator editing that wording — softening it, or removing the date — changes the platform's only
-- warning. Two people, then. The remaining four are ordinary transactional copy and need one.
INSERT INTO notification_template_versions (
  template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
  provider_template_ref, body_sha256, lifecycle, needs_second_person, approved_at, reason)
SELECT t.id, NULL, t.event_code, t.channel, t.language_code, 1, t.subject, t.body, t.provider_template_ref,
       encode(digest(t.body, 'sha256'), 'hex'), 'approved',
       t.event_code IN ('saas.invoice_overdue', 'saas.grace_started', 'saas.trial_ending'),
       now(),
       'Seeded with 0149 alongside the seven SaaS billing notification events: platform-authored billing correspondence in en/hi/gu, approved on insert. The three notices that precede a loss of service require a second person to reword.'
  FROM notification_templates t
 WHERE t.event_code LIKE 'saas.%' AND t.tenant_id IS NULL
ON CONFLICT (template_id, version_no) DO NOTHING;

UPDATE notification_templates t
   SET serving_version_id = v.id
  FROM notification_template_versions v
 WHERE v.template_id = t.id AND v.version_no = 1
   AND t.event_code LIKE 'saas.%' AND t.tenant_id IS NULL AND t.serving_version_id IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 149.6  THE CURRENCY FOREIGN KEY 0002 OMITTED
-- ---------------------------------------------------------------------------------------------
-- `saas_invoices.currency_code` is `char(3) NOT NULL` with NO REFERENCE to `currencies`. 0035's
-- `billing_adjustments` has the reference; the invoice table — the statutory document — never did. So the
-- platform can hold a SaaS invoice in a currency it knows nothing about: it cannot format the amount (no
-- `minor_units`), it cannot convert it (no fx row), and until this wave nothing ever tried, which is why the
-- omission survived 147 migrations.
--
-- `BillingNoticeService` refuses to send a notice whose amount it cannot divide exactly, so the failure mode
-- today is a silent non-notice rather than a wrong figure. This closes it at the source instead. Added
-- VALIDATED rather than NOT VALID on purpose: if a deployment holds an invoice in an unknown currency, this
-- migration must FAIL LOUDLY and name it, because that row is a document somebody may be asked to pay.
ALTER TABLE saas_invoices
  ADD CONSTRAINT fk_saas_invoices_currency FOREIGN KEY (currency_code) REFERENCES currencies(code);

-- ---------------------------------------------------------------------------------------------
-- 149.7  THE INDEX THE RECIPIENT RESOLVER NEEDS
-- ---------------------------------------------------------------------------------------------
-- `role_permissions` is keyed (role_id, permission_code), so "which roles carry `tenant.settings`" — the
-- leading question of the recipient resolver, run once per billing event — has no index and scans the table.
-- It is a small table today and this is cheap insurance rather than a rescue: it becomes hot the moment a
-- reverse permission lookup is used anywhere else, and `role_permissions` grows with every tenant's custom
-- roles across every country the platform enters.
--
-- **AND THE HONEST STATEMENT OF WHAT THE PROBE SHOWED**: at 195 rows the planner picks a SEQ SCAN over
-- `idx_role_permissions_code` and it is right to — the whole table is a couple of pages. Forcing the plan
-- (`SET enable_seqscan = off`) confirms the index is USABLE for this predicate, which is all that can be
-- claimed today. 0148 proved both of ITS partial indexes chosen by EXPLAIN and said so; this one is not, and
-- saying "proven in use" here would be the shape of claim this programme keeps finding in other people's
-- headers. It is insurance against the row count, not a fix for it.
CREATE INDEX IF NOT EXISTS idx_role_permissions_code ON role_permissions(permission_code);

-- The same question for the per-staff overrides, which the resolver reads twice (grants, then denies). This
-- one IS chosen by the planner at current size (Bitmap Index Scan on idx_spo_code), because the overrides
-- table is wider and the predicate far more selective.
CREATE INDEX IF NOT EXISTS idx_spo_code ON staff_permission_overrides(permission_code);

-- ---------------------------------------------------------------------------------------------
-- 149.8  THE GRANTS — AND WHY THEY ARE WRITTEN OUT RATHER THAN ASSUMED
-- ---------------------------------------------------------------------------------------------
-- 0146 DEFECT 8 IS THE STANDING LESSON HERE: `kv_relay` had ZERO privileges on `saas_invoice_payments`, the
-- table its own handler consumes into, because 0079's audit was done by grep and the grep was wrong. So this
-- block does not assume, and 0149's live probes execute the resolver AS BOTH ROLES rather than reading a
-- catalogue.
--
-- WHO READS WHAT:
--   • `kv_app` runs the recipient resolver at EMIT time, inside the tenant's own request/uow transaction
--     (SaasInvoiceService.flush, SubscriptionService.flush) — so it needs SELECT on user_tenant_roles,
--     role_permissions, staff_permission_overrides, tenant_member_suspensions and currencies.
--   • `kv_relay` runs it in the two cadence jobs (trial expiry, usage alerts), which are cross-tenant on the
--     runner's BYPASSRLS pool, AND runs the fanout itself, which now reads `users` for the address check
--     (defect 8).
-- SELECT ONLY, both roles. Nothing here writes to an identity table, and a notice plane that could is a
-- privilege escalation wearing a helpful face.
GRANT SELECT ON user_tenant_roles, role_permissions, staff_permission_overrides, tenant_member_suspensions, currencies TO kv_app, kv_relay;
GRANT SELECT ON permissions TO kv_app, kv_relay;

-- ---------------------------------------------------------------------------------------------
-- DEFECT 10 — AND THE GRANT ABOVE WAS A LIE UNTIL THIS BLOCK. **CAUGHT BY THE LIVE PROBE.**
-- ---------------------------------------------------------------------------------------------
-- The probe for this wave executes the recipient resolver AS kv_app and then tries to WRITE the tables it
-- read. `INSERT INTO role_permissions` SUCCEEDED. The tenant request role could grant any role any
-- permission on the platform — `tenant.settings`, `wallet.adjust`, `plan.manage`, anything — which is a
-- privilege-escalation path from the request tier straight through RBAC, and RLS cannot stop it because
-- `role_permissions` is platform master data with no tenant column and no policy.
--
-- **THIS IS 0147 DEFECT 5 HAPPENING AGAIN, AND THAT IS THE POINT OF WRITING IT OUT.** 0147 found that
-- 0018's `ALTER DEFAULT PRIVILEGES` makes every table readable/writable by roles no GRANT ever names, so a
-- least-privilege claim in a migration header is false until an explicit REVOKE makes it true. That finding
-- was recorded with a named follow-up ("the post-0018 default-privilege audit over ~130 tables") and this is
-- the second wave to trip over the same paving stone from a different direction — this time on the RBAC
-- tables themselves, which is the worst possible place for it.
--
-- REVOKED HERE, PRECISELY. Verified first that no production code in apps/ writes these three tables:
-- `role_permissions`, `permissions` and `currencies` are platform master data seeded by migrations, and the
-- only matches in apps/ are specs asserting on migration TEXT. `staff_permission_overrides` is deliberately
-- NOT in this list — identity's `RoleRepository.setOverride` writes it from the tenant realm, and that is the
-- per-person grant path 0142 pointed an FPO's finance clerk at. `users` and `user_tenant_roles` are likewise
-- written by the tenant realm (registration, roster) and are untouched.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON role_permissions, permissions, currencies FROM kv_app, kv_relay;
-- The relay reads; it never authors identity or master data.
--
-- **AND `users` IS IN THIS LIST BECAUSE THE PROBE CAUGHT IT TOO — the third instance of 0018's default
-- privileges in one wave.** `GRANT SELECT ON users TO kv_relay` above does not REDUCE anything: the relay
-- already had UPDATE by default privilege, and the probe rewrote `users.email` as kv_relay successfully. That
-- is the worst version of this defect in this file, because the relay is BYPASSRLS and sees every tenant: a
-- relay connection that can rewrite a contact address can redirect any notification on the platform — an OTP,
-- a payout confirmation — to an address of its choosing. The notice plane needs two columns of this table for
-- a read; it must not be able to change them.
--
-- kv_app KEEPS its write on `users`, deliberately and correctly: the tenant realm owns profile edits and a
-- person changing their own email is what the column is for (`UserRepository.updateProfile`). Verified that no
-- outbox handler and no scheduled job writes `users` — the only writer in apps/ is `UserRepository`, driven
-- from request-path services on the kv_app connection.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users, user_tenant_roles, staff_permission_overrides, tenant_member_suspensions FROM kv_relay;
-- The address check (defect 8) reads two columns of `users` on the relay connection. Column-level grants are
-- not used anywhere else in this schema and would be a novel pattern to maintain for one query; the relay is
-- already BYPASSRLS and reads every tenant's outbox, so table SELECT is not a new capability — it is the same
-- trust boundary the relay already sits on.
GRANT SELECT ON users TO kv_relay;

-- ---------------------------------------------------------------------------------------------
-- 149.9  THE FLAG (Law 10) — and it gates the RECIPIENT, not the send
-- ---------------------------------------------------------------------------------------------
-- ONE flag, per-tenant, default OFF. It is checked by `BillingNoticeService.enrich` at EMIT time, which means
-- OFF does not mean "configured not to send": it means the outbox row carries NO `recipientUserIds` KEY AT
-- ALL, so `DomainEventFanoutHandler`'s own documented rule — "nothing to notify (fail-closed: never invent a
-- recipient)" — is the kill switch. The notice plane is provably inert for that tenant rather than merely
-- instructed to be quiet. A behavioural test asserts it (`tenant4d5-billing-notices.spec.ts`, "FLAG OFF means
-- no recipient KEY AT ALL"), including that the recipient reader is never even consulted — a claim SQL cannot
-- make, so it is not claimed here as a probe.
--
-- The map rows are registered at module init and cannot be unregistered per tenant, so gating anywhere else
-- would have meant a communication-module change for every emitting module — the shape that produces a second
-- notification mechanism within two waves.
--
-- A FLAG FLIP IS NOT RETROACTIVE, which is a property and not an oversight: an event emitted while the flag
-- was off carries no recipient for ever. Turning it on must not deliver a month of back-dated overdue notices
-- to an FPO all at once.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'saas_billing_notifications',
       'PC-56 TENANT-4d-5: tell a tenant about its own billing. Fans the seven tenancy billing events (invoice issued/paid/overdue, grace started, subscription renewed, trial ending, usage limit alert) out to the holders of tenant.settings through the notification spine, in en/hi/gu. OFF means the emitted event carries no recipient at all, so the fanout finds nobody and nothing is sent - which is exactly where every wave before this one left the platform.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'saas_billing_notifications');
