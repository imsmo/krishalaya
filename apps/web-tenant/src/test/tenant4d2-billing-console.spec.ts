// PC-56 TENANT-4d-2 · W120 (Billing) + W2428-W2430 — the console rules, and the pages' own promises pinned
// against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MECHANISM_ORDER, TABS, anyMechanismMissing, balanceKey, balanceState, buildPayIntent, gapReasonKey, gstinKey,
  isTab, mechanismKey, paidToDateKey, payButtonKey, refusalKey, tabOf, taxLineKey, timelinessKey,
} from '../features/billing/invoices';

const INVOICE_ID = '0190f2a1-4c3b-7000-8000-000000000001';

describe('TENANT-4d-2 · the tabs', () => {
  it('are W120\'s four, in order, and an unknown tab falls back rather than filtering to nothing', () => {
    expect([...TABS]).toEqual(['all', 'issued', 'paid', 'overdue']);
    expect(isTab('overdue')).toBe(true);
    expect(isTab('void')).toBe(false);
    expect(isTab(undefined)).toBe(false);
    expect(tabOf('paid')).toBe('paid');
    expect(tabOf('nonsense')).toBe('all');
    expect(tabOf(undefined)).toBe('all');
  });
});

describe('TENANT-4d-2 · the open balance says which KIND of figure it is', () => {
  const v = (over: Partial<Parameters<typeof balanceState>[0]> = {}) => ({ openBalanceMinor: '795400', openBalanceCurrencies: ['INR'], openInvoiceCount: 1, openBalancePartial: false, ...over });

  it('clear, open, bounded-and-open, and multi-currency are four different sentences', () => {
    expect(balanceState(v({ openBalanceMinor: '0', openInvoiceCount: 0 })).kind).toBe('clear');
    expect(balanceState(v())).toEqual({ kind: 'open', partial: false });
    expect(balanceState(v({ openBalancePartial: true }))).toEqual({ kind: 'open', partial: true });
    expect(balanceState(v({ openBalanceMinor: null, openBalanceCurrencies: ['BDT', 'INR'] }))).toEqual({ kind: 'mixed', currencies: ['BDT', 'INR'] });
  });

  it('and each gets its OWN key — a bounded sum must not read like a complete one', () => {
    expect(balanceKey({ kind: 'clear' })).toBe('bill.balance.clear');
    expect(balanceKey({ kind: 'open', partial: false })).toBe('bill.balance.open');
    expect(balanceKey({ kind: 'open', partial: true })).toBe('bill.balance.openPartial');
    expect(balanceKey({ kind: 'mixed', currencies: [] })).toBe('bill.balance.mixed');
    expect(balanceKey({ kind: 'open', partial: true })).not.toBe(balanceKey({ kind: 'open', partial: false }));
  });
});

describe('TENANT-4d-2 · "all on time" is earned, not assumed', () => {
  it('an unknown payment date withholds the claim and says why', () => {
    expect(paidToDateKey({ invoiceCount: 7, late: 0, unknown: 0, allOnTime: true })).toBe('bill.ptd.allOnTime');
    expect(paidToDateKey({ invoiceCount: 7, late: 1, unknown: 0, allOnTime: false })).toBe('bill.ptd.someLate');
    expect(paidToDateKey({ invoiceCount: 7, late: 0, unknown: 2, allOnTime: false })).toBe('bill.ptd.someUnknown');
    expect(paidToDateKey({ invoiceCount: 0, late: 0, unknown: 0, allOnTime: false })).toBe('bill.ptd.none');
    expect(paidToDateKey({ invoiceCount: 7, late: 0, unknown: 2, allOnTime: false })).not.toBe('bill.ptd.allOnTime');
  });

  it('a row\'s badge distinguishes on-time, late, unrecorded and not-yet-paid', () => {
    expect(timelinessKey('paid', '2026-07-18T00:00:00Z', '2026-07-20')).toBe('bill.time.onTime');
    expect(timelinessKey('paid', '2026-07-20T23:00:00Z', '2026-07-20')).toBe('bill.time.onTime');
    expect(timelinessKey('paid', '2026-07-21T00:00:00Z', '2026-07-20')).toBe('bill.time.late');
    expect(timelinessKey('paid', null, '2026-07-20')).toBe('bill.time.unknown');
    expect(timelinessKey('issued', null, '2026-07-20')).toBe('bill.time.na');
    expect(timelinessKey('paid', null, '2026-07-20')).not.toBe('bill.time.onTime');
  });
});

