// modules/group-lots/__tests__/group-lot-domain.spec.ts · pure domain + settle math (no DB).
import { settleShares, parseQtyMilli, formatQtyMilli } from '../domain/settle';
import { canTransition, assertTransition, isTerminal } from '../domain/group-lot.state';
import { GroupLot } from '../domain/group-lot.entity';

describe('group-lots/settle — float-free proportional split', () => {
  it('parses + formats quantity as integer milli-units', () => {
    expect(parseQtyMilli('12.5')).toBe(12500n);
    expect(parseQtyMilli('100')).toBe(100000n);
    expect(formatQtyMilli(12500n)).toBe('12.500');
  });
  it('splits net proportionally and SUMS EXACTLY to net (zero-loss)', () => {
    // gross 100000 paise, 500 bps (5%) fee → fee 5000, net 95000. Pledges 1:1:1 → 31667/31667/31666? remainder to largest.
    const r = settleShares({ grossMinor: 100000n, coordinationFeeBps: 500, pledges: [
      { id: 'a', qtyMilli: 1000n }, { id: 'b', qtyMilli: 1000n }, { id: 'c', qtyMilli: 1000n },
    ] });
    expect(r.coordinationFeeMinor).toBe(5000n);
    expect(r.netMinor).toBe(95000n);
    const sum = r.shares.reduce((a, s) => a + s.shareMinor, 0n);
    expect(sum).toBe(95000n);                 // zero-loss
    expect(r.shares.map((s) => s.shareMinor).sort()).toEqual([31666n, 31667n, 31667n].sort());
  });
  it('weights shares by quantity', () => {
    const r = settleShares({ grossMinor: 90000n, coordinationFeeBps: 0, pledges: [
      { id: 'big', qtyMilli: 2000n }, { id: 'small', qtyMilli: 1000n },
    ] });
    const big = r.shares.find((s) => s.id === 'big')!.shareMinor;
    const small = r.shares.find((s) => s.id === 'small')!.shareMinor;
    expect(big).toBe(60000n); expect(small).toBe(30000n);
    expect(big + small).toBe(90000n);
  });
  it('zero pledged quantity → all zero shares (no divide-by-zero)', () => {
    const r = settleShares({ grossMinor: 1000n, coordinationFeeBps: 0, pledges: [{ id: 'a', qtyMilli: 0n }] });
    expect(r.shares[0].shareMinor).toBe(0n);
  });
});

describe('group-lots/state — lifecycle', () => {
  it('allows legal transitions, blocks illegal, marks terminals', () => {
    expect(canTransition('pledging', 'ready')).toBe(true);
    expect(canTransition('pledging', 'sold')).toBe(false);
    expect(canTransition('sold', 'settled')).toBe(true);
    expect(() => assertTransition('settled', 'ready')).toThrow();
    expect(isTerminal('settled')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('pledging')).toBe(false);
  });
});

describe('group-lots/entity — pledge guards + progress', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  // A lot is CREATED with a future deadline (11c refuses a past one at create); a lot whose deadline has since passed is
  // rehydrated as the database would hand it back.
  function lot(deadline: string) {
    const g = GroupLot.create({ id: 'g1', tenantId: 't1', coordinatorUserId: 'u1', productId: 'p1', targetQuantity: '100.000', unitCode: 'kg', pledgeDeadline: future, coordinationFeeBps: 0 });
    return deadline === future ? g : GroupLot.rehydrate({ ...g.toProps(), pledgeDeadline: deadline });
  }
  it('accumulates pledges + computes progress bps', () => {
    const g = lot(future);
    g.applyPledge(parseQtyMilli('25'), new Date());
    g.applyPledge(parseQtyMilli('25'), new Date());
    expect(g.serialize().pledgedQuantity).toBe('50.000');
    expect(g.pledgeProgressBps()).toBe(5000);   // 50%
  });
  it('rejects a pledge after the deadline', () => {
    expect(() => lot(past).applyPledge(parseQtyMilli('1'), new Date())).toThrow();
  });
  it('rejects a pledge once not pledging', () => {
    const g = lot(future); g.markReady(new Date(), 'listing at what we have');
    expect(() => g.applyPledge(parseQtyMilli('1'), new Date())).toThrow();
  });
});
