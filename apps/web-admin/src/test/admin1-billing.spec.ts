// apps/web-admin/src/test/admin1-billing.spec.ts · PC-56 ADMIN-1 (canon W013/W015/W017/W441).
// Three surfaces, one theme: this console is where the platform decides what a tenant OWES and what it was SOLD.
// Every assertion below is really the same assertion — an unknown must never be rendered as a number.
import {
  MAX_DUNNING_ATTEMPTS, AGEING_TIERS, ageingTier, needsWriteOffReview, dunningStep, dunningExhausted,
  suggestedChannel, touchBlockedReason, canRecordTouch, outstandingUnknown, knownOutstanding, tierCounts,
  tierMinDays, isAgeingTier, isLeaving, type QueueRow,
} from '../features/billing/dunning-queue';
import {
  SUBSCRIPTION_STATUSES, isSubscriptionStatus, possibleNext, isTerminalSubscription, daysToRenewal, renewalState,
  anchorTermRows, hasAnchorTerms, addonActive, sortAddons, sortHistory, unsettledCount,
} from '../features/billing/subscription-view';
import {
  parseRiskMin, parseQuery, directoryHref, hasActiveFilters, HIGH_RISK_MIN,
} from '../features/tenants/tenant';
import {
  minor, lineSum, reconcileLines, lineVarianceMinor, gstLabelPct, hsnLabel, hsnAbsentThroughout,
  pdfState, invoicePdfFileName,
} from '../features/billing/invoice-lines';

// ---------------------------------------------------------------- dunning queue (W015)

