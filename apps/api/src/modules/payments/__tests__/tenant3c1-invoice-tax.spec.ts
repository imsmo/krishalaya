// PC-56 TENANT-3c-1 · the trade invoice's arithmetic, its place of supply, its GSTR-1 sectioning and its credit
// notes — the numbers a buyer files with.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  InvoiceTaxIdentityError, buildInvoiceTax, buildLine, isFullGstin, maskGstin, splitTax, stateCodeFromGstin,
  supplyTypeOf, taxFromInclusive,
} from '../domain/invoice-tax';
import { B2CL_THRESHOLD_MINOR, gstr1Summarise, gstr1Verdict, isFiledPeriod, periodWindow } from '../domain/gstr1';
import { apportionCredit, creditNoteGate, inheritSupply, MIN_REASON_CHARS } from '../domain/credit-note';
import { buildReceipt, canonicalise, DIGEST_BASIS } from '../domain/export-receipt';

/** W152's own invoice: ₹44,660 of EXEMPT groundnut + a ₹893 facilitation fee, buyer paid ₹45,553 in minor units. */
const W152 = { subtotalMinor: 4_466_000n, deliveryFeeMinor: 0n, discountMinor: 0n, platformFeeMinor: 89_300n, totalMinor: 4_555_300n };
const EXEMPT = { rateBps: 0, hsn: '1202', legalRef: 'Notification 2/2017' };
const SERVICE = { rateBps: 1800, hsn: '9997', legalRef: 'HSN 9997 @18%' };

describe('TENANT-3c-1 · tax is EXTRACTED from what was charged, never added on top', () => {
  it('inclusive extraction: tax = gross × rate / (10000 + rate)', () => {
    expect(taxFromInclusive(89_300n, 1800)).toBe(13_622n);          // ₹893 fee → ₹136.22 of GST inside it
    expect(taxFromInclusive(118_000n, 1800)).toBe(18_000n);          // an exact case: ₹1,180 incl. → ₹180
    expect(taxFromInclusive(0n, 1800)).toBe(0n);
    expect(taxFromInclusive(89_300n, 0)).toBe(0n);
    expect(taxFromInclusive(-5n, 1800)).toBe(0n);
  });
  it('BANKER’S ROUNDING at the paise — half-up would drift one way across millions of lines', () => {
    // 5 × 1000/11000 → 0.4545… → 0 either way; the tie cases are the ones that matter:
    expect(taxFromInclusive(118n, 10_000)).toBe(59n);                // 118×10000/20000 = 59 exactly
    expect(taxFromInclusive(3n, 10_000)).toBe(2n);                   // 1.5 → 2 (nearest EVEN)
    expect(taxFromInclusive(1n, 10_000)).toBe(0n);                   // 0.5 → 0 (nearest EVEN)
    expect(taxFromInclusive(5n, 10_000)).toBe(2n);                   // 2.5 → 2 (nearest EVEN)
  });
  it('THE INVOICE TOTAL EQUALS WHAT THE BUYER PAID — exempt + taxable + tax, exactly', () => {
    const v = buildInvoiceTax(W152, { goods: EXEMPT, delivery: SERVICE, fee: SERVICE });
    expect(v.exemptMinor + v.taxableMinor + v.taxMinor).toBe(W152.totalMinor);
    expect(v.exemptMinor).toBe(4_466_000n);                          // the produce, exempt with a citation
    expect(v.taxMinor).toBe(13_622n);                                // GST inside the fee only
    expect(v.taxableMinor).toBe(89_300n - 13_622n);
    expect(v.basisComplete).toBe(true);
  });
  it('THE OLD ARITHMETIC IS WHAT THIS REPLACES: 5% of the whole order was ₹227,765 of "tax"', () => {
    // The bug, restated as a number: applyBps(total, 500) on the same invoice.
    const oldWay = (W152.totalMinor * 500n) / 10_000n;
    expect(oldWay).toBe(227_765n);
    const v = buildInvoiceTax(W152, { goods: EXEMPT, delivery: SERVICE, fee: SERVICE });
    expect(v.taxMinor).toBeLessThan(oldWay / 10n);                   // the true figure is an order of magnitude smaller
  });
  it('an unresolvable rate is NOT an exemption — it is unknown, and it flags the invoice', () => {
    const v = buildInvoiceTax(W152, { goods: { rateBps: null }, delivery: SERVICE, fee: SERVICE });
    expect(v.basisComplete).toBe(false);
    expect(v.lines.find((l) => l.key === 'goods')!.rateBasis).toBe('not_recorded');
    expect(v.lines.find((l) => l.key === 'goods')!.taxMinor).toBe(0n);
    // and the bases still sum, so the document is storable while being honestly incomplete
    expect(v.exemptMinor + v.taxableMinor + v.taxMinor).toBe(W152.totalMinor);
  });
  it('a rate of 0 from a REAL rule reads as exempt-by-rule, which is a different sentence', () => {
    expect(buildLine('goods', 100n, { rateBps: 0, legalRef: 'Notif 2/2017' }).rateBasis).toBe('exempt_by_rule');
    expect(buildLine('goods', 100n, { rateBps: null }).rateBasis).toBe('not_recorded');
  });
  it('the discount comes off goods first, then delivery, then the fee — the order the money was applied in', () => {
    const v = buildInvoiceTax({ subtotalMinor: 1000n, deliveryFeeMinor: 200n, discountMinor: 1100n, platformFeeMinor: 100n, totalMinor: 200n },
      { goods: EXEMPT, delivery: SERVICE, fee: SERVICE });
    expect(v.lines.find((l) => l.key === 'goods')).toBeUndefined();   // fully discounted → no line at all
    expect(v.lines.find((l) => l.key === 'delivery')!.grossMinor).toBe(100n);
    expect(v.exemptMinor + v.taxableMinor + v.taxMinor).toBe(200n);
  });
  it('FAILS CLOSED when the lines do not reconcile — the guard whose absence let 5%-of-total stand', () => {
    expect(() => buildInvoiceTax({ ...W152, totalMinor: 9_999_999n }, { goods: EXEMPT, delivery: SERVICE, fee: SERVICE }))
      .toThrow(InvoiceTaxIdentityError);
  });
});

