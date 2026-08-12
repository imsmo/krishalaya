// PC-56 TENANT-3c-1 · W151's month view and W152's document — the console rules, and the pages' own promises pinned
// against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  coverageKey, creditNoteBlockedBy, exclusionRows, filableState, isExportablePeriod, isFullyCredited, isGstPeriod,
  previousPeriods, rateBasisKey, remainingMinor, supplyKey, taxCell,
} from '../features/invoices/console';
import { CREDIT_NOTE_REASON_CODES, isCreditNoteReasonCode } from '../features/invoices/reasons';

const ROW = {
  taxMinor: '13622', taxableMinor: '75678', taxBasisComplete: true,
  supplyType: 'intra', placeOfSupplyCode: '24', buyerGstin: null as string | null,
  totalMinor: '4555300', creditedMinor: '0',
};

describe('TENANT-3c-1 · the GST period', () => {
  it('is a calendar month, and the CURRENT one is never exportable', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    expect(isGstPeriod('2026-07')).toBe(true);
    expect(isGstPeriod('2026-13')).toBe(false);
    expect(isGstPeriod(undefined)).toBe(false);
    expect(isExportablePeriod('2026-07', now)).toBe(true);
    expect(isExportablePeriod('2026-08', now)).toBe(false);   // open period → the return would change after filing
  });
  it('the picker offers only months that have ended, newest first', () => {
    const ps = previousPeriods(new Date('2026-08-12T00:00:00Z'), 3);
    expect(ps).toEqual(['2026-07', '2026-06', '2026-05']);
    expect(ps).not.toContain('2026-08');
  });
});

describe('TENANT-3c-1 · A NULL TAX IS NOT ₹0', () => {
  it('an invoice with no recorded breakdown says so instead of showing zero', () => {
    expect(taxCell(ROW)).toEqual({ kind: 'amount', minor: '13622', rateNote: true });
    expect(taxCell({ ...ROW, taxMinor: null })).toEqual({ kind: 'not_recorded' });
    expect(taxCell({ ...ROW, taxableMinor: null })).toEqual({ kind: 'not_recorded' });
  });
  it('a real ₹0 tax on a recorded breakdown is still a figure, and it renders as one', () => {
    expect(taxCell({ ...ROW, taxMinor: '0', taxableMinor: '0' })).toEqual({ kind: 'amount', minor: '0', rateNote: false });
  });
  it('an unknown supply type is its own sentence, never intra-state', () => {
    expect(supplyKey('intra')).toBe('intra');
    expect(supplyKey('inter')).toBe('inter');
    expect(supplyKey(null)).toBe('unknown');
    expect(supplyKey('teleported')).toBe('unknown');
  });
  it('a line whose rate is not recorded is not labelled exempt', () => {
    expect(rateBasisKey('resolved')).toBe('resolved');
    expect(rateBasisKey('exempt_by_rule')).toBe('exemptByRule');
    expect(rateBasisKey('not_recorded')).toBe('notRecorded');
    expect(rateBasisKey('something_new')).toBe('notRecorded');       // an unknown basis is not shown as taxed
  });
});

describe('TENANT-3c-1 · what can be filed, said per row before anybody exports a month', () => {
  it('mirrors the api’s verdict order — breakdown first', () => {
    expect(filableState(ROW)).toBe('filable');
    expect(filableState({ ...ROW, taxMinor: null })).toBe('breakdown_not_recorded');
    expect(filableState({ ...ROW, taxBasisComplete: false })).toBe('tax_basis_incomplete');
    expect(filableState({ ...ROW, supplyType: 'unknown' })).toBe('supply_type_unknown');
    expect(filableState({ ...ROW, placeOfSupplyCode: null })).toBe('supply_type_unknown');
    expect(filableState({ ...ROW, buyerGstin: '24•••••••••R1ZM' })).toBe('buyer_gstin_masked_only');
    expect(filableState({ ...ROW, buyerGstin: '24AABCU9603R1ZM' })).toBe('filable');
  });
  it('coverage keys: anything that is not complete or empty reads as PARTIAL', () => {
    expect(coverageKey('complete')).toBe('complete');
    expect(coverageKey('empty')).toBe('empty');
    expect(coverageKey('partial')).toBe('partial');
    expect(coverageKey('mostly')).toBe('partial');
  });
  it('exclusions are listed largest-first and zeroes are dropped', () => {
    expect(exclusionRows({ a: 0, b: 2, c: 5 })).toEqual([{ reason: 'c', count: 5 }, { reason: 'b', count: 2 }]);
  });
});