describe('TENANT-4d-2 · the tax line and the GSTIN', () => {
  it('"not recorded" has its own sentence and is NEVER the zero-rated one', () => {
    expect(taxLineKey('stated')).toBe('bill.tax.stated');
    expect(taxLineKey('zero_rated')).toBe('bill.tax.zeroRated');
    expect(taxLineKey('not_recorded')).toBe('bill.tax.notRecorded');
    expect(taxLineKey('not_recorded')).not.toBe(taxLineKey('zero_rated'));
  });
  it('an invoice with no snapshot says so instead of borrowing today\'s profile value', () => {
    expect(gstinKey('snapshot')).toBe('bill.gstin.onInvoice');
    expect(gstinKey('not_on_invoice')).toBe('bill.gstin.notOnInvoice');
  });
});

describe('TENANT-4d-2 · the four mechanism sentences', () => {
  const allGaps = { autopay: 'no_saas_mandate', nextDebit: 'not_scheduled', gracePeriod: 'no_grace_state', retryAndNotify: 'no_grace_state' } as const;

  it('are W120\'s four, in its order', () => {
    expect([...MECHANISM_ORDER]).toEqual(['autopay', 'nextDebit', 'gracePeriod', 'retryAndNotify']);
  });

  it('a gap and a working mechanism are different sentences, per mechanism', () => {
    expect(mechanismKey('autopay', 'exists')).toBe('bill.mech.autopay.on');
    expect(mechanismKey('autopay', 'no_saas_mandate')).toBe('bill.mech.autopay.gap');
    expect(mechanismKey('gracePeriod', 'no_grace_state')).toBe('bill.mech.gracePeriod.gap');
    expect(mechanismKey('gracePeriod', 'no_grace_state')).not.toBe(mechanismKey('gracePeriod', 'exists'));
  });

  it('and the REASON is its own line, so two mechanisms missing for one reason say it identically', () => {
    expect(gapReasonKey('exists')).toBeNull();
    expect(gapReasonKey('no_saas_mandate')).toBe('bill.gap.noMandate');
    expect(gapReasonKey('not_scheduled')).toBe('bill.gap.notScheduled');
    expect(gapReasonKey('no_grace_state')).toBe('bill.gap.noGrace');
  });

  it('the block is flagged as a notice while ANY sentence is a gap — which today is all four', () => {
    expect(anyMechanismMissing(allGaps as never)).toBe(true);
    expect(anyMechanismMissing({ autopay: 'exists', nextDebit: 'exists', gracePeriod: 'exists', retryAndNotify: 'exists' })).toBe(false);
    expect(anyMechanismMissing({ ...allGaps, autopay: 'exists' } as never)).toBe(true);
  });
});

describe('TENANT-4d-2 · paying an open invoice', () => {
  it('the button is WITHHELD with a reason rather than shown and then refusing', () => {
    expect(payButtonKey({ payable: true, invoiceNo: 'X', amountMinor: '795400', currencyCode: 'INR' })).toEqual({ show: true, key: 'bill.pay.button' });
    expect(payButtonKey(null)).toEqual({ show: false, key: 'bill.pay.noQuote' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'already_paid' })).toEqual({ show: false, key: 'bill.pay.no.alreadyPaid' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'self_pay_off' })).toEqual({ show: false, key: 'bill.pay.no.selfPayOff' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'voided' })).toEqual({ show: false, key: 'bill.pay.no.voided' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'not_yet_issued' })).toEqual({ show: false, key: 'bill.pay.no.notIssued' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'nothing_outstanding' })).toEqual({ show: false, key: 'bill.pay.no.nothingOutstanding' });
    expect(payButtonKey({ payable: false, invoiceNo: 'X', reason: 'wibble' })).toEqual({ show: false, key: 'bill.pay.no.generic' });
  });

  it('THE INTENT CARRIES THE SERVER\'S FIGURE, and a malformed quote never reaches the gateway', () => {
    const ok = buildPayIntent({ payable: true, invoiceNo: 'X', amountMinor: '795400', currencyCode: 'INR' }, INVOICE_ID);
    expect(ok).toEqual({ ok: true, value: { purpose: 'subscription', amountMinor: '795400', currencyCode: 'INR', referenceType: 'saas_invoice', referenceId: INVOICE_ID } });
    expect(buildPayIntent({ payable: false, invoiceNo: 'X', reason: 'already_paid' }, INVOICE_ID)).toEqual({ ok: false, error: 'already_paid' });
    expect(buildPayIntent({ payable: true, invoiceNo: 'X', amountMinor: '0', currencyCode: 'INR' }, INVOICE_ID)).toEqual({ ok: false, error: 'amount' });
    expect(buildPayIntent({ payable: true, invoiceNo: 'X', amountMinor: '-5', currencyCode: 'INR' }, INVOICE_ID)).toEqual({ ok: false, error: 'amount' });
    expect(buildPayIntent({ payable: true, invoiceNo: 'X', amountMinor: '795400', currencyCode: 'inr' }, INVOICE_ID)).toEqual({ ok: false, error: 'currency' });
    expect(buildPayIntent({ payable: true, invoiceNo: 'X', amountMinor: '795400', currencyCode: 'INR' }, 'not-a-uuid')).toEqual({ ok: false, error: 'invoice' });
  });

  it('refusals are translated BY NAME', () => {
    expect(refusalKey('SAAS_INVOICE_NOT_FOUND')).toBe('bill.err.notFound');
    expect(refusalKey('TENANT_FORBIDDEN')).toBe('bill.err.forbidden');
    expect(refusalKey('WHAT')).toBe('bill.err.generic');
  });
});