describe('TENANT-3c-1 · place of supply is DETERMINED, never assumed intra-state', () => {
  it('same state is intra, different is inter, and a missing side is UNKNOWN', () => {
    expect(supplyTypeOf('24', '24')).toBe('intra');
    expect(supplyTypeOf('24', '27')).toBe('inter');
    expect(supplyTypeOf(null, '27')).toBe('unknown');
    expect(supplyTypeOf('24', null)).toBe('unknown');
  });
  it('the state code comes from a GSTIN — INCLUDING A MASKED ONE, which is all the platform stores for a buyer', () => {
    expect(stateCodeFromGstin('24AABCU9603R1ZM')).toBe('24');
    expect(stateCodeFromGstin('27••••••••3Z5')).toBe('27');
    expect(stateCodeFromGstin('unregistered')).toBeNull();
    expect(stateCodeFromGstin(null)).toBeNull();
  });
  it('an intra-state split sums EXACTLY (the odd paise goes to SGST), inter goes to IGST', () => {
    expect(splitTax(13_623n, 'intra')).toEqual({ cgstMinor: 6_811n, sgstMinor: 6_812n, igstMinor: 0n, unallocatedMinor: 0n });
    expect(splitTax(13_622n, 'inter')).toEqual({ cgstMinor: 0n, sgstMinor: 0n, igstMinor: 13_622n, unallocatedMinor: 0n });
  });
  it('AN UNKNOWN SUPPLY TYPE LEAVES THE TAX UNALLOCATED rather than guessing CGST/SGST', () => {
    // The hardcoded `cgst = tax/2` this replaces would have put an inter-state supply in the wrong columns, and a
    // buyer given CGST/SGST on an inter-state purchase cannot claim the credit.
    expect(splitTax(1_000n, 'unknown')).toEqual({ cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, unallocatedMinor: 1_000n });
  });
  it('masking keeps the state (public, load-bearing) and the last four; a full GSTIN is recognised as full', () => {
    expect(maskGstin('24AABCU9603R1ZM')).toBe('24•••••••••R1ZM');
    expect(isFullGstin('24AABCU9603R1ZM')).toBe(true);
    expect(isFullGstin('24•••••••••R1ZM')).toBe(false);
    expect(isFullGstin(null)).toBe(false);
  });
});

