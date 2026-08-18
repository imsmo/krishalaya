// PC-56 TENANT-4d-2 · W120 (Billing) + W2428-W2430 (pay an open invoice).
// Pure rules, the repository's tenant funnel, and the promises 0146 makes — each pinned against the SOURCE with
// comments stripped, so a promise living in a comment cannot pass a test.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  INVOICE_TABS, InvoiceFigures, acceptsPayment, gstinLine, isPastDue, maskGstin, openBalance,
  outstandingMinor, overpaidMinor, paidToDate, payVerdict, statusFromPaid, statusesForTab, taxLine, timeliness,
} from '../domain/saas-invoice-balance';
// PC-56 TENANT-4d-4 moved the four mechanism verdicts here and made them DERIVED from what is switched on.
import { mechanismLines } from '../domain/billing-grace';
import { MIN_RECEIPT_REFERENCE, SaasInvoiceService, mapReceiptMethod, receiptReference } from '../services/saas-invoice.service';
import { taxOn } from '../domain/proration';
import { SaasInvoice } from '../domain/saas-invoice.entity';
import { InvalidSaasInvoiceError } from '../domain/tenancy.errors';
import { DOC_SERIES_PERIOD_MAX, SaasInvoiceRepository } from '../repositories/saas-invoice.repository';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const migration = () => fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0146_saas_invoice_truth.sql'), 'utf8');
const sqlOnly = () => migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const fig = (over: Partial<InvoiceFigures> = {}): InvoiceFigures => ({
  status: 'issued', totalMinor: 795400n, paidMinor: 0n, dueDate: '2026-07-20', paidAt: null, currencyCode: 'INR', ...over,
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the status follows the SUM of the receipts, never one payment', () => {
  it('the arithmetic: outstanding floors at zero, and an overpayment is KEPT rather than clamped', () => {
    expect(outstandingMinor(100n, 40n)).toBe(60n);
    expect(outstandingMinor(100n, 100n)).toBe(0n);
    expect(outstandingMinor(100n, 140n)).toBe(0n);      // never negative — it would sum into a receivables total
    expect(overpaidMinor(100n, 140n)).toBe(40n);
    expect(overpaidMinor(100n, 100n)).toBe(0n);
    expect(overpaidMinor(100n, 40n)).toBe(0n);
  });

  it('TWO HALVES SETTLE THE INVOICE — the defect this wave fixed, as a rule', () => {
    // The old rule compared ONE payment against the total. 50 of 100, then another 50: the second call computed
    // 'partially_paid', saw it was already there and reported no change, so the invoice stayed part-paid for ever.
    expect(statusFromPaid('issued', 100n, 50n, false)).toBe('partially_paid');
    expect(statusFromPaid('partially_paid', 100n, 100n, false)).toBe('paid');
  });

  it('every branch: settled, part-paid, fully reversed, already-there, and void is never moved by arithmetic', () => {
    expect(statusFromPaid('issued', 100n, 100n, false)).toBe('paid');
    expect(statusFromPaid('issued', 100n, 120n, false)).toBe('paid');       // overpaid still settles
    expect(statusFromPaid('paid', 100n, 100n, false)).toBeNull();            // no change
    expect(statusFromPaid('partially_paid', 100n, 50n, false)).toBeNull();   // another partial, same status
    // Everything reversed: the invoice must stop claiming money we no longer believe arrived.
    expect(statusFromPaid('partially_paid', 100n, 0n, false)).toBe('issued');
    expect(statusFromPaid('partially_paid', 100n, 0n, true)).toBe('overdue');
    expect(statusFromPaid('overdue', 100n, 0n, true)).toBeNull();
    // A voided invoice is a document we withdrew. Money against it is a refund conversation, not a status move.
    expect(statusFromPaid('void', 100n, 100n, false)).toBeNull();
    expect(statusFromPaid('void', 100n, 0n, true)).toBeNull();
  });

  it('a receipt may be recorded against a paid invoice (that is how an overpayment stays visible), never against a draft or a void', () => {
    expect(acceptsPayment('issued')).toBe(true);
    expect(acceptsPayment('partially_paid')).toBe(true);
    expect(acceptsPayment('overdue')).toBe(true);
    expect(acceptsPayment('paid')).toBe(true);
    expect(acceptsPayment('draft')).toBe(false);
    expect(acceptsPayment('void')).toBe(false);
  });

  it('past-due is decided on the DATE, so it does not flip with the reader\'s timezone', () => {
    expect(isPastDue('2026-07-20', new Date('2026-07-21T00:00:00Z'))).toBe(true);
    expect(isPastDue('2026-07-20', new Date('2026-07-20T23:59:59Z'))).toBe(false);   // due today is not overdue
    expect(isPastDue('2026-07-20', new Date('2026-07-19T00:00:00Z'))).toBe(false);
  });

  it('the gateway method vocabulary maps known instruments and NEVER guesses one', () => {
    expect(mapReceiptMethod('upi')).toBe('upi');
    expect(mapReceiptMethod('CARD')).toBe('card');
    expect(mapReceiptMethod('cod')).toBe('cod');
    // The PSP told us nothing. 'gateway' says the capture is real and the instrument is unknown — which is a
    // different statement from "paid by UPI", and the one an auditor can act on.
    expect(mapReceiptMethod(null)).toBe('gateway');
    expect(mapReceiptMethod('')).toBe('gateway');
    expect(mapReceiptMethod('wibble')).toBe('gateway');
    expect(mapReceiptMethod(null)).not.toBe('upi');
  });

  /**
   * Found by a live probe: 0092 enforces `length(btrim(reference)) >= 3` in the DATABASE, and
   * `PaymentService.handleWebhook` calls `markCaptured(event.gatewayPaymentId ?? '', ...)` — so a provider that
   * reports no payment id would fail that CHECK inside the relay's transaction. Money arrived, nothing
   * recorded, event marked failed. The reference falls back to our own uuid instead.
   */
  it('the receipt reference is always something reconcilable — never an empty or stub gateway id', () => {
    expect(receiptReference('pay_gw_ABC123', 'p-uuid')).toBe('pay_gw_ABC123');
    expect(receiptReference('', 'p-uuid')).toBe('p-uuid');
    expect(receiptReference(null, 'p-uuid')).toBe('p-uuid');
    expect(receiptReference('  ', 'p-uuid')).toBe('p-uuid');
    expect(receiptReference('ab', 'p-uuid')).toBe('p-uuid');       // 2 chars: the DB would refuse it
    expect(receiptReference('abc', 'p-uuid')).toBe('abc');
    expect(MIN_RECEIPT_REFERENCE).toBe(3);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · W120\'s open balance', () => {
  it('sums OUTSTANDING over owing invoices only, and terminal invoices contribute nothing', () => {
    const b = openBalance([
      fig({ totalMinor: 500n, paidMinor: 100n }),
      fig({ status: 'overdue', totalMinor: 300n, paidMinor: 0n }),
      fig({ status: 'paid', totalMinor: 999n, paidMinor: 999n }),
      fig({ status: 'void', totalMinor: 999n, paidMinor: 0n }),
    ]);
    expect('minor' in b && b.minor).toBe(700n);
    expect('invoiceCount' in b && b.invoiceCount).toBe(2);
  });

  it('REFUSES a single figure across currencies rather than inventing a rate (Law 2)', () => {
    const b = openBalance([fig({ currencyCode: 'INR' }), fig({ currencyCode: 'BDT' })]);
    expect(b.minor).toBeNull();
    expect('currencies' in b && b.currencies).toEqual(['BDT', 'INR']);
  });

  it('a tenant with nothing owing gets a zero and an empty currency, not a fabricated one', () => {
    const b = openBalance([fig({ status: 'paid', paidMinor: 795400n })]);
    expect('minor' in b && b.minor).toBe(0n);
    expect('currencyCode' in b && b.currencyCode).toBe('');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · "7 invoices, all on time" is EARNED', () => {
  const paid = (paidAt: string | null, dueDate = '2026-07-20') => fig({ status: 'paid', paidMinor: 100n, paidAt: paidAt ? new Date(paidAt) : null, dueDate });

  it('timeliness distinguishes on-time, late and UNKNOWN — and unknown is not a quiet "on time"', () => {
    expect(timeliness(paid('2026-07-18T00:00:00Z'))).toBe('on_time');
    expect(timeliness(paid('2026-07-20T23:00:00Z'))).toBe('on_time');    // the due DATE, not the instant
    expect(timeliness(paid('2026-07-21T00:00:00Z'))).toBe('late');
    expect(timeliness(paid(null))).toBe('unknown');
    expect(timeliness(fig({ status: 'issued' }))).toBe('unknown');
    expect(timeliness(paid(null))).not.toBe('on_time');
  });

  it('ONE invoice with no payment date withholds the claim — this is the whole point', () => {
    const all = paidToDate([paid('2026-07-01T00:00:00Z'), paid('2026-07-02T00:00:00Z')], 2026);
    expect(all.allOnTime).toBe(true);
    expect(all.invoiceCount).toBe(2);
    expect(all.minor).toBe(200n);

    const withUnknown = paidToDate([paid('2026-07-01T00:00:00Z'), paid(null)], 2026);
    expect(withUnknown.allOnTime).toBe(false);
    expect(withUnknown.unknown).toBe(1);
    expect(withUnknown.late).toBe(0);

    const withLate = paidToDate([paid('2026-07-01T00:00:00Z'), paid('2026-08-01T00:00:00Z')], 2026);
    expect(withLate.allOnTime).toBe(false);
    expect(withLate.late).toBe(1);
  });

  it('an empty year claims nothing at all (not "all on time" over zero invoices)', () => {
    const none = paidToDate([], 2026);
    expect(none.invoiceCount).toBe(0);
    expect(none.allOnTime).toBe(false);
    expect(none.year).toBe(2026);
  });

  it('counts the money RECEIVED, and reports other currencies separately instead of adding them', () => {
    const over = paidToDate([fig({ status: 'paid', totalMinor: 100n, paidMinor: 140n, paidAt: new Date('2026-07-01T00:00:00Z') })], 2026);
    expect(over.minor).toBe(140n);                              // what the tenant actually paid
    const mixed = paidToDate([
      fig({ status: 'paid', currencyCode: 'BDT', paidMinor: 10n, paidAt: new Date('2026-07-01T00:00:00Z') }),
      fig({ status: 'paid', currencyCode: 'INR', paidMinor: 90n, paidAt: new Date('2026-07-01T00:00:00Z') }),
    ], 2026);
    expect(mixed.currencyCode).toBe('BDT');
    expect(mixed.minor).toBe(10n);
    expect(mixed.mixedCurrencies).toEqual(['INR']);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the tabs, the tax line and the GSTIN', () => {
  it('W120\'s four tabs in order, with Issued covering part-paid and NO void tab', () => {
    expect([...INVOICE_TABS]).toEqual(['all', 'issued', 'paid', 'overdue']);
    expect(statusesForTab('all')).toBeNull();
    expect(statusesForTab('issued')).toEqual(['issued', 'partially_paid']);
    expect(statusesForTab('paid')).toEqual(['paid']);
    expect(statusesForTab('overdue')).toEqual(['overdue']);
    expect(INVOICE_TABS).not.toContain('void');
  });

  it('"RATE NOT RECORDED" IS NOT "0% GST"', () => {
    expect(taxLine(1800, 17982n)).toBe('stated');
    expect(taxLine(null, 0n)).toBe('not_recorded');
    expect(taxLine(0, 0n)).toBe('zero_rated');
    expect(taxLine(null, 0n)).not.toBe('zero_rated');
    // A zero rate carrying tax, or a rate with no tax, is incoherent and is never printed as either.
    expect(taxLine(0, 5n)).toBe('not_recorded');
  });

  it('the GSTIN is the invoice\'s SNAPSHOT, and a missing one says so rather than borrowing today\'s profile', () => {
    expect(gstinLine('24AABCU9603R1Z5')).toBe('snapshot');
    expect(gstinLine(null)).toBe('not_on_invoice');
    expect(maskGstin('24AABCU9603R1Z5')).toBe('24••••••••1Z5');
    expect(maskGstin(null)).toBeNull();
    // Too short to mask is WITHHELD rather than half-shown — a partial reveal of a registration is a leak.
    expect(maskGstin('24AB')).toBeNull();
  });

  it('a renewal and an upgrade round the same rate identically, because they share one function', () => {
    expect(taxOn(99900n, 1800)).toBe(17982n);
    expect(taxOn(0n, 1800)).toBe(0n);
    expect(taxOn(99900n, 0)).toBe(0n);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · paying an open invoice (W2428)', () => {
  it('the amount is the OUTSTANDING amount, and every refusal has its own reason', () => {
    const v = payVerdict(fig({ totalMinor: 795400n, paidMinor: 0n }), true);
    expect(v).toEqual({ kind: 'payable', amountMinor: 795400n, currencyCode: 'INR' });
    const part = payVerdict(fig({ status: 'partially_paid', totalMinor: 795400n, paidMinor: 300000n }), true);
    expect(part.kind === 'payable' && part.amountMinor).toBe(495400n);

    expect(payVerdict(fig({ status: 'paid', paidMinor: 795400n }), true)).toEqual({ kind: 'refused', reason: 'already_paid' });
    expect(payVerdict(fig({ status: 'void' }), true)).toEqual({ kind: 'refused', reason: 'voided' });
    expect(payVerdict(fig({ status: 'draft' }), true)).toEqual({ kind: 'refused', reason: 'not_yet_issued' });
    expect(payVerdict(fig({ paidMinor: 795400n }), true)).toEqual({ kind: 'refused', reason: 'nothing_outstanding' });
  });

  it('the FLAG is checked LAST, so an unpayable invoice reads as unpayable for its real reason', () => {
    // A tenant with the feature off still learns the true state of their bill.
    expect(payVerdict(fig({ status: 'paid', paidMinor: 795400n }), false)).toEqual({ kind: 'refused', reason: 'already_paid' });
    expect(payVerdict(fig(), false)).toEqual({ kind: 'refused', reason: 'self_pay_off' });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the four sentences W120 states about the MECHANISM', () => {
  /** PC-56 TENANT-4d-4 rewrote this: the verdicts are now DERIVED from what is switched on, so the screen
   *  cannot keep telling a tenant there is no grace period after a founder enables one. With both flags OFF —
   *  the shipped state — the answers are exactly what 4d-2 asserted. */
  it('WITH THE FLAGS OFF, NOT ONE OF THEM HAS A SUBJECT, and the code says so', () => {
    const m = mechanismLines({ graceEnabled: false, cadenceEnabled: false });
    expect(m.autopay).toBe('no_saas_mandate');        // the autopay plane has no notion of a subscription
    expect(m.nextDebit).toBe('no_saas_mandate');      // a scheduled INVOICE is not a scheduled debit
    expect(m.gracePeriod).toBe('no_grace_state');
    expect(m.retryAndNotify).toBe('no_notification'); // the five tenancy events have no notification row
    expect(Object.values(m)).not.toContain('exists');
  });

  /**
   * **THIS TEST DID ITS JOB.** 4d-2 wrote it as "`past_due` STILL has no writer — if this fails, a later wave
   * has landed and the verdict must change". TENANT-4d-4 landed and it failed. `past_due` now has exactly ONE
   * writer, and the assertion is inverted to pin that there is exactly one: a second producer of the grace
   * state would be two mechanisms over one window.
   */
  it('`past_due` NOW HAS A WRITER, and exactly one', () => {
    expect(read('domain', 'subscription.entity.ts')).toContain('enterGrace(graceUntilDate: string');
    expect(read('services', 'subscription.service.ts')).toContain('sub.enterGrace(until, now)');
    const writers = ['domain/subscription.entity.ts', 'services/subscription.service.ts', 'jobs/saas-billing-cycle.job.ts']
      .map((f) => read(...f.split('/')))
      .join('\n')
      .match(/status = 'past_due'/g) ?? [];
    expect(writers).toHaveLength(1);
  });

  it('the job named for the grace period is GONE, superseded rather than left as a second mechanism', () => {
    // It moved live → EXPIRED the moment a period ended, which with the un-rolling period was a platform-wide
    // kill switch. `saas-billing-cycle.job.ts` replaces it; leaving both would be two clocks over one cycle.
    expect(fs.existsSync(path.join(__dirname, '..', 'jobs', 'grace-period.job.ts'))).toBe(false);
    // Read RAW here, not through `read()`: this assertion is about the successor's HEADER recording why the
    // old job is gone, and `read()` strips comments on purpose everywhere else.
    const cycle = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'saas-billing-cycle.job.ts'), 'utf8');
    expect(cycle).toContain('superseded by phase 4 here and is deleted in this wave');
  });

  it('the cadence is scheduled on the API-SIDE host (TENANT-4d-4), not in the worker', () => {
    // apps/worker takes only pg-native jobs; the api-side ScheduledJobsRunner (S4) is the host for jobs that
    // need module services, and three others already run on it. 4d-2 recorded these as unschedulable from
    // `pending-plan-change.job.ts`'s stale premise that the worker was the only option.
    const registry = fs.readFileSync(path.join(__dirname, '../../../../../worker/src/registry.ts'), 'utf8');
    expect(registry).not.toContain('RenewalInvoicesJob');
    expect(registry).not.toContain('SaasBillingCycleJob');
    const mod = read('..', 'tenancy', 'tenancy.module.ts');
    expect(mod).toContain('this.jobRegistry.register(this.saasBillingCycleCadenceJob)');
    expect(mod).toContain('config.jobs.saasBillingCycle.enabled');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the renewal run', () => {
  it('REFUSES to raise anything when the tax rate cannot be read — an invoice never carries a guessed rate', async () => {
    const { RenewalInvoicesJob } = await import('../jobs/renewal-invoices.job');
    const pool = { connect: async () => { throw new Error('the job must not reach the database at all'); } } as never;
    const job = new RenewalInvoicesJob(pool, {} as never, {} as never, { current: async () => ({ bp: 1800, usedDefault: true, readFailed: true }) } as never);
    await expect(job.run(50, new Date('2026-07-31T00:00:00Z'))).resolves.toEqual({ raised: 0, skipped: 0, failed: 0, refused: 'tax_rate_unreadable' });
  });

  it('the rate is resolved ONCE per tick, so two tenants in one run cannot get different rates', () => {
    const src = read('jobs', 'renewal-invoices.job.ts');
    // The resolve happens before the loop, and the loop reads the captured value.
    expect(src.indexOf('await this.taxRate.current()')).toBeLessThan(src.indexOf('for (const d of due)'));
    expect(src).toContain('taxOn(d.priceMinor, rate.bp)');
    expect(src).toContain('taxBp: rate.bp');
    // The hardcoded zero is gone.
    expect(src).not.toContain('taxMinor: 0n');
  });

  it('an UPGRADE invoice covers a change, not a period, and says so', () => {
    const src = read('services', 'plan-change.service.ts');
    expect(src).toContain('periodic: false');
    expect(src).toContain('taxBp: p.taxBp');
  });

  /**
   * DEFECT 7, found by APPLYING 0146 TO A REAL POSTGRES and calling next_doc_number with the exact argument
   * PlanChangeService passed. `doc_number_series.period` is varchar(10); `pc-${idemKey.slice(0, 24)}` is 27
   * characters; the plpgsql function raised "value too long for type character varying(10)", which rolled back
   * the caller's whole transaction. So TENANT-1d-2, which set out to fix an upgrade that charged nothing,
   * shipped an upgrade that could not complete at all — and no unit test could see it, because the width lives
   * in the database and nothing in TypeScript knows it.
   */
  it('THE DOCUMENT-SERIES PERIOD FITS THE COLUMN — the upgrade used to fail with a 500 because it did not', () => {
    const src = read('services', 'plan-change.service.ts');
    expect(src).not.toContain('pc-${idemKey');
    expect(src).toContain("periodTag: today.slice(0, 7).replace('-', '')");
    // A calendar month is 6 characters — comfortably inside varchar(10).
    expect('2026-07-27'.slice(0, 7).replace('-', '')).toBe('202607');
    expect('2026-07-27'.slice(0, 7).replace('-', '').length).toBeLessThanOrEqual(DOC_SERIES_PERIOD_MAX);
  });

  it('and the repository now refuses an over-long series period BY NAME, before touching a row', async () => {
    const repo = new SaasInvoiceRepository({} as never);
    const tx = { query: async () => { throw new Error('must not reach the database'); } } as never;
    await expect(repo.nextInvoiceNo(tx, 't', 'pc-0190f2a14c3b70008000')).rejects.toThrow(InvalidSaasInvoiceError);
    await expect(repo.nextInvoiceNo(tx, 't', '')).rejects.toThrow(InvalidSaasInvoiceError);
    expect(DOC_SERIES_PERIOD_MAX).toBe(10);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the repository funnel and the surface', () => {
  it('EVERY predicate starts from tenant_id, and the `1=1` door is gone', () => {
    const src = read('repositories', 'saas-invoice.repository.ts');
    // The cross-tenant flag that turned the predicate into `WHERE 1=1` had no caller and is removed.
    expect(src).not.toContain('allTenants');
    expect(src).not.toMatch(/`1=1`/);
    for (const m of src.matchAll(/let where = `([^`]*)`/g)) expect(m[1].startsWith('tenant_id = $1')).toBe(true);

    // Every method's SQL binds tenant_id inline — with exactly ONE named exception, the worker finder that runs
    // as kv_relay across tenants by design. Asserting the exception BY NAME is the point: a second unscoped
    // query added later fails this test instead of quietly joining a category.
    const CROSS_TENANT_BY_DESIGN = ['findOwingPastDue'];
    const methods = [...src.matchAll(/^  (?:async )?(\w+)\(([\s\S]*?)^  \}/gm)];
    expect(methods.length).toBeGreaterThan(8);
    const unscoped = methods
      .filter((m) => /\b(FROM|UPDATE|INTO)\s+saas_invoice/i.test(m[2]))
      .filter((m) => !/tenant_id\s*=\s*\$\d/.test(m[2]) && !/tenant_id,/.test(m[2]))
      .map((m) => m[1]);
    expect(unscoped).toEqual(CROSS_TENANT_BY_DESIGN);
  });

  it('the renewal run\'s idempotency is a COLUMN EQUALITY, not a leading-wildcard LIKE', () => {
    const src = read('repositories', 'saas-invoice.repository.ts');
    expect(src).toContain('period_tag=$3');
    expect(src).not.toContain("invoice_no LIKE");
  });

  it('`paid_minor` is only ever a re-SUM, never an increment', () => {
    const src = read('repositories', 'saas-invoice.repository.ts');
    expect(src).toContain('SET paid_minor = COALESCE((SELECT SUM(p.amount_minor)');
    expect(src).not.toMatch(/paid_minor\s*=\s*paid_minor\s*[+-]/);
  });

  it('a redelivered receipt cannot double-count: the insert is ON CONFLICT DO NOTHING on the idempotency key', () => {
    const src = read('repositories', 'saas-invoice.repository.ts');
    expect(src).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(read('services', 'saas-invoice.service.ts')).toContain('saas_inv_pay:${receipt.paymentId}');
  });

  it('W120 has a route at last — gated by the flag and the permission the service already enforced', () => {
    const src = read('controllers', 'v1', 'saas-invoices.controller.ts');
    expect(src).toContain("@FeatureFlag('saas_billing_console')");
    expect(src).toContain('TenancyPermissions.ManageTenant');
    expect(src).toContain("@Get('console')");
    expect(src).toContain("@Get('invoices')");
    expect(src).toContain("@Get('invoices/:id/pay-quote')");
    // NO second way to start a payment: money-in belongs to the payments module.
    expect(src).not.toContain('@Post(');
    // No :tenantId anywhere — a tenant can only ever read itself.
    expect(src).not.toContain(':tenantId');
  });

  it('the payments module now validates a saas_invoice reference before any gateway order', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '../../payments/services/payment.service.ts'), 'utf8'));
    expect(src).toContain("dto.referenceType === 'saas_invoice'");
    expect(src).toContain('assertPayableAmount(');
    // The amount is compared for EXACT equality with what is outstanding.
    expect(read('services', 'saas-invoice.service.ts')).toContain("BigInt(q.amountMinor) !== amountMinor");
  });

  it('the payment_succeeded payload now carries the EVIDENCE, not just the verdict', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '../../payments/domain/payment.entity.ts'), 'utf8'));
    for (const k of ['payerUserId', 'currencyCode', 'method', 'gatewayPaymentId', 'capturedAt']) expect(src).toContain(k);
    // …and a payment with no payer records NOTHING rather than attributing money to a system account.
    expect(read('services', 'saas-invoice.service.ts')).toContain('if (!receipt.payerUserId)');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/**
 * MUTATION SURVIVOR (round 1): `applyPayment`'s two fail-closed guards were covered only by the integration
 * suite, which is skipped without a database — so on a normal run nothing held them. They are the two ways a
 * relayed capture can be WRONG rather than merely unlucky, and both must record nothing at all.
 */
describe('TENANT-4d-2 · applyPayment refuses a receipt it cannot record honestly', () => {
  const invoice = () => SaasInvoice.rehydrate({
    id: 'inv', tenantId: 't1', subscriptionId: null, invoiceNo: 'SINV-202607-000001', status: 'issued',
    currencyCode: 'INR', subtotalMinor: 795400n, taxMinor: 0n, totalMinor: 795400n, paidMinor: 0n,
    dueDate: '2026-07-20', paidAt: null, lineItems: [], dunningAttempts: 0, periodTag: null, taxBp: null,
    billToGstin: null, billToLegalName: null,
  });

  const build = () => {
    const calls: string[] = [];
    const repo = {
      getForUpdate: async () => invoice(),
      insertReceipt: async () => { calls.push('insertReceipt'); return true; },
      recomputePaidMinor: async () => { calls.push('recompute'); return 795400n; },
      update: async () => { calls.push('update'); },
    };
    const svc = new SaasInvoiceService(
      { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { write: async () => { calls.push('outbox'); } } as never,
      { inc: () => undefined, observe: () => undefined } as never,
      { write: async () => undefined } as never,
      repo as never,
    );
    return { svc, calls };
  };

  const receipt = (over: Record<string, unknown> = {}) => ({
    amountMinor: 795400n, at: new Date('2026-07-18T00:00:00Z'), paymentId: 'p1', method: 'upi',
    currencyCode: 'INR', payerUserId: 'u1', gatewayPaymentId: 'pay_gw_1', ...over,
  });

  it('a payment in ANOTHER CURRENCY records nothing — that is an unrecorded FX conversion, not a partial payment', async () => {
    const { svc, calls } = build();
    await expect(svc.applyPayment({} as never, 't1', 'inv', receipt({ currencyCode: 'BDT' }) as never)).resolves.toBe(false);
    expect(calls).toEqual([]);            // no receipt, no re-sum, no status move
  });

  it('a payment with NO PAYER records nothing — `recorded_by` is NOT NULL so nobody could reconcile it later', async () => {
    const { svc, calls } = build();
    await expect(svc.applyPayment({} as never, 't1', 'inv', receipt({ payerUserId: null }) as never)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('an unknown invoice is ignored (a payment referencing someone else\'s id must not throw into the relay)', async () => {
    const { svc, calls } = build();
    const svc2 = new SaasInvoiceService(
      { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { write: async () => undefined } as never, { inc: () => undefined } as never, { write: async () => undefined } as never,
      { getForUpdate: async () => null } as never,
    );
    await expect(svc2.applyPayment({} as never, 't1', 'nope', receipt() as never)).resolves.toBe(false);
    expect(calls).toEqual([]);
    void svc;
  });

  it('and a GOOD receipt does all three, in order: record → re-SUM → move', async () => {
    const { svc, calls } = build();
    await expect(svc.applyPayment({} as never, 't1', 'inv', receipt() as never)).resolves.toBe(true);
    expect(calls.slice(0, 3)).toEqual(['insertReceipt', 'recompute', 'update']);
    expect(calls).toContain('outbox');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · migration 0146 says what it does, and does what it says', () => {
  it('the unique index is the idempotency, and it is partial so a NULL period cannot defeat it', () => {
    const sql = sqlOnly();
    expect(sql).toContain('CREATE UNIQUE INDEX uq_saas_invoice_subscription_period');
    expect(sql).toContain('ON saas_invoices (tenant_id, subscription_id, period_tag)');
    expect(sql).toContain('WHERE deleted_at IS NULL AND subscription_id IS NOT NULL AND period_tag IS NOT NULL');
  });

  it('the tax rate is nullable with a bounded CHECK, because NULL and 0 are different facts', () => {
    const sql = sqlOnly();
    expect(sql).toContain('ADD COLUMN tax_bp smallint');
    expect(sql).toContain('CHECK (tax_bp IS NULL OR (tax_bp >= 0 AND tax_bp <= 10000))');
  });

  it('the backfill only sets a period it can PROVE, and never guesses one', () => {
    const sql = sqlOnly();
    expect(sql).toContain("split_part(invoice_no, '-', 2) ~ '^\\d{6}$'");
    expect(sql).toContain('period_tag IS NULL');
  });

  it("'gateway' joins the method vocabulary so a real capture is never recorded as a guessed UPI", () => {
    expect(sqlOnly()).toMatch(/saas_invoice_payments_method_check[\s\S]*'gateway'/);
  });

  it('both flags default OFF (Law 10) and neither is the other', () => {
    const sql = sqlOnly();
    for (const k of ['saas_billing_console', 'saas_invoice_self_pay']) {
      expect(sql).toContain(`'${k}'`);
      expect(new RegExp(`SELECT '${k}',[\\s\\S]{0,600}?false`).test(sql)).toBe(true);
    }
  });

  it('it names the gaps it does NOT close, so they are decisions rather than drift', () => {
    const header = migration();
    for (const claim of [
      'THE GRACE PERIOD IS A SENTENCE, NOT A STATE',
      'THE WHOLE SAAS BILLING CADENCE IS UNSCHEDULED',
      'HAS NO SUBJECT',
      "THE PLATFORM'S OWN GSTIN IS NOT STORED ANYWHERE",
      'THE DERIVED-STATUS ARITHMETIC NOW EXISTS TWICE',
    ]) expect(header).toContain(claim);
  });

  it('and it adds no table and no policy, because both tables already carry RLS from the 0092 sweep', () => {
    const sql = sqlOnly();
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('CREATE POLICY');
  });

  /**
   * DEFECT 8, found by probing GRANTS on a real Postgres. The relay consumer writes to two tables its role
   * had no privileges on: 0079 STEP 1 revoked all of kv_relay's access to `saas_invoices` because
   * "zero code reference, grep-confirmed", and the reference exists (outbox.dispatcher.ts runs handlers on the
   * kv_relay connection). So every SaaS invoice a tenant paid through the gateway captured the money and then
   * failed on "permission denied", leaving the invoice `issued` for ever.
   */
  it('THE RELAY GETS EXACTLY THE TWO PRIVILEGES THE HANDLER NEEDS, AND NOT ONE MORE', () => {
    const sql = sqlOnly();
    expect(sql).toContain('GRANT SELECT, UPDATE ON saas_invoices          TO kv_relay');
    expect(sql).toContain('GRANT SELECT, INSERT ON saas_invoice_payments  TO kv_relay');
    // The relay never raises an invoice (that runs through the unit of work, as kv_app) and the receipts table
    // is APPEND-ONLY, so no INSERT on invoices, no UPDATE on receipts, and no DELETE on either — ever.
    expect(sql).not.toMatch(/GRANT[^\n]*INSERT[^\n]*ON saas_invoices\b/);
    expect(sql).not.toMatch(/GRANT[^\n]*UPDATE[^\n]*ON saas_invoice_payments\b/);
    expect(sql).not.toMatch(/GRANT[^\n]*DELETE[^\n]*(saas_invoices|saas_invoice_payments)/);
    // kv_app is NOT granted INSERT on receipts: it never records one, only the relay and the admin plane do.
    expect(sql).not.toMatch(/GRANT[^\n]*ON saas_invoice_payments[^\n]*TO kv_app/);
  });

  it('and the handler really does run on the relay connection — the fact 0079\'s grep missed', () => {
    const dispatcher = fs.readFileSync(path.join(__dirname, '../../../core/outbox/outbox.dispatcher.ts'), 'utf8');
    expect(dispatcher).toContain('kv_relay');
    // If this handler ever stops being registered as an outbox consumer, the grants above want revisiting.
    expect(read('..', 'tenancy', 'tenancy.module.ts')).toContain('this.registry.register(this.saasInvoicePayment)');
  });

  it('it also names the ELEVEN other tables 0079 swept on the same grep, without re-granting any of them', () => {
    const header = migration();
    expect(header).toContain("0079's SWEEP MAY HAVE MADE THE SAME MISTAKE ELSEWHERE");
    for (const t of ['loans', 'trade_invoices', 'milk_bills', 'upi_mandates']) expect(header).toContain(t);
    // A wrong re-grant is worse than a missing one, so this file touches only the table it PROVED.
    const sql = sqlOnly();
    for (const t of ['loans', 'trade_invoices', 'milk_bills', 'upi_mandates', 'bnpl_limits']) {
      expect(sql).not.toMatch(new RegExp(`GRANT[^\\n]*\\b${t}\\b`));
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-2 · the entity refuses what it cannot explain', () => {
  const mk = (over: any = {}) => SaasInvoice.create({
    id: 'i', tenantId: 't', subscriptionId: 's', invoiceNo: 'SINV-202607-000001', currencyCode: 'INR',
    taxMinor: 0n, dueDate: '2026-07-31', lineItems: [{ desc: 'x', qty: 1, unitMinor: 1000n, totalMinor: 1000n }], ...over,
  });

  it('the billed identity is a SNAPSHOT the caller supplies, defaulting to "not recorded"', () => {
    expect(mk().toProps().billToGstin).toBeNull();
    expect(mk({ billToGstin: '24AABCU9603R1Z5', billToLegalName: 'Acme FPO' }).toProps().billToLegalName).toBe('Acme FPO');
  });

  /**
   * MUTATION SURVIVOR (round 1): clearing `paid_at` when an invoice moves OUT of `paid` was untested, because
   * `paid` is terminal in THIS plane's state machine so nothing here can un-settle an invoice. It is reachable
   * all the same: the admin billing-ops plane CAN reverse a receipt, and its own machine has the edges to move
   * a settled invoice back to `overdue`/`issued` — leaving a row that is overdue and still carries the date it
   * was paid. If a fresh gateway partial then arrives, the tenancy plane must clear that stale date, or W120
   * would call the invoice "on time" for ever on the strength of a payment that was reversed.
   */
  it('a STALE paid_at is cleared when the invoice is no longer settled', () => {
    const inv = SaasInvoice.rehydrate({
      id: 'i', tenantId: 't', subscriptionId: null, invoiceNo: 'SINV-202607-000009', status: 'overdue',
      currencyCode: 'INR', subtotalMinor: 1000n, taxMinor: 0n, totalMinor: 1000n, paidMinor: 0n,
      dueDate: '2026-07-20', paidAt: new Date('2026-07-18T00:00:00Z'),   // ← the reversed payment's date
      lineItems: [], dunningAttempts: 0, periodTag: null, taxBp: null, billToGstin: null, billToLegalName: null,
    });
    expect(inv.applyPaidTotal(400n, new Date('2026-08-01T00:00:00Z'), true)).toBe(true);
    expect(inv.status).toBe('partially_paid');
    expect(inv.toProps().paidAt).toBeNull();
    // …and the timeliness rule then reports `unknown` rather than the stale "on time".
    expect(timeliness({ status: inv.status, paidAt: inv.toProps().paidAt, dueDate: '2026-07-20' })).toBe('unknown');
  });

  it('and the service snapshots it from the tenant row at ISSUE, not at read time', () => {
    const src = read('services', 'saas-invoice.service.ts');
    expect(src).toContain('billToSnapshot(tx, input.tenantId)');
    expect(src).toContain('billToGstin: billTo.gstin');
    // A losing concurrent tick is not an error — the invoice it was about to raise already exists.
    expect(src).toContain("=== UNIQUE_VIOLATION) return null");
  });
});
