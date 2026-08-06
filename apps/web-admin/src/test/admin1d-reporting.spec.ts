// apps/web-admin/src/test/admin1d-reporting.spec.ts · PC-56 ADMIN-1d console gates.
// Exports that leave the building, charts that must not lie about their own axis, a renewal preview that must never
// read as a trigger, and a bulk batch that records exactly what the operator meant.
import {
  EXPORT_REPORTS, isExportReport, needsPeriod, buildExport, receiptUsable,
  collectionRateBps, seriesTotal, seriesMax, barPct, retentionBps, willSkip, overduePeriods,
  BULK_ACTIONS, MAX_BULK_INVOICES, isBulkAction, bulkAppliesTo, buildBulk, groupOutcomes, batchHadProblems,
} from '../features/billing/reporting';

describe('exports — the form refuses what the server would refuse', () => {
  it('mirrors the server vocabulary', () => {
    expect([...EXPORT_REPORTS]).toEqual(['tenants', 'plans', 'invoices', 'gstr', 'revenue']);
    expect(isExportReport('gstr')).toBe(true);
    expect(isExportReport('all')).toBe(false);
  });

  it('DEMANDS a period for the GST extract, because an unbounded filing extract is meaningless', () => {
    expect(needsPeriod('gstr')).toBe(true);
    expect(needsPeriod('invoices')).toBe(false);
    expect(buildExport({ report: 'gstr' })).toEqual({ ok: false, error: 'period' });
    expect(buildExport({ report: 'gstr', from: '2026-07-01' })).toEqual({ ok: false, error: 'period' });
    expect(buildExport({ report: 'gstr', from: '2026-07-01', to: '2026-07-31' }).ok).toBe(true);
  });

  it('refuses a reversed period rather than returning an empty file', () => {
    // an empty CSV reads as "there was no business that month", not "you typed the dates backwards"
    expect(buildExport({ report: 'invoices', from: '2026-07-31', to: '2026-07-01' })).toEqual({ ok: false, error: 'order' });
    expect(buildExport({ report: 'invoices', from: '2026-07-01', to: '2026-07-01' }).ok).toBe(true);   // one day is valid
    expect(buildExport({ report: 'invoices', from: 'July' })).toEqual({ ok: false, error: 'from' });
    expect(buildExport({ report: 'invoices', to: '31-07-2026' })).toEqual({ ok: false, error: 'to' });
  });

  it('clamps the limit and only sends filters that were actually set', () => {
    const r = buildExport({ report: 'invoices', limit: '99999' });
    expect(r.ok && r.value.limit).toBe(5000);
    const d = buildExport({ report: 'invoices' });
    expect(d.ok && d.value.limit).toBe(1000);
    expect(d.ok && 'from' in d.value).toBe(false);
    const filtered = buildExport({ report: 'invoices', tenantId: ' t1 ', status: 'overdue' });
    expect(filtered.ok && filtered.value).toEqual({ report: 'invoices', limit: 1000, tenantId: 't1', status: 'overdue' });
  });

  it('treats a receipt with no id as unusable — a download with no provenance is not offered', () => {
    expect(receiptUsable({ id: 'r1' })).toBe(true);
    expect(receiptUsable({ id: '  ' })).toBe(false);
    expect(receiptUsable(null)).toBe(false);
  });
});

describe('revenue series — a rate we cannot compute is not 0%', () => {
  const pts = [
    { month: '2026-06', issuedMinor: '1000000', paidMinor: '750000', invoices: 10 },
    { month: '2026-07', issuedMinor: '2000000', paidMinor: '2000000', invoices: 20 },
    { month: '2026-08', issuedMinor: '0', paidMinor: '0', invoices: 0 },
  ];

  it('reports the collection rate in basis points, and NULL for a month with nothing issued', () => {
    expect(collectionRateBps(pts[0])).toBe(7500);
    expect(collectionRateBps(pts[1])).toBe(10000);
    expect(collectionRateBps(pts[2])).toBeNull();          // nothing to collect ≠ failed to collect
    expect(collectionRateBps({ issuedMinor: 'x', paidMinor: '1' })).toBeNull();
  });

  it('totals the series and SAYS how many points it could not read', () => {
    expect(seriesTotal(pts, 'issuedMinor')).toEqual({ totalMinor: 3000000n, counted: 3, skipped: 0 });
    expect(seriesTotal([...pts, { month: 'bad', issuedMinor: 'lots' }], 'issuedMinor'))
      .toEqual({ totalMinor: 3000000n, counted: 3, skipped: 1 });
  });

  it('scales bars without ever dividing by zero', () => {
    expect(seriesMax(pts, 'issuedMinor')).toBe(2000000n);
    expect(barPct('1000000', 2000000n)).toBe(50);
    expect(barPct('0', 2000000n)).toBe(0);
    expect(barPct('1', 0n)).toBe(0);                       // never NaN in a style attribute
    expect(barPct(null, 100n)).toBe(0);
    expect(seriesMax([], 'issuedMinor')).toBe(0n);
  });

  it('returns NULL retention for an empty cohort rather than 0% ("everybody left")', () => {
    expect(retentionBps({ cohort: '2026-Q1', tenants: 10, stillBilling: 7 })).toBe(7000);
    expect(retentionBps({ cohort: '2026-Q2', tenants: 0, stillBilling: 0 })).toBeNull();
    expect(retentionBps({})).toBeNull();
  });
});

