// apps/admin-api/src/modules/billing-ops/__tests__/admin1d-exports-bulk.spec.ts · PC-56 ADMIN-1d.
// Exports leave the building and bulk actions move many tenants' documents at once. Both are places where a small
// carelessness becomes somebody else's spreadsheet or somebody else's invoice.
import {
  EXPORT_REPORTS, isExportReport, exportColumns, csvCell, toCsv, exportFileName, isTruncated,
} from '../domain/billing-export';
import { BULK_ACTIONS, isBulkAction, MAX_BULK_INVOICES, targetStatus, appliesTo } from '../domain/invoice-bulk';

describe('exports — declared columns, and a CSV that cannot execute', () => {
  it('names the five reports and pins each column list', () => {
    expect([...EXPORT_REPORTS]).toEqual(['tenants', 'plans', 'invoices', 'gstr', 'revenue']);
    expect(isExportReport('gstr')).toBe(true);
    expect(isExportReport('everything')).toBe(false);
    // the column list is the approval record for what leaves the platform — pinned so widening it is deliberate
    expect(exportColumns('gstr')).toEqual([
      'invoiceNo', 'invoiceDate', 'tenantSlug', 'tenantGstin', 'placeOfSupply',
      'taxableValueMinor', 'taxMinor', 'totalMinor', 'currency',
    ]);
    expect(exportColumns('revenue')).toEqual(['month', 'invoices', 'issuedMinor', 'paidMinor']);
  });

  it('DEFUSES CSV INJECTION — a formula in tenant-controlled text must open as text', () => {
    // this is the attack: a slug or a reason containing a formula, opened by a finance team in Excel
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(csvCell('+1234')).toBe("'+1234");
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tleading tab')).toBe("'\tleading tab");
    // an ordinary value is untouched
    expect(csvCell('anand-fpo')).toBe('anand-fpo');
  });

  it('quotes commas, quotes and newlines so a value cannot forge a column or a row', () => {
    expect(csvCell('Anand, Gujarat')).toBe('"Anand, Gujarat"');
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('writes EMPTY for null/undefined, never the word "null"', () => {
    // a spreadsheet would sort and sum the string "null" as text and quietly skew a column
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
    expect(csvCell(0)).toBe('0');          // a real zero is not nothing
    expect(csvCell(false)).toBe('false');
  });

  it('always emits a header, even with no rows', () => {
    // a file with no header is indistinguishable from a failed download
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }, { a: 2, b: 'y,z' }])).toBe('a,b\r\n1,x\r\n2,"y,z"');
    // a row missing a declared column yields an empty cell, and the column ORDER always follows the declaration
    expect(toCsv(['a', 'b'], [{ b: 'only b' }])).toBe('a,b\r\n,only b');
  });

  it('puts the RECEIPT ID in the filename, so a file can be traced back to who made it', () => {
    expect(exportFileName('invoices', '018f0000-0000-7000-8000-000000000001', '2026-08-06T12:00:00.000Z'))
      .toBe('krishalaya-invoices-2026-08-06-018f0000.csv');
    expect(exportFileName('gstr', '!!!', '2026-08-06T00:00:00.000Z')).toBe('krishalaya-gstr-2026-08-06-receipt.csv');
  });

  it('reports truncation, because a partial CSV that looks complete breaks a reconciliation', () => {
    expect(isTruncated(1000, 1000)).toBe(true);
    expect(isTruncated(999, 1000)).toBe(false);
  });
});

describe('bulk invoice actions — only what an operator may legitimately drive', () => {
  it('offers the three ADMIN-drivable transitions and NOT the payment-derived ones', () => {
    expect([...BULK_ACTIONS]).toEqual(['issue', 'mark_overdue', 'void']);
    // 'paid' is absent by design: a bulk mark-paid would be one operator asserting money arrived for many tenants,
    // which is exactly what the payments table (0092) exists to prevent
    expect(isBulkAction('mark_paid')).toBe(false);
    expect(isBulkAction('void')).toBe(true);
  });

  it('caps the batch small enough that a human has actually reviewed it', () => {
    expect(MAX_BULK_INVOICES).toBe(100);
  });

  it('names the target status of each action', () => {
    expect(targetStatus('issue')).toBe('issued');
    expect(targetStatus('mark_overdue')).toBe('overdue');
    expect(targetStatus('void')).toBe('void');
  });

  it('says in advance which selected invoices the action can actually touch', () => {
    expect(appliesTo('issue', 'draft')).toBe(true);
    expect(appliesTo('issue', 'issued')).toBe(false);
    expect(appliesTo('mark_overdue', 'issued')).toBe(true);
    expect(appliesTo('mark_overdue', 'partially_paid')).toBe(true);
    expect(appliesTo('mark_overdue', 'draft')).toBe(false);
    expect(appliesTo('void', 'draft')).toBe(true);
    expect(appliesTo('void', 'overdue')).toBe(true);
    // a settled or already-withdrawn invoice is not voidable — and the console can grey the count before submitting
    expect(appliesTo('void', 'paid')).toBe(false);
    expect(appliesTo('void', 'void')).toBe(false);
  });
});
