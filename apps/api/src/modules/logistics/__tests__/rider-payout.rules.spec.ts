// PC-55 A7 · rider earnings. This is a delivery partner's income, so every case below is one where getting it
// wrong would underpay a working person or silently change what past work was worth.
import { termsForDate, bpsOf, earnFor, buildStatement } from '../domain/rider-payout.rules';

const T = (over: Partial<Parameters<typeof earnFor>[1]> = {}) => ({
  id: 't-default', riderUserId: null as string | null, termsName: 'Standard', effectiveFrom: '2026-08-01',
  perDropMinor: '2000', pctOfChargeBps: 0, codHandlingMinor: '0', failedAttemptMinor: '0', currencyCode: 'INR', ...over,
});
const S = (over: Partial<Parameters<typeof earnFor>[0]> = {}) => ({
  id: 's1', status: 'delivered', deliveredOn: '2026-08-10', chargeMinor: '5000', codMinor: null as string | null, ...over,
});

describe('termsForDate (work already done keeps its own price)', () => {
  const series = [T({ id: 'old', effectiveFrom: '2026-07-01', perDropMinor: '1500' }), T({ id: 'new', effectiveFrom: '2026-08-01', perDropMinor: '2000' })];
  it('prices a delivery with the terms in force ON ITS DATE, not the latest ones', () => {
    expect(termsForDate(series, 'u1', '2026-07-15')?.id).toBe('old');   // July work keeps July's rate
    expect(termsForDate(series, 'u1', '2026-08-05')?.id).toBe('new');
  });
  it('returns null before any terms existed (never a silent zero)', () => {
    expect(termsForDate(series, 'u1', '2026-06-30')).toBeNull();
  });
  it("a rider's personal deal always beats the tenant default, even an older one", () => {
    const withPersonal = [...series, T({ id: 'mine', riderUserId: 'u1', effectiveFrom: '2026-07-20', perDropMinor: '3000' })];
    expect(termsForDate(withPersonal, 'u1', '2026-08-10')?.id).toBe('mine');
    expect(termsForDate(withPersonal, 'u2', '2026-08-10')?.id).toBe('new');   // another rider gets the default
  });
  it('ignores future-dated terms', () => {
    const future = [...series, T({ id: 'later', effectiveFrom: '2026-09-01', perDropMinor: '9000' })];
    expect(termsForDate(future, 'u1', '2026-08-10')?.id).toBe('new');
  });
});

describe('bpsOf (never invent a paisa the customer did not pay)', () => {
  it('floors the share and handles the full range', () => {
    expect(bpsOf('5000', 1000).toString()).toBe('500');       // 10% of ₹50 = ₹5
    expect(bpsOf('5000', 10000).toString()).toBe('5000');     // 100%
    expect(bpsOf('5000', 0).toString()).toBe('0');
    expect(bpsOf('999', 1000).toString()).toBe('99');         // 99.9 → floored to 99, never rounded up
    expect(() => bpsOf('50.00', 1000)).toThrow();             // refuses a non-minor figure
  });
});

describe('earnFor (what one shipment is worth)', () => {
  it('a delivered drop earns per-drop + charge share + COD handling when applicable', () => {
    const line = earnFor(S({ codMinor: '30000' }), T({ pctOfChargeBps: 2000, codHandlingMinor: '500' }));
    expect(line).toMatchObject({ outcome: 'delivered', perDropMinor: '2000', shareMinor: '1000', codHandlingMinor: '500', totalMinor: '3500' });
  });
  it('pays NO cod-handling when the drop carried no cash', () => {
    const line = earnFor(S({ codMinor: null }), T({ codHandlingMinor: '500' }));
    expect(line?.codHandlingMinor).toBe('0');
    expect(line?.totalMinor).toBe('2000');
  });
  it('a genuine failed attempt earns only the attempt fee — never the per-drop or the share', () => {
    const line = earnFor(S({ status: 'failed', deliveredOn: null, attemptedOn: '2026-08-10' }), T({ pctOfChargeBps: 2000, failedAttemptMinor: '500' }));
    expect(line).toMatchObject({ outcome: 'failed', perDropMinor: '0', shareMinor: '0', totalMinor: '500' });
  });
  it('in-flight work is not yet earnings', () => {
    expect(earnFor(S({ status: 'out_for_delivery' }), T())).toBeNull();
  });
});

describe('buildStatement', () => {
  it('sums exactly and reports UNPRICED work instead of hiding it as zero', () => {
    const terms = [T({ effectiveFrom: '2026-08-01' })];
    const st = buildStatement([
      S({ id: 'a', deliveredOn: '2026-08-05' }),
      S({ id: 'b', deliveredOn: '2026-08-06' }),
      S({ id: 'c', deliveredOn: '2026-07-20' }),           // before any terms existed
    ], terms, 'u1');
    expect(st.deliveredCount).toBe(2);
    expect(st.totalMinor).toBe('4000');
    expect(st.unpriced).toEqual([{ shipmentId: 'c', dateIso: '2026-07-20', reason: 'no_terms_effective' }]);
  });
  it('stays exact across a heavy month (integer minor units, where floats would drift)', () => {
    const terms = [T({ perDropMinor: '2333', pctOfChargeBps: 733 })];
    const ships = Array.from({ length: 300 }, (_, i) => S({ id: `s${i}`, chargeMinor: '4999' }));
    const st = buildStatement(ships, terms, 'u1');
    // per drop: 2333 + floor(4999*733/10000)=366 → 2699 × 300
    expect(st.totalMinor).toBe((2699 * 300).toString());
  });
});