describe('TENANT-3c-1 · GSTR-1 sections, and the rows this platform cannot file', () => {
  const base = { invoiceNo: 'INV-2026-07-000001', buyerGstin: null as string | null, supplyType: 'intra' as const, placeOfSupplyCode: '24', totalMinor: 4_555_300n, taxableMinor: 75_678n, taxMinor: 13_622n, basisComplete: true };
  it('B2B needs a FULL GSTIN; a mask is excluded by name rather than filed', () => {
    expect(gstr1Verdict({ ...base, buyerGstin: '24AABCU9603R1ZM' })).toEqual({ kind: 'section', section: 'b2b' });
    expect(gstr1Verdict({ ...base, buyerGstin: '24•••••••••R1ZM' })).toEqual({ kind: 'excluded', reason: 'buyer_gstin_masked_only' });
  });
  it('an unregistered buyer is B2CS, or B2CL when inter-state and above the threshold', () => {
    expect(gstr1Verdict(base)).toEqual({ kind: 'section', section: 'b2cs' });
    expect(gstr1Verdict({ ...base, supplyType: 'inter' as any, placeOfSupplyCode: '27', totalMinor: B2CL_THRESHOLD_MINOR + 1n }))
      .toEqual({ kind: 'section', section: 'b2cl' });
    expect(gstr1Verdict({ ...base, supplyType: 'inter' as any, placeOfSupplyCode: '27', totalMinor: B2CL_THRESHOLD_MINOR }))
      .toEqual({ kind: 'section', section: 'b2cs' });     // the boundary: AT the threshold is not above it
  });
  it('THE BREAKDOWN IS CHECKED FIRST — a pre-0140 invoice has nothing to file whatever else is true of it', () => {
    expect(gstr1Verdict({ ...base, taxableMinor: null, buyerGstin: '24•••••••••R1ZM' }))
      .toEqual({ kind: 'excluded', reason: 'breakdown_not_recorded' });
    expect(gstr1Verdict({ ...base, basisComplete: false })).toEqual({ kind: 'excluded', reason: 'tax_basis_incomplete' });
    expect(gstr1Verdict({ ...base, supplyType: 'unknown' as any })).toEqual({ kind: 'excluded', reason: 'supply_type_unknown' });
  });
  it('the summary reports COVERAGE — "partial" is never dressed up as a complete month', () => {
    const s = gstr1Summarise([base, { ...base, basisComplete: false }, { ...base, buyerGstin: '24AABCU9603R1ZM' }]);
    expect(s.filableCount).toBe(2);
    expect(s.excludedCount).toBe(1);
    expect(s.coverage).toBe('partial');
    expect(s.sections.b2cs.count).toBe(1);
    expect(s.sections.b2b.count).toBe(1);
    expect(s.sections.b2cs.taxMinor).toBe('13622');
    expect(gstr1Summarise([]).coverage).toBe('empty');
    expect(gstr1Summarise([base]).coverage).toBe('complete');
  });
  it('a period must be a CLOSED calendar month, and its window is UTC', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    expect(isFiledPeriod('2026-07', now)).toBe(true);
    expect(isFiledPeriod('2026-08', now)).toBe(false);      // the current month changes after it is filed
    expect(isFiledPeriod('2026-13', now)).toBe(false);
    expect(isFiledPeriod('July', now)).toBe(false);
    expect(periodWindow('2026-07')).toEqual({ fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-08-01T00:00:00.000Z' });
    expect(periodWindow('2026-7')).toBeNull();
  });
});

describe('TENANT-3c-1 · a credit note is bounded by the invoice it corrects', () => {
  const lines = buildInvoiceTax(W152, { goods: EXEMPT, delivery: SERVICE, fee: SERVICE }).lines;
  it('refuses more than what is LEFT of the invoice, and refuses a non-positive amount', () => {
    expect(creditNoteGate({ amountMinor: 1_000_000n, invoiceTotalMinor: 4_555_300n, alreadyCreditedMinor: 4_000_000n, invoiceHasBreakdown: true }))
      .toEqual({ kind: 'exceeds_remaining', remainingMinor: 555_300n });
    expect(creditNoteGate({ amountMinor: 0n, invoiceTotalMinor: 100n, alreadyCreditedMinor: 0n, invoiceHasBreakdown: true }).kind).toBe('not_positive');
    expect(creditNoteGate({ amountMinor: 555_300n, invoiceTotalMinor: 4_555_300n, alreadyCreditedMinor: 4_000_000n, invoiceHasBreakdown: true }))
      .toEqual({ kind: 'ok', amountMinor: 555_300n });      // exactly the remainder is allowed
  });
  it('REFUSES AN INVOICE WITH NO BREAKDOWN — a credit note must state its own split, not invent one', () => {
    expect(creditNoteGate({ amountMinor: 100n, invoiceTotalMinor: 4_555_300n, alreadyCreditedMinor: 0n, invoiceHasBreakdown: false }).kind)
      .toBe('invoice_has_no_breakdown');
  });
  it('apportions PROPORTIONALLY across the invoice’s lines and sums to the credit exactly', () => {
    const c = apportionCredit(1_000_000n, lines, W152.totalMinor);
    expect(c.totalMinor).toBe(1_000_000n);
    expect(c.exemptMinor + c.taxableMinor + c.taxMinor).toBe(1_000_000n);
    // The tax reversed is proportional to the tax charged — taking the whole credit off the exempt goods would return
    // money to the buyer while leaving the platform's collected GST untouched.
    expect(c.taxMinor).toBeGreaterThan(0n);
    expect(c.taxMinor).toBeLessThan(13_622n);
    expect(c.lines.length).toBe(lines.length);
  });
  it('an empty line set credits as exempt rather than throwing — the gate refuses that case first', () => {
    const c = apportionCredit(500n, [], W152.totalMinor);
    expect(c.exemptMinor).toBe(500n);
    expect(c.taxMinor).toBe(0n);
  });
  it('a credit note inherits the invoice’s supply — a correction filed elsewhere lands in the wrong table', () => {
    expect(inheritSupply({ placeOfSupplyCode: '27', supplyType: 'inter' })).toEqual({ placeOfSupplyCode: '27', supplyType: 'inter' });
    expect(inheritSupply({ placeOfSupplyCode: null, supplyType: null })).toEqual({ placeOfSupplyCode: null, supplyType: 'unknown' });
    expect(MIN_REASON_CHARS).toBe(20);
  });
});

describe('TENANT-3c-1 · the export receipt (the tenant realm’s first)', () => {
  it('canonical JSON sorts keys recursively and renders bigints as strings, so a digest is reproducible', () => {
    expect(canonicalise({ b: 1, a: { d: 2n, c: [3, { f: 4, e: 5 }] } }))
      .toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":"2"},"b":1}');
  });
  it('the same data in a different key order produces the SAME sha256', () => {
    const at = new Date('2026-08-01T00:00:00Z');
    const r1 = buildReceipt({ fileName: 'f', payload: { a: 1, b: 2 }, rowCount: 2, requestedBy: 'u', generatedAt: at, coverage: 'complete', omissions: [] });
    const r2 = buildReceipt({ fileName: 'f', payload: { b: 2, a: 1 }, rowCount: 2, requestedBy: 'u', generatedAt: at, coverage: 'complete', omissions: [] });
    expect(r1.sha256).toBe(r2.sha256);
    expect(r1.digestBasis).toBe(DIGEST_BASIS);
  });
  it('the receipt CARRIES the omissions and drops only the zero ones — a silent omission reads as complete', () => {
    const r = buildReceipt({ fileName: 'f', payload: {}, rowCount: 0, requestedBy: 'u', generatedAt: new Date('2026-08-01T00:00:00Z'), coverage: 'partial', omissions: [{ reason: 'x', count: 2 }, { reason: 'y', count: 0 }] });
    expect(r.omissions).toEqual([{ reason: 'x', count: 2 }]);
    expect(r.coverage).toBe('partial');
  });
});

describe('TENANT-3c-1 · the schema and the wiring say what the wave claims (comments stripped)', () => {
  const root = path.join(__dirname, '..', '..', '..', '..', '..', '..');
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '0140_invoice_statutory_truth.sql'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('0140 makes an invoice that does not add up UNSTORABLE', () => {
    expect(sql).toContain('ck_trade_invoice_bases_sum');
    expect(sql).toContain('exempt_minor + taxable_minor + tax_minor = total_minor');
  });
  it('the GST state code is on level 1 only, and the two launch states are seeded', () => {
    expect(sql).toContain('gst_state_code');
    expect(sql).toContain("gst_state_code ~ '^[0-9]{2}$' AND level = 1");
    expect(sql).toContain("SET gst_state_code = '24'");
    expect(sql).toContain("SET gst_state_code = '27'");
  });
  it('credit notes are append-only, checker-gated, and one per approval', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS credit_notes');
    expect(sql).toContain('approval_id       uuid NOT NULL REFERENCES refund_approvals(id)');
    expect(sql).toContain('uq_credit_note_approval');
    expect(sql).toContain('REVOKE DELETE, TRUNCATE ON credit_notes');
    expect(sql).toContain('reason_text IS NOT NULL AND char_length(btrim(reason_text)) >= 20');   // the 3b NULL lesson, applied
  });
  it('0139’s plane learns credit_note instead of a second maker-checker being built', () => {
    expect(sql).toContain("subject_type IN ('dispute', 'return', 'credit_note')");
  });
  it('AND THE COLUMN IS WIDENED BEFORE THE CHECK — the live apply caught this one', () => {
    // 0139 sized subject_type at varchar(10) for 'dispute'/'return'. 'credit_note' is 11 characters: with the CHECK
    // widened and the column left alone, every insert failed with "value too long for type character varying(10)"
    // AFTER a clean migration and a green unit suite (TypeScript never sees a column width).
    expect(sql).toContain('ALTER COLUMN subject_type TYPE varchar(20)');
    expect(sql.indexOf('ALTER COLUMN subject_type TYPE')).toBeLessThan(sql.indexOf("subject_type IN ('dispute', 'return', 'credit_note')"));
  });
  it('0140 does NOT backfill, does NOT invent commodity rates, and does NOT make tax_rules tenant-writable', () => {
    expect(sql).not.toMatch(/UPDATE trade_invoices SET taxable_minor/);
    expect(sql).not.toMatch(/ALTER TABLE tax_rules ADD COLUMN IF NOT EXISTS tenant_id/);
    // exactly one rate is inserted, and it is the platform's own service rate
    expect((sql.match(/INSERT INTO tax_rules/g) ?? []).length).toBe(1);
    expect(sql).toContain("'gst_service'");
    expect(sql).toContain('9997');
  });
  it('the invoice is raised at CONFIRM, with completion kept as an idempotent backstop', () => {
    const mod = strip(fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'modules', 'payments', 'payments.module.ts'), 'utf8'));
    expect(mod).toContain('this.registry.register(this.orderConfirmedInvoice)');
    expect(mod).toContain('this.registry.register(this.tradeInvoice)');
    const h = read('events', 'handlers', 'order-confirmed-invoice.handler.ts');
    expect(h).toContain("readonly eventType = 'orders.order_confirmed'");
    const order = strip(fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'modules', 'orders', 'domain', 'order.entity.ts'), 'utf8'));
    expect(order).toContain('confirmedPayload');
    expect(order).toContain('subtotalMinor');                       // the event now carries the money components
  });
  it('the generator no longer applies one blended rate to the whole order', () => {
    const svc = read('services', 'trade-invoice.service.ts');
    expect(svc).toContain('buildInvoiceTax');
    expect(svc).not.toMatch(/applyBps\(input\.totalMinor/);
    expect(svc).toContain('gst_service');
    expect(svc).toContain('resolveParties');
  });
  it('the GSTR-1 export refuses an open period and a month too large, and receipts what it produces', () => {
    const svc = read('services', 'gstr1-export.service.ts');
    expect(svc).toContain('GSTR1_PERIOD_OPEN');
    expect(svc).toContain('GSTR1_TOO_LARGE');
    expect(svc).toContain('buildReceipt');
    expect(svc).toContain('invoice.gstr1_exported');                // the audit-receipt law
  });
});