describe('TENANT-3c-1 · credits against an invoice', () => {
  it('the remainder never goes negative, and a fully credited invoice says so', () => {
    expect(remainingMinor({ totalMinor: '1000', creditedMinor: '400' })).toBe('600');
    expect(remainingMinor({ totalMinor: '1000', creditedMinor: '1400' })).toBe('0');
    expect(isFullyCredited({ totalMinor: '1000', creditedMinor: '1000' })).toBe(true);
    expect(isFullyCredited({ totalMinor: '1000', creditedMinor: '999' })).toBe(false);
    expect(isFullyCredited({ totalMinor: '0', creditedMinor: '0' })).toBe(false);
  });
  it('the credit-note form is withheld with a REASON rather than shown and refused', () => {
    expect(creditNoteBlockedBy(ROW, { canFinance: true })).toBeNull();
    expect(creditNoteBlockedBy({ ...ROW, taxableMinor: null }, { canFinance: true })).toBe('noBreakdown');
    expect(creditNoteBlockedBy({ ...ROW, creditedMinor: '4555300' }, { canFinance: true })).toBe('fullyCredited');
    expect(creditNoteBlockedBy(ROW, { canFinance: false })).toBe('noPermission');
  });
  it('the reason vocabulary is the API’s own, so the console cannot offer a 422', () => {
    expect(CREDIT_NOTE_REASON_CODES).toEqual(['goods_returned', 'quantity_short', 'quality_rejected', 'price_correction', 'order_cancelled', 'tax_correction']);
    expect(isCreditNoteReasonCode('quantity_short')).toBe(true);
    expect(isCreditNoteReasonCode('because')).toBe(false);
  });
});

describe('TENANT-3c-1 · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the month view prints the SUMS’ OWN BASIS — what is not in them, and why', () => {
    const s = read('app', 'invoices', 'page.tsx');
    expect(s).toContain('inv.withoutBreakdown');
    expect(s).toContain('inv.incompleteBasis');
    expect(s).toContain('inv.taxNotRecorded');
  });
  it('no page-number pager and no rows-per-page select (the roster rule, fifth application)', () => {
    const s = read('app', 'invoices', 'page.tsx');
    expect(s.toUpperCase()).not.toContain('OFFSET');
    expect(s).toContain('inv.pagerNote');
    expect(s).not.toMatch(/rowsPerPage|perPage/);
  });
  it('the document states the inclusive-tax invariant and never claims an IRN it does not have', () => {
    const s = read('app', 'invoices', '[id]', 'page.tsx');
    expect(s).toContain('invd.inclusiveNote');
    expect(s).toContain('invd.irnPending');
    expect(s).toContain('invd.linesNotRecorded');
    expect(s).toContain('invd.maskedOnly');
  });
  it('the credit-note form takes an APPROVAL id, never a typed amount', () => {
    const s = read('app', 'invoices', '[id]', 'page.tsx');
    expect(s).toContain('approvalId');
    expect(s).not.toMatch(/name="amountMinor"|name="amountMajor"/);
  });
  it('every export and credit refusal is translated by NAME', () => {
    const s = read('app', 'invoices', 'actions.ts');
    expect(s).toContain('GSTR1_PERIOD_OPEN');
    expect(s).toContain('GSTR1_TOO_LARGE');
    expect(s).toContain('CREDIT_NOTE_EXCEEDS_INVOICE');
    expect(s).toContain('CREDIT_NOTE_INVOICE_NOT_BROKEN_DOWN');
    expect((s.match(/length < 20/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('inv.') || k.startsWith('invd.'));
    expect(mine.length).toBeGreaterThan(90);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
