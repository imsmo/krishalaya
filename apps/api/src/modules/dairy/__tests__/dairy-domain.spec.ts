// modules/dairy/__tests__/dairy-domain.spec.ts · pure-domain unit tests: THE FLOAT-FREE PRICING ENGINE
// (exact bigint arithmetic — the core money-correctness invariant), the milk-bill state machine + net
// computation, and collection/rate-card invariants. No infra — UoW/outbox/wallet are the integration spec.
import { MilkRateCard } from '../domain/milk-rate-card.entity';
import { MilkCollection } from '../domain/milk-collection.entity';
import { MilkBill } from '../domain/milk-bill.entity';
import { canTransition, isTerminal, BILL_STATUSES, BillStatus, IllegalBillTransitionError } from '../domain/milk-bill.state';
import { InvalidRateCardError, InvalidCollectionError, BillNotPayableError } from '../domain/dairy.errors';
import { DairyEventType } from '../domain/dairy.events';

const twoAxis = (over: any = {}) => MilkRateCard.create({ id: 'rc1', tenantId: 't1', defaultName: 'GJ Cow', animalType: 'cow',
  pricingModel: 'two_axis', ratePerKgFatMinor: 50000n, ratePerKgSnfMinor: 30000n, baseRatePerLitreMinor: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, ...over });

describe('MilkRateCard — float-free pricing engine', () => {
  it('two_axis: 10kg @ 4.50% fat (₹500/kg) + 8.50% snf (₹300/kg) = ₹480.00 EXACT', () => {
    // 0.45kg fat × 50000 = 22500 ; 0.85kg snf × 30000 = 25500 ; total 48000
    expect(twoAxis().priceMinor(10000n, 450n, 850n)).toBe(48000n);
  });
  it('adds a base per-litre component when set', () => {
    const card = twoAxis({ baseRatePerLitreMinor: 200n }); // +10kg × ₹2 = 2000
    expect(card.priceMinor(10000n, 450n, 850n)).toBe(50000n);
  });
  it('fat_pooled prices the fat axis only; snf_pooled the snf axis only', () => {
    const fat = MilkRateCard.create({ id: 'r', tenantId: 't', defaultName: 'f', animalType: 'buffalo', pricingModel: 'fat_pooled', ratePerKgFatMinor: 50000n, ratePerKgSnfMinor: null, baseRatePerLitreMinor: null, effectiveFrom: '2026-01-01', effectiveTo: null });
    const snf = MilkRateCard.create({ id: 'r', tenantId: 't', defaultName: 's', animalType: 'buffalo', pricingModel: 'snf_pooled', ratePerKgFatMinor: null, ratePerKgSnfMinor: 30000n, baseRatePerLitreMinor: null, effectiveFrom: '2026-01-01', effectiveTo: null });
    expect(fat.priceMinor(10000n, 450n, 850n)).toBe(22500n);
    expect(snf.priceMinor(10000n, 450n, 850n)).toBe(25500n);
  });
  it('rounds half-up deterministically (no float drift)', () => {
    // 1.234kg × 3.33% × 12345 = 5072832090/1e7 = 507.283… → 507
    const card = MilkRateCard.create({ id: 'r', tenantId: 't', defaultName: 'x', animalType: 'mixed', pricingModel: 'fat_pooled', ratePerKgFatMinor: 12345n, ratePerKgSnfMinor: null, baseRatePerLitreMinor: null, effectiveFrom: '2026-01-01', effectiveTo: null });
    expect(card.priceMinor(1234n, 333n, 0n)).toBe(507n);
  });
  it('rejects a model missing its required rate', () => {
    expect(() => MilkRateCard.create({ id: 'r', tenantId: 't', defaultName: 'x', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: 50000n, ratePerKgSnfMinor: null, baseRatePerLitreMinor: null, effectiveFrom: '2026-01-01', effectiveTo: null })).toThrow(InvalidRateCardError);
  });
});

describe('MilkCollection invariants', () => {
  const base = { id: 'c1', tenantId: 't1', mccId: 'm1', membershipId: 'mem1', shift: 'morning' as const, collectedOn: '2026-06-15',
    weightMilliKg: 10000n, fatCentiPct: 450n, snfCentiPct: 850n, density: null, waterFlag: false, adulterationFlags: [], rateCardId: 'rc1',
    // PC-56 TENANT-6b-1: a pour now carries what the premium slabs paid it (zero here) and whether they were applied
    // at all — see domain/milk-rate-card.entity.ts for why those are two different facts.
    amountMinor: 48000n, bonusMinor: 0n, bonusApplied: false, enteredBy: 'op1' };
  it('records + emits collection_recorded; amount is bigint minor units', () => {
    const c = MilkCollection.record(base);
    expect(typeof c.amountMinor).toBe('bigint'); expect(c.amountMinor).toBe(48000n);
    expect(c.pullEvents().map((e) => e.type)).toContain(DairyEventType.CollectionRecorded);
  });
  it('rejects non-positive weight and out-of-range fat/snf', () => {
    expect(() => MilkCollection.record({ ...base, weightMilliKg: 0n })).toThrow(InvalidCollectionError);
    expect(() => MilkCollection.record({ ...base, fatCentiPct: 99999n })).toThrow(InvalidCollectionError);
  });
});

describe('milk-bill.state machine + net computation', () => {
  it('draft→previewed→approved→paid; pay only from approved', () => {
    expect(canTransition('draft', 'previewed')).toBe(true);
    expect(canTransition('previewed', 'approved')).toBe(true);
    expect(canTransition('approved', 'paid')).toBe(true);
    expect(canTransition('draft', 'paid')).toBe(false);
    expect(isTerminal('paid')).toBe(true);
    for (const s of BILL_STATUSES) expect(() => canTransition(s, 'paid' as BillStatus)).not.toThrow();
    expect(new IllegalBillTransitionError('paid', 'draft').code).toBe('BILL_ILLEGAL_TRANSITION');
  });
  it('net = gross − deductions; lifecycle emits the right events', () => {
    const b = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
      totalLitresMilli: 70000n, grossMinor: 48000n, deductions: [{ type: 'feed_credit', amountMinor: 5000n }, { type: 'loan_emi', amountMinor: 3000n }] });
    expect(b.toProps().deductionsMinor).toBe(8000n); expect(b.netMinor).toBe(40000n);
    b.pullEvents();
    b.preview(); b.approve(); b.markPaid();
    expect(b.status).toBe('paid');
    expect(b.pullEvents().map((e) => e.type)).toEqual([DairyEventType.BillPreviewed, DairyEventType.BillApproved, DairyEventType.BillPaid]);
  });
  it('rejects deductions exceeding gross, and pay before approval', () => {
    expect(() => MilkBill.generate({ id: 'b', tenantId: 't', membershipId: 'm', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 1n, grossMinor: 1000n, deductions: [{ type: 'x', amountMinor: 2000n }] })).toThrow(BillNotPayableError);
    const b = MilkBill.generate({ id: 'b', tenantId: 't', membershipId: 'm', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 1n, grossMinor: 1000n });
    expect(() => b.markPaid()).toThrow(BillNotPayableError);
  });
});
