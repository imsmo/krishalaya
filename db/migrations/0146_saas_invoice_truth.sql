-- =============================================================================================
-- 0146_saas_invoice_truth.sql · PC-56 TENANT-4d-2 — THE BILLING SCREEN AND THE MONEY IT CLAIMS
-- =============================================================================================
-- W120 (Billing) states, as fact: "Open balance ₹7,954 on INV-2026-07-0841 · Growth → Professional
-- upgrade proration (incl. GST) · due 20 Jul"; "Payment method · UPI autopay · ok••••@okhdfcbank ·
-- mandate active · next debit 01 Aug"; "2026 paid to date ₹74,333 · 7 invoices, all on time"; tabs
-- "All 8 / Issued 1 / Paid 7 / Overdue 0"; "GSTIN 24AAB••••••1Z5 on every invoice"; and the footnote
-- "If a renewal payment fails, service enters a grace period — nothing switches off for 7 days while
-- we retry and notify you". W2428-W2430 add "Pay open invoice" and its Retry.
--
-- Nine of those are claims about stored facts. This migration exists because four of them had nowhere
-- to be stored, and one of them was being computed from the wrong number.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): TWO MECHANISMS RECORD THE SAME PAYMENT, AND ONLY ONE OF THEM COUNTS
-- ---------------------------------------------------------------------------------------------
-- 0092 made a SaaS invoice's balance KNOWN: `saas_invoice_payments` is the append-only record of money
-- arriving, and `saas_invoices.paid_minor` is the SUM of its live rows, re-summed in the same tx, with
-- the invoice's status DERIVED from that sum (0092's own words: "THE INVOICE'S STATUS IS DERIVED,
-- NEVER TYPED"). apps/admin-api's billing-ops plane does exactly that.
--
-- The tenant realm does not. `SaasInvoicePaymentHandler` consumes payments.payment_succeeded and calls
-- `SaasInvoice.recordPayment(amountMinor, at)`, which compares THAT ONE PAYMENT against the invoice
-- total and types a status:
--
--     const to = amountMinor >= this.p.totalMinor ? 'paid' : 'partially_paid';
--
-- It writes no payment row and it never touches `paid_minor`. So for every SaaS invoice a tenant pays
-- THROUGH THE PLATFORM — the only invoices whose payment we actually witness — three things are true
-- at once:
--   (a) the invoice says 'paid' while `paid_minor` still says 0, so the operator's collection queue
--       shows the full amount outstanding on an invoice that is settled, and W120's own open balance
--       (total − paid) would be the whole invoice;
--   (b) two half payments never settle it: the first moves issued → partially_paid, and the second
--       compares 50% against 100%, computes 'partially_paid' again, finds it is already there and
--       returns false. The invoice is fully paid and stays partially_paid FOR EVER, with no row
--       anywhere recording that the second half arrived;
--   (c) the receipt is not in `saas_invoice_payments`, so it has no reference an auditor can match to
--       a bank statement — for the payments that have the best reference of all, a gateway id.
-- The append-only table and the derived-status rule were built, and the one consumer that sees real
-- money arriving was wired around them.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: THE EVENT CARRIES A VERDICT AND NOT THE EVIDENCE
-- ---------------------------------------------------------------------------------------------
-- The reason (a)-(c) were even possible: payments.payment_succeeded's payload is
-- `{paymentId, amountMinor, referenceType, referenceId}`. A consumer that wants to RECORD the payment
-- needs who paid (`saas_invoice_payments.recorded_by` is NOT NULL), by what instrument, in what
-- currency, with what gateway reference, and when. None of it was in the envelope, so the only thing a
-- consumer could do with the event was assert an outcome. The payload is widened additively in this
-- wave (existing consumers read the same four keys); no schema change is needed for that, but it is
-- recorded here because it is the cause and not a detail.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: THE RENEWAL RUN'S IDEMPOTENCY IS A `LIKE` ON A DOCUMENT NUMBER
-- ---------------------------------------------------------------------------------------------
--     SELECT 1 FROM saas_invoices WHERE tenant_id=$1 AND subscription_id=$2
--       AND invoice_no LIKE '%'||$3||'%' LIMIT 1
-- That is the only thing standing between the renewal run and double-billing a tenant, and it is not a
-- constraint — it is a read. Two ticks that overlap (a retry, two workers, a leader hand-over) both
-- pass it and both insert; `next_doc_number` serialises them on the series row and hands out two
-- numbers rather than refusing the second invoice. It is also unindexable: a leading-wildcard LIKE
-- over a tenant's whole invoice history, run once per subscription per tick, which at a million
-- subscriptions is a scan per renewal.
-- The period a renewal invoice covers is a FACT ABOUT THE INVOICE and belongs in a column with a
-- unique index over it. §146.1.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: EVERY RENEWAL INVOICE IS ISSUED TAX-FREE, AND THE RATE IS NOT KEPT
-- ---------------------------------------------------------------------------------------------
-- `RenewalInvoicesJob` calls `raiseRenewal({ ..., taxMinor: 0n, ... })`. TENANT-1d-2 built
-- `read-models/billing-tax-rate.ts` precisely so no invoice would carry a guessed rate, and
-- `PlanChangeService` reads it — so an UPGRADE invoice carries GST and a RENEWAL invoice does not.
-- W120's open invoice says "(incl. GST)". Half the invoices this platform raises would not.
-- And the rate itself was nowhere on the invoice: `billing.tax_bp` is a mutable platform setting, so
-- an invoice's own tax line could not be explained a year later, and changing the setting silently
-- re-characterised every historical invoice. A tax rate is a filing artifact. §146.2.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 5: "GSTIN 24AAB••••••1Z5 ON EVERY INVOICE" IS ON NO INVOICE
-- ---------------------------------------------------------------------------------------------
-- `tenants.gstin` (0002) holds the tenant's GSTIN and `PATCH /v1/tenants/me` can change it. Nothing is
-- copied onto the invoice. So the GSTIN "on" an invoice raised in April is whatever the row says
-- today: correct a typo and eight historical invoices silently re-address themselves, which is the
-- statutory-truth defect 0140 spent a whole migration on for trade invoices. The billed identity is
-- snapshotted at issue. §146.3.
--
-- ---------------------------------------------------------------------------------------------
-- NAMED, NOT FIXED HERE (each is a GAP-BACKEND the console now states instead of drawing)
-- ---------------------------------------------------------------------------------------------
--   • THE GRACE PERIOD IS A SENTENCE, NOT A STATE. `subscription_status` has had `past_due` since
--     0002; `isLive` selects it, `plan-usage.ts` grants it quota, `plan-compare` reads it — and
--     NOTHING IN THE MONOREPO EVER WRITES IT. There is no grace window, no retry loop and no notify.
--     The job named `grace-period.job.ts` does the opposite of its name: it moves live → EXPIRED the
--     moment `current_period_end` passes. W120's "nothing switches off for 7 days" describes a
--     mechanism that does not exist, and the mechanism that does exist switches things off on day
--     zero. Building it needs a state writer, a dunning cadence and a notification — TENANT-4d-3.
--   • THE WHOLE SAAS BILLING CADENCE IS UNSCHEDULED. `apps/worker/src/registry.ts` contains none of
--     `RenewalInvoicesJob`, `GracePeriodJob`, `TrialExpiryJob`, `UsageLimitAlertsJob`, though each
--     job's own header says "apps/worker instantiates it". So today no renewal invoice is ever
--     raised, no invoice is ever marked overdue (W120's Overdue tab cannot become non-empty), no
--     trial ever converts and no usage alert is ever sent. This wave deliberately does NOT wire them:
--     scheduling the sweep before the grace state exists would take a latent defect and start
--     expiring live tenants' subscriptions on the day their period ends. Wiring lands WITH the grace
--     state in TENANT-4d-3, together.
--   • "UPI AUTOPAY · MANDATE ACTIVE · NEXT DEBIT 01 AUG" HAS NO SUBJECT. The autopay plane
--     (`payments/{autopay.controller,mandate.entity,mandate-execution.service}`) has no notion of a
--     subscription or a SaaS invoice — grep finds neither word in it. There is no SaaS mandate to be
--     active and nothing schedules a debit. The console says so rather than drawing a masked handle.
--   • THE PLATFORM'S OWN GSTIN IS NOT STORED ANYWHERE. §146.3 snapshots the BILLED party's GSTIN
--     (the tenant's, which is what W120 prints). A compliant tax invoice also carries the SUPPLIER's,
--     and Krishalaya's own registration is not a row in this database. Founder decision (which legal
--     entity, per country) before a column can honestly exist.
--   • 0079's SWEEP MAY HAVE MADE THE SAME MISTAKE ELSEWHERE. Its STEP 1 revoked kv_relay's access to
--     twelve tables on one grep. §146.6 proves the grep was wrong for `saas_invoices`; the other eleven
--     (`loans`, `loan_applications`, `bnpl_limits`, `trade_invoices`, `freight_invoices`,
--     `freight_invoice_lines`, `saas_invoice_dunning_attempts`, `milk_bills`, `contract_input_advances`,
--     `upi_mandates`, `worker_insurance_enrolments`) have NOT been re-checked here, because each needs its
--     own consumer audit and a wrong re-grant is worse than a missing one. Named as a sweep of its own.
--   • THE DERIVED-STATUS ARITHMETIC NOW EXISTS TWICE: `apps/admin-api/.../domain/invoice-payment.ts`
--     and `apps/api/.../tenancy/domain/saas-invoice-balance.ts`. Six lines of bigint arithmetic, the
--     same three thresholds, pinned by a spec on each side. Unifying them needs a shared pure package
--     both apps depend on (`apps/api` has no `@krishalaya/contracts` dependency today, and adding one
--     touches a package.json the founder has work in flight on). Named so it is a decision, not a
--     drift.
--
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- Money is bigint MINOR UNITS everywhere (Law 2). `saas_invoices` and `saas_invoice_payments` are both
-- tenant-scoped and already carry RLS from the 0092 sweep — no policy work is needed here, and this
-- file adds no table.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 146.1  THE PERIOD A RENEWAL INVOICE COVERS, AS A COLUMN WITH A CONSTRAINT OVER IT
-- ---------------------------------------------------------------------------------------------
-- Nullable because it is meaningful only for a SUBSCRIPTION invoice: an upgrade-proration invoice
-- (TENANT-1d-2) covers a change, not a period, and a NULL here says that rather than inventing a tag.
ALTER TABLE saas_invoices ADD COLUMN period_tag varchar(10);

COMMENT ON COLUMN saas_invoices.period_tag IS
  'PC-56 TENANT-4d-2: the billing period this invoice covers, as YYYYMM. NULL means the invoice is not a periodic renewal (e.g. an upgrade proration) — never "unknown period". Together with uq_saas_invoice_subscription_period this replaces the renewal run''s `invoice_no LIKE ''%''||period||''%''` read, which could not stop two overlapping ticks from double-billing one subscription.';

-- Backfill ONLY where the document number provably carries the period (next_doc_number renders
-- `PREFIX-<period>-<seq>`, and the renewal run passed YYYYMM as that period). Anything else is left
-- NULL: a guessed period on a historical invoice would be a fact this migration invented.
UPDATE saas_invoices
   SET period_tag = split_part(invoice_no, '-', 2)
 WHERE subscription_id IS NOT NULL
   AND period_tag IS NULL
   AND split_part(invoice_no, '-', 2) ~ '^\d{6}$';

-- THE CONSTRAINT DEFECT 3 ASKED FOR. Partial, so it costs nothing for proration invoices and cannot
-- be defeated by a NULL: a row with no period_tag is simply not in the index, and the renewal run only
-- ever inserts rows that have one (asserted in the service, not hoped for).
-- Deliberately NOT `CONCURRENTLY`: the runner wraps this file in one transaction, and a table this
-- small does not need it. A future backfill of a large tenant would use a separate concurrent build.
CREATE UNIQUE INDEX uq_saas_invoice_subscription_period
  ON saas_invoices (tenant_id, subscription_id, period_tag)
  WHERE deleted_at IS NULL AND subscription_id IS NOT NULL AND period_tag IS NOT NULL;

COMMENT ON INDEX uq_saas_invoice_subscription_period IS
  'PC-56 TENANT-4d-2: one renewal invoice per subscription per billing period, enforced by the database rather than by a read-then-write. tenant_id leads so the index prunes per tenant at platform scale.';

-- ---------------------------------------------------------------------------------------------
-- 146.2  THE TAX RATE THE INVOICE WAS RAISED AT, KEPT ON THE INVOICE
-- ---------------------------------------------------------------------------------------------
-- Basis points, matching `billing.tax_bp` (0126) and `domain/proration.ts`. 0 is a real rate (a
-- zero-rated jurisdiction) and must be distinguishable from "we did not record one", so the column is
-- nullable and NULL means exactly that — historical rows, which we will not backdate a rate onto.
ALTER TABLE saas_invoices ADD COLUMN tax_bp smallint;
ALTER TABLE saas_invoices ADD CONSTRAINT ck_saas_invoice_tax_bp
  CHECK (tax_bp IS NULL OR (tax_bp >= 0 AND tax_bp <= 10000));

COMMENT ON COLUMN saas_invoices.tax_bp IS
  'PC-56 TENANT-4d-2: the tax rate in BASIS POINTS actually applied when this invoice was raised, resolved once from `billing.tax_bp` and then frozen. The setting is mutable and global; an invoice is a filing artifact, so it carries its own rate. NULL = no rate was recorded (every invoice raised before this wave, and any invoice raised while the setting was unreadable — which the service refuses to do). 0 is a legitimate zero-rated invoice and is NOT the same as NULL.';

-- ---------------------------------------------------------------------------------------------
-- 146.3  WHO THE INVOICE WAS BILLED TO, AS AT ISSUE
-- ---------------------------------------------------------------------------------------------
-- W120: "GSTIN 24AAB••••••1Z5 on every invoice". The console masks for display; the column holds the
-- value in full, because a tax invoice carries the registration in full and a mask cannot be filed.
-- (Distinct from 0058's `business_kyc_profiles.gstin_masked`, which is a BUYER's identity captured for
-- KYC and is masked by design — see 0140 defect 6. This is the tenant's own registration, given to us
-- by the tenant, printed on our invoice to them.)
ALTER TABLE saas_invoices ADD COLUMN bill_to_gstin      varchar(20);
ALTER TABLE saas_invoices ADD COLUMN bill_to_legal_name varchar(250);

COMMENT ON COLUMN saas_invoices.bill_to_gstin IS
  'PC-56 TENANT-4d-2: the billed tenant''s GSTIN as it stood WHEN THIS INVOICE WAS ISSUED, copied from tenants.gstin at that moment. Before this column the GSTIN "on" an invoice was read live, so correcting a typo in the tenant profile silently re-addressed every historical invoice. NULL = not recorded (pre-wave rows, or a tenant with no GSTIN — which is a real state, not an error).';
COMMENT ON COLUMN saas_invoices.bill_to_legal_name IS
  'PC-56 TENANT-4d-2: the billed tenant''s legal name as at issue, snapshotted for the same reason as bill_to_gstin. A rename must not rewrite the party on a document already sent.';

-- ---------------------------------------------------------------------------------------------
-- 146.4  A GATEWAY RECEIPT IS A RECEIPT WHOSE INSTRUMENT WE MAY NOT KNOW
-- ---------------------------------------------------------------------------------------------
-- 0092's `method` CHECK is the list an OPERATOR keys in: bank_transfer|upi|cheque|card|netbanking|
-- wallet|cash|offset. A capture relayed from the gateway reports `payments.method`, which is
-- upi|card|netbanking|cod and MAY BE NULL — the PSP does not always tell us. Two of those values have
-- nowhere to go, and guessing 'upi' because UPI is common would put a fact on an auditable row that
-- nobody observed. So the vocabulary gains one honest value.
ALTER TABLE saas_invoice_payments DROP CONSTRAINT saas_invoice_payments_method_check;
ALTER TABLE saas_invoice_payments ADD CONSTRAINT saas_invoice_payments_method_check
  CHECK (method IN ('bank_transfer','upi','cheque','card','netbanking','wallet','cash','offset','cod','gateway'));

COMMENT ON COLUMN saas_invoice_payments.method IS
  'PC-56 TENANT-4d-2: how the money arrived. The operator-keyed values are 0092''s. `cod` and `gateway` were added for platform-captured payments: `gateway` means the capture is real and the PSP did not report an instrument, which is different from asserting UPI. Never guessed.';

-- ---------------------------------------------------------------------------------------------
-- 146.5  THE INDEX W120's OWN PAGING NEEDS
-- ---------------------------------------------------------------------------------------------
-- The console pages invoices newest-first on the keyset (created_at, id) — the roster rule; 0002's
-- only index is (tenant_id, status), which serves the tab counts and not the page.
CREATE INDEX idx_saas_inv_tenant_created
  ON saas_invoices (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_saas_inv_tenant_created IS
  'PC-56 TENANT-4d-2: serves W120''s keyset page over a tenant''s invoices. Keyset, never OFFSET — a tenant with ten years of monthly invoices pages in constant time.';

-- ---------------------------------------------------------------------------------------------
-- 146.6  DEFECT 8 — THE CONSUMER HAS NO PRIVILEGES ON THE TABLE IT CONSUMES INTO
-- ---------------------------------------------------------------------------------------------
-- Found by probing GRANTS on a real Postgres after applying the rest of this file. Nothing in
-- TypeScript can see it, and no unit test can: the write is syntactically perfect and the role cannot
-- perform it.
--
-- `SaasInvoicePaymentHandler` consumes payments.payment_succeeded INSIDE the outbox relay's transaction,
-- and that transaction runs on the **kv_relay** connection (core/outbox/outbox.dispatcher.ts: "Runs on a
-- privileged connection (kv_relay, BYPASSRLS — see migration 0018)"). Migration 0079 STEP 1 revoked all of
-- kv_relay's privileges on `saas_invoices`, on the explicit stated basis:
--
--     "kv_relay loses everything (zero code reference, grep-confirmed)"
--
-- The code reference exists. So the moment a tenant pays a SaaS invoice through the gateway, the money
-- arrives, the capture is relayed, and `getForUpdate` fails with "permission denied for table
-- saas_invoices" — the relay marks the event failed, the invoice stays `issued` for ever, and the only
-- trace is a log line. Every SaaS invoice a tenant has ever paid through the platform is in that state.
-- 0079's sweep was right in method and wrong in one fact; this restores exactly the two privileges the
-- handler needs and not one more.
--
-- And `saas_invoice_payments` (0092) granted INSERT only to kv_admin, because at the time only the
-- admin-api billing-ops plane recorded receipts. The relay records them now, so it needs INSERT there too.
--
-- LEAST PRIVILEGE, TABLE BY TABLE, CODE-VERIFIED — 0079's own discipline:
--   • saas_invoices        → kv_relay: SELECT (findOwingPastDue, getForUpdate) + UPDATE (status/paid_at/
--                            paid_minor). NOT INSERT: invoices are raised through the unit of work, which
--                            runs as kv_app. NOT DELETE, ever.
--   • saas_invoice_payments → kv_relay: SELECT (the re-SUM subquery) + INSERT (the receipt). NOT UPDATE and
--                            NOT DELETE: the table is APPEND-ONLY by design (0092), and a reversal is a new
--                            negative row, not an edit. kv_app stays SELECT-only — it never records a
--                            receipt; only the relay and the admin plane do.
GRANT SELECT, UPDATE ON saas_invoices          TO kv_relay;
GRANT SELECT, INSERT ON saas_invoice_payments  TO kv_relay;

COMMENT ON TABLE saas_invoice_payments IS
  'PC-56 TENANT-4d-2: APPEND-ONLY record of money received against a SaaS invoice (0092). Written by the admin billing-ops plane (kv_admin) AND by the outbox relay (kv_relay) when a tenant pays through the gateway. Neither role has UPDATE or DELETE: a mistaken receipt is corrected by a negative `reverses_payment_id` row, never by an edit, because the history of what we believed and when we corrected it is exactly what a tenant disputing a balance needs to see.';

-- ---------------------------------------------------------------------------------------------
-- 146.7  THE FLAGS (Law 10) — both default OFF
-- ---------------------------------------------------------------------------------------------
-- The console: with this ON, a tenant_admin can read its own SaaS invoices (W120). There is no such
-- surface today — `SaasInvoiceService.list/getById` have existed, permission-gated, with NO ROUTE
-- anywhere in apps/api, so a tenant has never been able to see a bill we raised to it.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'saas_billing_console',
       'PC-56 TENANT-4d-2: expose W120 — the tenant''s own SaaS invoices, open balance, paid-to-date and tab counts (GET /v1/billing/*). OFF is the behaviour before this wave, in which the read service existed with no route and no screen.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'saas_billing_console');

-- The pay button: with this ON, W2428's "Pay open invoice" opens a real gateway intent for exactly the
-- outstanding amount, server-resolved. OFF states that collection is operator-side, which is true
-- today. Kept separate from the console flag on purpose: reading a bill and paying it are different
-- risks, and a tenant should be able to have the first without the second.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'saas_invoice_self_pay',
       'PC-56 TENANT-4d-2: let a tenant pay its own open SaaS invoice through the gateway (W2428-W2430). The amount is resolved SERVER-SIDE from total_minor − paid_minor and a mismatched client amount is refused; OFF leaves collection with billing-ops.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'saas_invoice_self_pay');
