// apps/web-tenant/src/features/dairy/calc.test.ts · pure unit tests for the dairy operator helpers.
import {
  parseScaled, roundDiv, previewCollectionMinor, validateCollection, validateRateCard, validateMcc,
  validateMembership, nextBillActions,
} from './calc';

describe('dairy/calc — float-free price preview', () => {
  it('parseScaled scales decimals to integers with no float', () => {
    expect(parseScaled('12.345', 3)).toBe(12345n);
    expect(parseScaled('4.2', 2)).toBe(420n);
    expect(parseScaled('8', 2)).toBe(800n);
    expect(() => parseScaled('1.2.3', 2)).toThrow();
  });

  it('roundDiv is half-up (matches server)', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);   // 2.5 → 3
    expect(roundDiv(4n, 2n)).toBe(2n);
    expect(roundDiv(101n, 100n)).toBe(1n);
  });

  it('two_axis price = fat + snf components, byte-identical to MilkRateCard.priceMinor', () => {
    // weight 10.000 kg, fat 4.00%, snf 8.00%, rateFat=300 (₹3/kg-fat minor), rateSnf=200
    // fat: round(10000 * 400 * 300 / 1e7) = round(1_200_000_000/1e7)=120
    // snf: round(10000 * 800 * 200 / 1e7) = round(1_600_000_000/1e7)=160
    const card = { pricingModel: 'two_axis' as const, ratePerKgFatMinor: '300', ratePerKgSnfMinor: '200', baseRatePerLitreMinor: null };
    expect(previewCollectionMinor(card, '10.000', '4.00', '8.00')).toBe('280');
  });

  it('fat_pooled ignores snf rate; base adds per-kg', () => {
    const card = { pricingModel: 'fat_pooled' as const, ratePerKgFatMinor: '300', ratePerKgSnfMinor: '999', baseRatePerLitreMinor: '50' };
    // fat: 120 ; base: round(10000*50/1000)=500 ; snf excluded → 620
    expect(previewCollectionMinor(card, '10.000', '4.00', '8.00')).toBe('620');
  });

  it('snf_pooled uses only snf + base', () => {
    const card = { pricingModel: 'snf_pooled' as const, ratePerKgFatMinor: '999', ratePerKgSnfMinor: '200', baseRatePerLitreMinor: null };
    expect(previewCollectionMinor(card, '10.000', '4.00', '8.00')).toBe('160');
  });
});

describe('dairy/calc — validators', () => {
  it('collection rejects bad weight/fat/date/shift', () => {
    expect(validateCollection({ weightKg: '0', fatPct: '4', snfPct: '8', collectedOn: '2026-06-20', shift: 'morning' })).toBe('weight');
    expect(validateCollection({ weightKg: '12.5', fatPct: '120', snfPct: '8', collectedOn: '2026-06-20', shift: 'morning' })).toBe('fat');
    expect(validateCollection({ weightKg: '12.5', fatPct: '4', snfPct: '8', collectedOn: 'bad', shift: 'morning' })).toBe('date');
    expect(validateCollection({ weightKg: '12.5', fatPct: '4', snfPct: '8', collectedOn: '2026-06-20', shift: 'noon' })).toBe('shift');
    expect(validateCollection({ weightKg: '12.5', fatPct: '4.2', snfPct: '8.5', collectedOn: '2026-06-20', shift: 'evening' })).toBeNull();
  });

  it('rate card requires the relevant rate per model + a valid date', () => {
    expect(validateRateCard({ animalType: 'cow', pricingModel: 'fat_pooled', effectiveFrom: '2026-06-01' })).toBe('rate');
    expect(validateRateCard({ animalType: 'cow', pricingModel: 'fat_pooled', ratePerKgFatMinor: '300', effectiveFrom: 'bad' })).toBe('effectiveFrom');
    expect(validateRateCard({ animalType: 'pig', pricingModel: 'two_axis', baseRatePerLitreMinor: '50', effectiveFrom: '2026-06-01' })).toBe('animalType');
    expect(validateRateCard({ animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '300', ratePerKgSnfMinor: '200', effectiveFrom: '2026-06-01' })).toBeNull();
    expect(validateRateCard({ animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '3.5', effectiveFrom: '2026-06-01' })).toBe('rate'); // float minor rejected
  });

  it('mcc + membership validators', () => {
    expect(validateMcc({ code: 'bad code!', defaultName: 'X' })).toBe('code');
    expect(validateMcc({ code: 'M1', defaultName: '' })).toBe('name');
    expect(validateMcc({ code: 'M1', defaultName: 'Anand MCC' })).toBeNull();
    const u = '00000000-0000-0000-0000-000000000001';
    expect(validateMembership({ farmerUserId: 'x', mccId: u, memberCode: 'C1', paymentCycle: 'weekly' })).toBe('farmer');
    expect(validateMembership({ farmerUserId: u, mccId: u, memberCode: 'C1', paymentCycle: 'never' })).toBe('cycle');
    expect(validateMembership({ farmerUserId: u, mccId: u, memberCode: 'C1', paymentCycle: 'weekly' })).toBeNull();
  });

  it('nextBillActions follows the state machine', () => {
    expect(nextBillActions('draft')).toEqual(['preview']);
    expect(nextBillActions('previewed')).toEqual(['approve']);
    expect(nextBillActions('disputed')).toEqual([]);   // [PC-56 HOTFIX-11] NAMED UPDATE (founder Q4-A): a disputed bill is answered first, never approved
    expect(nextBillActions('approved')).toEqual(['pay']);
    expect(nextBillActions('paid')).toEqual([]);
  });
});
