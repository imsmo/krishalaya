// PC-55 A2 · the cash rules. These are the guards that stand between a rider's cash and a wrong number.
import { canTransition, batchTotalMinor, expectedMatches, canReconcile } from '../domain/cod-remittance.rules';

describe('remittance transitions', () => {
  it('collected→deposited→reconciled; reconciled is terminal; cancel only pre-recon', () => {
    expect(canTransition('collected', 'deposited')).toBe(true);
    expect(canTransition('deposited', 'reconciled')).toBe(true);
    expect(canTransition('collected', 'reconciled')).toBe(false);   // cash cannot be verified before it is banked
    expect(canTransition('reconciled', 'cancelled')).toBe(false);   // a verified batch is history
    expect(canTransition('collected', 'cancelled')).toBe(true);
    expect(canTransition('deposited', 'cancelled')).toBe(true);
    expect(canTransition('cancelled', 'deposited')).toBe(false);
  });
});

describe('batchTotalMinor (Law 2 — bigint, never float)', () => {
  it('sums exactly at scales where floats break', () => {
    expect(batchTotalMinor([{ codMinor: 150000n }, { codMinor: 299999n }, { codMinor: 1n }]).toString()).toBe('450000');
    // 0.1+0.2 style drift is impossible with bigint minor units:
    expect(batchTotalMinor([{ codMinor: 10n }, { codMinor: 20n }]).toString()).toBe('30');
    // a billion-rupee day (₹1,00,00,00,000 = 1e11 minor) still exact — the Y10 scale bar
    expect(batchTotalMinor([{ codMinor: 100000000000n }, { codMinor: 1n }]).toString()).toBe('100000000001');
    expect(batchTotalMinor([]).toString()).toBe('0');
  });
});

describe('expectedMatches (stale-worksheet guard)', () => {
  it('absent expectation passes; exact match passes; any drift is refused', () => {
    expect(expectedMatches(undefined, 450000n)).toBe(true);
    expect(expectedMatches('450000', 450000n)).toBe(true);
    expect(expectedMatches('450001', 450000n)).toBe(false);   // one paisa off is still off
    expect(expectedMatches('45000', 450000n)).toBe(false);    // a dropped digit must never bank silently
  });
});

describe('canReconcile (maker ≠ checker)', () => {
  it('refuses the banker, allows a second human, and only from deposited', () => {
    expect(canReconcile('deposited', 'user-a', 'user-b')).toBe(true);
    expect(canReconcile('deposited', 'user-a', 'user-a')).toBe(false);  // cannot check your own cash
    expect(canReconcile('collected', 'user-a', 'user-b')).toBe(false);
    expect(canReconcile('reconciled', 'user-a', 'user-b')).toBe(false);
    expect(canReconcile('deposited', null, 'user-b')).toBe(true);       // created-as-deposited edge: still checkable
  });
});