describe('TENANT-4d-2 · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('W120 reads the billing console and is gated by tenant.settings', () => {
    const s = read('app', 'billing', 'page.tsx');
    expect(s).toContain('tenancy.billing.console()');
    expect(s).toContain('tenancy.billing.invoices(');
    expect(s).toContain("tenantHasPerm('tenant.settings')");
    expect(s).toContain('bill.restricted');
  });

  it('it prints the balance state, the earned paid-to-date claim, the snapshot GSTIN and the tax verdict', () => {
    const s = read('app', 'billing', 'page.tsx');
    expect(s).toContain('balanceState(');
    expect(s).toContain('paidToDateKey(');
    expect(s).toContain('gstinKey(');
    expect(s).toContain('taxLineKey(');
  });

  it('and it states all four mechanism sentences with their reasons', () => {
    const s = read('app', 'billing', 'page.tsx');
    expect(s).toContain('MECHANISM_ORDER.map');
    expect(s).toContain('mechanismKey(');
    expect(s).toContain('gapReasonKey(');
    expect(s).toContain('anyMechanismMissing(');
  });

  it('THE PAY FORM CARRIES NO AMOUNT FIELD — the server resolves it and refuses a mismatch', () => {
    for (const p of [['app', 'billing', 'page.tsx'], ['app', 'billing', 'invoices', '[id]', 'page.tsx']]) {
      const s = read(...p);
      expect(s).toContain('name="invoiceId"');
      expect(s).not.toContain('name="amountMinor"');
      expect(s).not.toContain('name="amount"');
    }
    const a = read('app', 'billing', 'actions.ts');
    expect(a).toContain('tenancy.billing.payQuote(invoiceId)');
    expect(a).toContain('buildPayIntent(quote, invoiceId)');
    // One idempotency key per (invoice, outstanding amount): Retry reuses the order, a changed amount does not.
    expect(a).toContain('`saas-inv:${invoiceId}:${built.value.amountMinor}`');
    expect(a).not.toContain("formData.get('amountMinor')");
  });

  it('the detail screen shows the RECEIPTS — the record a tenant can dispute a balance against', () => {
    const s = read('app', 'billing', 'invoices', '[id]', 'page.tsx');
    expect(s).toContain('inv.receipts');
    expect(s).toContain('bill.receiptsTitle');
    expect(s).toContain('bill.overpaid');
    // Nothing here marks the invoice paid: only a relayed capture does.
    expect(s).toContain('bill.pay.pending');
    // Anti-IDOR: a foreign invoice and a nonexistent one are the same 404.
    expect(s).toContain('notFound()');
  });

  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('bill.'));
    expect(mine.length).toBeGreaterThan(95);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
    // No empty translations: a blank string renders as a missing sentence, which is worse than an English one.
    for (const f of ['en.ts', 'hi.ts', 'gu.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', f), 'utf8');
      for (const m of src.matchAll(/^\s{2}'(bill\.[^']+)':\s*'([^']*)'/gm)) expect(m[2].length).toBeGreaterThan(0);
    }
  });
});