describe('renewal preview — visibility, never a trigger', () => {
  const rows = [
    { alreadyInvoiced: false, priceMinor: '499000', currency: 'INR', periodEnd: '2026-08-01' },
    { alreadyInvoiced: true, priceMinor: '499000', currency: 'INR', periodEnd: '2026-08-03' },
    { alreadyInvoiced: false, priceMinor: '999000', currency: 'INR', periodEnd: '2026-08-20' },
  ];

  it('marks the rows the idempotent run would SKIP', () => {
    expect(willSkip(rows[1])).toBe(true);
    expect(willSkip(rows[0])).toBe(false);
  });

  it('counts periods that have already passed — usually the sign the worker is not running', () => {
    expect(overduePeriods(rows, '2026-08-06T00:00:00.000Z')).toBe(1);   // the 20th is future; the 3rd is already done
    expect(overduePeriods(rows, '2026-07-01T00:00:00.000Z')).toBe(0);
  });
});

describe('bulk actions — the recorded batch equals what the operator meant', () => {
  it('mirrors the server vocabulary and cap', () => {
    expect([...BULK_ACTIONS]).toEqual(['issue', 'mark_overdue', 'void']);
    expect(MAX_BULK_INVOICES).toBe(100);
    expect(isBulkAction('mark_paid')).toBe(false);          // payment-derived statuses are never bulk-assertable
  });

  it('knows which statuses each action applies to', () => {
    expect(bulkAppliesTo('issue', 'draft')).toBe(true);
    expect(bulkAppliesTo('issue', 'issued')).toBe(false);
    expect(bulkAppliesTo('mark_overdue', 'partially_paid')).toBe(true);
    expect(bulkAppliesTo('void', 'paid')).toBe(false);
    expect(bulkAppliesTo('void', 'overdue')).toBe(true);
  });

  it('DROPS inapplicable rows locally and reports how many, so the audit batch is the real intent', () => {
    const selected = [
      { id: 'a', status: 'draft' }, { id: 'b', status: 'issued' }, { id: 'c', status: 'draft' },
    ];
    const r = buildBulk({ action: 'issue', reason: 'cycle correction' }, selected);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.invoiceIds).toEqual(['a', 'c']);
      expect(r.skipped).toBe(1);
    }
  });

  it('de-duplicates a repeated selection — one invoice is one attempt', () => {
    const r = buildBulk({ action: 'void', reason: 'duplicate batch' }, [{ id: 'a', status: 'draft' }, { id: 'a', status: 'draft' }]);
    expect(r.ok && r.value.invoiceIds).toEqual(['a']);
  });

  it('refuses an empty selection, a reason-less batch, and one where nothing applies', () => {
    expect(buildBulk({ action: 'issue', reason: 'x' }, [{ id: 'a', status: 'draft' }])).toEqual({ ok: false, error: 'reason' });
    expect(buildBulk({ action: 'issue', reason: 'fine reason' }, [])).toEqual({ ok: false, error: 'empty' });
    expect(buildBulk({ action: 'issue', reason: 'fine reason' }, [{ id: 'a', status: 'paid' }]))
      .toEqual({ ok: false, error: 'noneApplicable' });
    expect(buildBulk({ action: 'nope', reason: 'fine reason' }, [{ id: 'a', status: 'draft' }])).toEqual({ ok: false, error: 'action' });
  });

  it('refuses a batch over the cap rather than truncating it silently', () => {
    const many = Array.from({ length: MAX_BULK_INVOICES + 1 }, (_, i) => ({ id: `i${i}`, status: 'draft' }));
    expect(buildBulk({ action: 'issue', reason: 'too many' }, many)).toEqual({ ok: false, error: 'tooMany' });
  });

  it('groups every outcome, and leads with problems when there are any', () => {
    const grouped = groupOutcomes([
      { invoiceId: 'a', outcome: 'moved' }, { invoiceId: 'b', outcome: 'illegal', detail: 'paid → void' },
      { invoiceId: 'c', outcome: 'not_found' },
    ]);
    expect(Object.keys(grouped).sort()).toEqual(['illegal', 'moved', 'not_found']);
    expect(batchHadProblems({ illegal: 1 })).toBe(true);
    expect(batchHadProblems({ illegal: 0, notFound: 0, failed: 0 })).toBe(false);
    expect(batchHadProblems(null)).toBe(false);
  });
});