describe('dunning queue — the debt we cannot measure is never a figure', () => {
  const row = (over: Partial<QueueRow> = {}): QueueRow => ({
    invoiceId: 'i1', invoiceNo: 'INV-1', status: 'overdue', currency: 'INR',
    totalMinor: '100000', outstandingMinor: '100000', daysLate: 5, dunningAttempts: 0, ...over,
  });

  it('mirrors the server cap exactly (admin-api domain/dunning.ts)', () => {
    // if someone changes the server constant, this line is where the divergence surfaces
    expect(MAX_DUNNING_ATTEMPTS).toBe(12);
  });

  it('ages an invoice into the tier a collections officer works', () => {
    expect([...AGEING_TIERS]).toEqual(['current', 'late', 'overdue_30', 'overdue_60', 'overdue_90']);
    expect(ageingTier(0)).toBe('current');        // owed but not yet late — deliberately visible
    expect(ageingTier(-3)).toBe('current');
    expect(ageingTier(1)).toBe('late');
    expect(ageingTier(29)).toBe('late');
    expect(ageingTier(30)).toBe('overdue_30');
    expect(ageingTier(60)).toBe('overdue_60');
    expect(ageingTier(90)).toBe('overdue_90');
    expect(ageingTier(null)).toBe('current');     // unknown lateness is not "very late"
    expect(ageingTier(undefined)).toBe('current');
    expect(isAgeingTier('overdue_30')).toBe(true);
    expect(isAgeingTier('ancient')).toBe(false);
  });

  it('flags 90+ for write-off review rather than another chase', () => {
    expect(needsWriteOffReview(row({ daysLate: 90 }))).toBe(true);
    expect(needsWriteOffReview(row({ daysLate: 89 }))).toBe(false);
  });

  it('stops offering a touch at the server cap, and says why', () => {
    expect(dunningStep(row({ dunningAttempts: 3 }))).toBe(3);
    expect(dunningStep(row({ dunningAttempts: null }))).toBe(0);
    expect(dunningStep(row({ dunningAttempts: -2 }))).toBe(0);
    expect(dunningExhausted(row({ dunningAttempts: 11 }))).toBe(false);
    expect(dunningExhausted(row({ dunningAttempts: 12 }))).toBe(true);
    expect(canRecordTouch(row({ dunningAttempts: 12 }))).toBe(false);
    expect(touchBlockedReason(row({ dunningAttempts: 12 }))).toBe('capped');
    expect(suggestedChannel(row({ dunningAttempts: 12 }))).toBeNull();   // escalate, don't suggest a 13th message
  });

  it('never offers a touch on an invoice that owes nothing', () => {
    for (const status of ['draft', 'paid', 'void', 'nonsense']) {
      expect(touchBlockedReason(row({ status }))).toBe('not_collectible');
      expect(canRecordTouch(row({ status }))).toBe(false);
    }
    for (const status of ['issued', 'partially_paid', 'overdue']) {
      expect(touchBlockedReason(row({ status }))).toBe('none');
    }
  });

  it('escalates the channel gently first and personally later', () => {
    expect(suggestedChannel(row({ dunningAttempts: 0 }))).toBe('email');
    expect(suggestedChannel(row({ dunningAttempts: 1 }))).toBe('sms');
    expect(suggestedChannel(row({ dunningAttempts: 4 }))).toBe('call');
    expect(suggestedChannel(row({ dunningAttempts: 9 }))).toBe('call');   // past the written ladder
  });

  it('KEEPS A PART-PAID BALANCE UNKNOWN and excludes it from every total', () => {
    const partPaid = row({ status: 'partially_paid', outstandingMinor: null, outstandingUnknownReason: 'part_paid_amount_not_recorded' });
    expect(outstandingUnknown(partPaid)).toBe(true);
    const sum = knownOutstanding([row({ outstandingMinor: '100000' }), row({ outstandingMinor: '50000' }), partPaid]);
    expect(sum.totalMinor).toBe(150000n);      // the part-paid invoice's TOTAL is not silently added
    expect(sum.knownRows).toBe(2);
    expect(sum.unknownRows).toBe(1);
  });

  it('treats an unparseable balance as unknown, never as zero', () => {
    const junk = knownOutstanding([row({ outstandingMinor: '1,000' }), row({ outstandingMinor: '12.50' }), row({ outstandingMinor: '' })]);
    expect(junk.totalMinor).toBe(0n);
    expect(junk.knownRows).toBe(0);
    expect(junk.unknownRows).toBe(3);
  });

  it('counts only the tiers that have rows (a chip reading 0 is a dead end)', () => {
    expect(tierCounts([row({ daysLate: 2 }), row({ daysLate: 45 }), row({ daysLate: 45 })]))
      .toEqual([{ tier: 'late', n: 1 }, { tier: 'overdue_30', n: 2 }]);
    expect(tierCounts([])).toEqual([]);
    expect(tierMinDays('current')).toBe(0);
    expect(tierMinDays('late')).toBe(1);
    expect(tierMinDays('overdue_90')).toBe(90);
  });

  it('says when the tenant being chased is already leaving', () => {
    expect(isLeaving(row({ cancelAtPeriodEnd: true }))).toBe(true);
    expect(isLeaving(row({ subscriptionStatus: 'cancelled' }))).toBe(true);
    expect(isLeaving(row({ subscriptionStatus: 'active', cancelAtPeriodEnd: false }))).toBe(false);
    expect(isLeaving(row({ subscriptionStatus: null, cancelAtPeriodEnd: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------- subscription view (W017)

describe('subscription view — possibilities are labelled as possibilities', () => {
  const NOW = '2026-08-06T00:00:00.000Z';

  it('mirrors the 0002 status enum and the one-way ends of the lifecycle', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual(['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']);
    expect(isSubscriptionStatus('past_due')).toBe(true);
    expect(isSubscriptionStatus('lapsed')).toBe(false);
    expect(possibleNext('active')).toEqual(['past_due', 'paused', 'cancelled']);
    expect(possibleNext('cancelled')).toEqual([]);     // re-sold as a new subscription, never revived
    expect(possibleNext('expired')).toEqual([]);
    expect(possibleNext('nonsense')).toEqual([]);
    expect(isTerminalSubscription('cancelled')).toBe(true);
    expect(isTerminalSubscription('paused')).toBe(false);
  });

  it('measures the renewal window, and returns NULL rather than 0 when it cannot', () => {
    expect(daysToRenewal('2026-08-20T00:00:00.000Z', NOW)).toBe(14);
    expect(daysToRenewal('2026-08-01T00:00:00.000Z', NOW)).toBe(-5);
    expect(daysToRenewal(null, NOW)).toBeNull();
    expect(daysToRenewal('soon', NOW)).toBeNull();
  });

  it('distinguishes renewing from ENDING from LAPSED — three different conversations', () => {
    expect(renewalState({ status: 'active', periodEnd: '2026-09-01T00:00:00.000Z' }, NOW)).toBe('renewing');
    expect(renewalState({ status: 'active', periodEnd: '2026-09-01T00:00:00.000Z', cancelAtPeriodEnd: true }, NOW)).toBe('ending');
    expect(renewalState({ status: 'active', periodEnd: '2026-07-01T00:00:00.000Z' }, NOW)).toBe('lapsed');
    expect(renewalState({ status: 'cancelled', periodEnd: '2026-09-01T00:00:00.000Z' }, NOW)).toBe('terminated');
    expect(renewalState({ status: 'active', periodEnd: null }, NOW)).toBe('unknown');
  });

  it('shows negotiated terms as recorded, and never interprets them', () => {
    expect(anchorTermRows({ price_lock_until: '2028-03-31', free_months: 3 }))
      .toEqual([{ key: 'free_months', value: '3' }, { key: 'price_lock_until', value: '2028-03-31' }]);
    expect(anchorTermRows({ nested: { a: 1 } })).toEqual([{ key: 'nested', value: '{"a":1}' }]);
    expect(anchorTermRows({ empty: null, blank: '   ' })).toEqual([]);
    expect(anchorTermRows(null)).toEqual([]);
    expect(anchorTermRows([] as unknown as Record<string, unknown>)).toEqual([]);
    expect(hasAnchorTerms({ anchorTerms: {} })).toBe(false);
    expect(hasAnchorTerms({ anchorTerms: { free_months: 1 } })).toBe(true);
  });

  it('an ended add-on is still shown but is not counted as billing now', () => {
    expect(addonActive({ startsOn: '2026-01-01', endsOn: null }, NOW)).toBe(true);
    expect(addonActive({ startsOn: '2026-09-01' }, NOW)).toBe(false);          // not started
    expect(addonActive({ startsOn: '2026-01-01', endsOn: '2026-07-31' }, NOW)).toBe(false);
    expect(addonActive({ startsOn: '2026-01-01', endsOn: '2026-08-06' }, NOW)).toBe(true);  // last day inclusive
    const sorted = sortAddons([
      { addonCode: 'zeta', startsOn: '2026-01-01' },
      { addonCode: 'alpha', startsOn: '2026-01-01', endsOn: '2026-02-01' },
      { addonCode: 'beta', startsOn: '2026-01-01' },
    ], NOW);
    expect(sorted.map((a) => a.addonCode)).toEqual(['beta', 'zeta', 'alpha']);   // active first, then by code
  });

  it('orders the real history newest-first and sorts undated rows LAST', () => {
    const rows = sortHistory([
      { invoiceNo: 'B', createdAt: '2026-06-01T00:00:00.000Z' },
      { invoiceNo: 'X', createdAt: null },
      { invoiceNo: 'A', createdAt: '2026-07-01T00:00:00.000Z' },
    ]);
    expect(rows.map((r) => r.invoiceNo)).toEqual(['A', 'B', 'X']);
  });

  it('counts unsettled invoices but never totals them (the amount owed is not recorded)', () => {
    expect(unsettledCount([{ status: 'paid' }, { status: 'overdue' }, { status: 'partially_paid' }, { status: 'void' }, { status: 'issued' }])).toBe(3);
  });
});

// ---------------------------------------------------------------- invoice lines + PDF (W013, W441)

describe('invoice lines — the filed document wins, and a mismatch is said out loud', () => {
  const line = (total: string, over: Record<string, unknown> = {}) => ({ desc: 'x', qty: 1, unitMinor: total, totalMinor: total, ...over });

  it('parses minor units strictly and never coerces to zero', () => {
    expect(minor('499000')).toBe(499000n);
    expect(minor('-50000')).toBe(-50000n);
    expect(minor('4990.00')).toBeNull();
    expect(minor('')).toBeNull();
    expect(minor(null)).toBeNull();
  });

  it('reports what it could not read alongside what it summed', () => {
    expect(lineSum([line('100'), line('200')])).toEqual({ sumMinor: 300n, readable: 2, unreadable: 0 });
    expect(lineSum([line('100'), line('two hundred')])).toEqual({ sumMinor: 100n, readable: 1, unreadable: 1 });
  });

  it('reconciles the visible lines against the FILED subtotal', () => {
    expect(reconcileLines([line('400000'), line('99000')], '499000')).toBe('ok');
    expect(reconcileLines([line('400000')], '499000')).toBe('mismatch');       // a line was dropped upstream
    expect(reconcileLines([], '499000')).toBe('no_lines');
    expect(reconcileLines([line('400000')], null)).toBe('unknown');            // nothing to reconcile against
    expect(reconcileLines([line('400000'), line('bad')], '400000')).toBe('mismatch');  // unreadable ≠ ignorable
  });

  it('reports the variance signed, and null when either side is unknown', () => {
    expect(lineVarianceMinor([line('400000')], '499000')).toBe(-99000n);
    expect(lineVarianceMinor([line('500000')], '499000')).toBe(1000n);
    expect(lineVarianceMinor([line('bad')], '499000')).toBeNull();
    expect(lineVarianceMinor([line('1')], 'x')).toBeNull();
  });

  it('leaves GST and HSN absent rather than printing a plausible default', () => {
    expect(gstLabelPct({ gstRatePct: 18 })).toBe(18);
    expect(gstLabelPct({ gstRatePct: 0 })).toBe(0);          // a genuine zero-rated line is a real thing
    expect(gstLabelPct({ gstRatePct: null })).toBeNull();
    expect(gstLabelPct({})).toBeNull();
    expect(hsnLabel({ hsn: ' 998314 ' })).toBe('998314');
    expect(hsnLabel({ hsn: '' })).toBeNull();
    expect(hsnLabel({})).toBeNull();
    expect(hsnAbsentThroughout([{ hsn: null }, { hsn: '  ' }])).toBe(true);
    expect(hsnAbsentThroughout([{ hsn: null }, { hsn: '998314' }])).toBe(false);
    expect(hsnAbsentThroughout([])).toBe(false);              // no lines is not "no HSN"
  });

  it('describes the PDF only as generated or not — never as downloadable', () => {
    // admin-api has no media-presign route (GAP-BACKEND ADMIN-1-Q2), so there is no 'available' state to claim.
    expect(pdfState('018f0000-0000-7000-8000-000000000001')).toBe('generated');
    expect(pdfState(null)).toBe('not_generated');
    expect(pdfState('   ')).toBe('not_generated');
  });

  it('names the file after the invoice NUMBER, which is what the tenant has', () => {
    expect(invoicePdfFileName('INV-2026-06-0972')).toBe('INV-2026-06-0972.pdf');
    expect(invoicePdfFileName('INV/2026 06:0972')).toBe('INV-2026-06-0972.pdf');
    expect(invoicePdfFileName('')).toBe('invoice.pdf');
    expect(invoicePdfFileName(null)).toBe('invoice.pdf');
  });
});

// ---------------------------------------------------------------- tenant directory filters (W002)

describe('tenant directory — a filter that does not survive a page turn is a lie about the list', () => {
  it('bounds the risk filter to what the API accepts, and DROPS nonsense rather than clamping it', () => {
    expect(parseRiskMin('70')).toBe(70);
    expect(parseRiskMin('0')).toBe(0);
    expect(parseRiskMin('100')).toBe(100);
    expect(parseRiskMin('101')).toBeUndefined();     // clamping to 100 would answer a different question
    expect(parseRiskMin('7.5')).toBeUndefined();
    expect(parseRiskMin('-4')).toBeUndefined();
    expect(parseRiskMin('high')).toBeUndefined();
    expect(parseRiskMin('')).toBeUndefined();
    expect(parseRiskMin(null)).toBeUndefined();
  });

  it('trims and bounds the query, and treats blank as no filter', () => {
    expect(parseQuery('  anand  ')).toBe('anand');
    expect(parseQuery('   ')).toBeUndefined();
    expect(parseQuery(undefined)).toBeUndefined();
    expect(parseQuery('x'.repeat(500))?.length).toBe(120);
  });

  it('carries EVERY active filter into the next page (the bug this replaces dropped q and riskMin)', () => {
    expect(directoryHref({ status: 'trial', q: 'anand', riskMin: 70, cursor: 'abc' }))
      .toBe('/tenants?status=trial&q=anand&riskMin=70&cursor=abc');
    expect(directoryHref({ cursor: 'abc' })).toBe('/tenants?cursor=abc');
    expect(directoryHref({})).toBe('/tenants');
    // riskMin 0 is a REAL filter value (everything owed a look) and must not be dropped as falsy
    expect(directoryHref({ riskMin: 0 })).toBe('/tenants?riskMin=0');
    expect(directoryHref({ q: 'a b&c' })).toBe('/tenants?q=a+b%26c');   // encoded, not concatenated
  });

  it('only offers "clear filters" when something is actually filtered', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: 'anand' })).toBe(true);
    expect(hasActiveFilters({ status: 'trial' })).toBe(true);
    expect(hasActiveFilters({ riskMin: 0 })).toBe(true);
  });

  it('keeps the saved view and its label agreed on one threshold', () => {
    expect(HIGH_RISK_MIN).toBe(70);
    expect(directoryHref({ status: 'trial', riskMin: HIGH_RISK_MIN })).toBe('/tenants?status=trial&riskMin=70');
  });
});
