// PC-55 A8 · dividend arithmetic. This splits a co-op's own money between its members after they voted for it,
// so the tests below are about the two properties a member would check: nothing is lost, and it is reproducible.
import { parseFormula, allocate, allocationsSumTo, canConfirmRun, resolutionPayable } from '../domain/coop-payout.rules';

const members = (n: number, basis?: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${String(i).padStart(3, '0')}`, basisMinor: basis?.(i) }));

describe('parseFormula (a vote must say what it means)', () => {
  it('accepts the two real modes with a positive pot', () => {
    expect(parseFormula({ mode: 'equal_split', potMinor: '100000' })).toEqual({ ok: true, value: { mode: 'equal_split', potMinor: '100000' } });
    expect(parseFormula({ mode: 'patronage_pro_rata', potMinor: '1' }).ok).toBe(true);
  });
  it('refuses a missing mode, an unknown mode, a zero pot and a non-minor pot', () => {
    expect(parseFormula({ potMinor: '100' }).ok).toBe(false);
    expect(parseFormula({ mode: 'vibes', potMinor: '100' }).ok).toBe(false);
    expect(parseFormula({ mode: 'equal_split', potMinor: '0' }).ok).toBe(false);
    expect(parseFormula({ mode: 'equal_split', potMinor: '100.50' }).ok).toBe(false);
  });
});

describe('allocate — THE PAISA INVARIANT (Σ parts === pot, always)', () => {
  it('equal_split distributes an indivisible pot without losing a paisa', () => {
    const f = { mode: 'equal_split' as const, potMinor: '10000' };   // ₹100 among 3 members
    const out = allocate(f, members(3));
    expect(allocationsSumTo(out, f.potMinor)).toBe(true);
    expect(out.map((o) => o.amountMinor).sort()).toEqual(['3333', '3333', '3334']);  // remainder handed out, not dropped
  });
  it('holds for a nasty prime split across many members', () => {
    const f = { mode: 'equal_split' as const, potMinor: '1000003' };
    const out = allocate(f, members(97));
    expect(allocationsSumTo(out, f.potMinor)).toBe(true);
  });
  it('patronage_pro_rata weights by each member\'s own business and still sums exactly', () => {
    const f = { mode: 'patronage_pro_rata' as const, potMinor: '100000' };
    const out = allocate(f, [
      { userId: 'a', basisMinor: '300000' },   // 3x
      { userId: 'b', basisMinor: '100000' },   // 1x
      { userId: 'c', basisMinor: '100000' },   // 1x
    ]);
    expect(allocationsSumTo(out, f.potMinor)).toBe(true);
    const byUser = Object.fromEntries(out.map((o) => [o.userId, o.amountMinor]));
    expect(byUser.a).toBe('60000');            // 3/5 of ₹1000
    expect(byUser.b).toBe('20000');
    expect(byUser.c).toBe('20000');
  });
  it('is DETERMINISTIC — the same inputs always produce the same split (a re-run cannot pay differently)', () => {
    const f = { mode: 'equal_split' as const, potMinor: '10007' };
    const a = allocate(f, members(11));
    const b = allocate(f, members(11));
    expect(a).toEqual(b);
  });
  it('a member with zero business gets zero — and is reported, not silently paid', () => {
    const f = { mode: 'patronage_pro_rata' as const, potMinor: '10000' };
    const out = allocate(f, [{ userId: 'a', basisMinor: '10000' }, { userId: 'z', basisMinor: '0' }]);
    expect(Object.fromEntries(out.map((o) => [o.userId, o.amountMinor])).z).toBe('0');
    expect(allocationsSumTo(out, f.potMinor)).toBe(true);
  });
  it('nobody has any business → nothing is invented (all zero, no crash)', () => {
    const out = allocate({ mode: 'patronage_pro_rata', potMinor: '10000' }, [{ userId: 'a', basisMinor: '0' }]);
    expect(out).toEqual([{ userId: 'a', amountMinor: '0' }]);
  });
  it('stays exact at co-op scale (₹1 crore across 15,000 members)', () => {
    const f = { mode: 'equal_split' as const, potMinor: '1000000000' };
    const out = allocate(f, members(15000));
    expect(allocationsSumTo(out, f.potMinor)).toBe(true);
  });
});

describe('the two human guards', () => {
  it('maker cannot be checker', () => {
    expect(canConfirmRun('officer-a', 'officer-b')).toBe(true);
    expect(canConfirmRun('officer-a', 'officer-a')).toBe(false);
  });
  it('only an activated dividend/patronage resolution pays', () => {
    expect(resolutionPayable('activated', 'dividend')).toEqual({ ok: true, purpose: 'dividend' });
    expect(resolutionPayable('closed', 'patronage_bonus').ok).toBe(true);
    expect(resolutionPayable('open', 'dividend').ok).toBe(false);        // the vote is still running
    expect(resolutionPayable('draft', 'dividend').ok).toBe(false);
    expect(resolutionPayable('activated', 'agm_vote').ok).toBe(false);   // an AGM vote is not a payment
    expect(resolutionPayable('activated', 'board_election').ok).toBe(false);
  });
});
