// apps/web-storefront/src/test/store6-stale-tiers.spec.ts · PC-56 STORE-6a · D5 (survey B9 / F-9) — THE "AS OF" TIERS, AT EVERY BOUNDARY.
// fresh < 15 min ≤ aging ≤ 1 h < prominent ≤ 24 h < full; unreadable → fresh (the port's "unknown ≠ old"); the money tint starts with
// `prominent` — exactly where the drift-pinned port's `isStale` (> 1 h) starts, so the two never disagree; `bandState` (the band's inline script,
// embedded by its text) agrees with `tierOf` everywhere and shows offline always, online only past fresh. Mutant M6 (`tierOf` says fresh at
// 2 h) turns this red.
import { bandState, moneyStale, tierOf, FULL_MS, PROMINENT_MS, QUIET_MS } from '../features/store6/stale-tiers';
import { STALE_AFTER_MS, isStale } from '../features/offline/stale';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000; const H = 60 * MIN;

describe('STORE-6a · D5 · tierOf', () => {
  it.each([
    [0, 'fresh'], [14 * MIN, 'fresh'], [15 * MIN - 1, 'fresh'], [15 * MIN, 'aging'], [59 * MIN, 'aging'], [H, 'aging'],
    [H + 1, 'prominent'], [2 * H, 'prominent'], [24 * H, 'prominent'], [24 * H + 1, 'full'], [3 * 24 * H, 'full'],
  ] as const)('%d ms old → %s', (age, tier) => {
    expect(tierOf(ago(age), NOW)).toBe(tier);
    expect(tierOf(NOW - age, new Date(NOW))).toBe(tier);                 // ms and Date inputs agree
    expect(bandState(ago(age), NOW, true).tier).toBe(tier);              // the embedded band agrees
  });
  it('the thresholds are the canon\'s (15 min, 1 h, 24 h); prominent starts where the port\'s isStale does', () => {
    expect([QUIET_MS, PROMINENT_MS, FULL_MS]).toEqual([15 * MIN, H, 24 * H]);
    expect(PROMINENT_MS).toBe(STALE_AFTER_MS);
    for (const age of [H - 1, H, H + 1, 2 * H, 30 * H]) {
      const money = ['prominent', 'full'].includes(tierOf(ago(age), NOW));
      expect([age, money]).toEqual([age, isStale(ago(age), new Date(NOW))]);
      expect([age, moneyStale(ago(age), new Date(NOW))]).toEqual([age, money]);
      expect([age, bandState(ago(age), NOW, true).money]).toEqual([age, money]);
    }
  });
  it('an unreadable instant is fresh (unknown ≠ old); the band hides without an instant', () => {
    for (const x of [null, undefined, '', 'not a date']) expect(tierOf(x as never, NOW)).toBe('fresh');
    expect(bandState(null, NOW, false).show).toBe(false);
  });
});

describe('STORE-6a · D5 · the band', () => {
  it('offline: ALWAYS shown (a page without signal says how old it is); online: only once no longer fresh', () => {
    expect(bandState(ago(MIN), NOW, false)).toEqual({ show: true, tier: 'fresh', minutes: 1, money: false });
    expect(bandState(ago(MIN), NOW, true).show).toBe(false);
    expect(bandState(ago(20 * MIN), NOW, true)).toEqual({ show: true, tier: 'aging', minutes: 20, money: false });
    expect(bandState(ago(2 * H), NOW, true)).toEqual({ show: true, tier: 'prominent', minutes: 120, money: true });
    expect(bandState(ago(26 * H), NOW, false)).toEqual({ show: true, tier: 'full', minutes: 26 * 60, money: true });
  });
});
