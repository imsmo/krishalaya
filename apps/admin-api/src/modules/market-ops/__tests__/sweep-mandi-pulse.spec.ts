// modules/market-ops/__tests__/sweep-mandi-pulse.spec.ts · PC-56 ADMIN-SWEEP.
//
// W107's tile row had one figure with no source and one sentence with no code. This file holds down both:
//   • "Ingest lag (p95) · 41 min" — `mandi_prices` had no arrival timestamp at all, so the figure is NULL before 0124
//     and the console must say "not measurable" rather than show a flattering zero;
//   • "bad data never reaches a selling decision" — the quarantine, and what releasing one does and does not do.
import {
  RELEASE_DOES_NOT_BACKFILL_ALERTS, canDecide, decidedNoticeKey, guardStateKey, humanEnteredShare,
  ingestLagP95Minutes, lagClass, lagKey, severityClass, severityKey, sourceShares, stalenessKey,
} from '../domain/mandi-pulse';

describe('ADMIN-SWEEP · the ingest lag that had no source', () => {
  it('computes a nearest-rank p95 a human can reproduce', () => {
    // Nearest rank, not interpolation: with 20 samples the p95 is the 19th, which somebody can check by counting.
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(ingestLagP95Minutes(xs)).toBe(19);
    expect(ingestLagP95Minutes([41])).toBe(41);
    expect(ingestLagP95Minutes([10, 20, 30, 40])).toBe(40);
  });

  // **NULL, NOT ZERO.** `mandi_prices` had no `created_at` (add_std_columns was never called on it), so before 0124 this
  // figure was unanswerable rather than wrong — and 0124 deliberately does not backfill, because deriving an arrival
  // time from `price_date` would fabricate the exact number the column exists to measure.
  it('returns null for a window with nothing stamped, and the console says so', () => {
    expect(ingestLagP95Minutes([])).toBeNull();
    expect(lagKey(null)).toBe('mp11.lag.noSource');
    // Unknown is a WARNING: a platform that cannot tell how fresh its price intelligence is has a worse problem than a
    // slow one.
    expect(lagClass(null)).toContain('is-warn');
  });

  it('drops nonsense samples rather than letting one poison the percentile', () => {
    expect(ingestLagP95Minutes([Number.NaN, -5, 10])).toBe(10);
  });

  it('reads the target the canon states', () => {
    expect(lagKey(41)).toBe('mp11.lag.withinTarget');
    expect(lagKey(61)).toBe('mp11.lag.overTarget');
    expect(lagClass(41)).not.toContain('is-warn');
    expect(lagClass(61)).toContain('is-warn');
  });
});

describe('ADMIN-SWEEP · the source mix is a risk measure', () => {
  const mix = [
    { source: 'agmarknet', n: 61 }, { source: 'enam', n: 22 },
    { source: 'platform_txn', n: 12 }, { source: 'ambassador_manual', n: 5 },
  ];

  it('turns counts into whole-percent shares', () => {
    expect(sourceShares(mix).map((s) => s.pct)).toEqual([61, 22, 12, 5]);
  });

  it('does not divide by zero on an empty day', () => {
    expect(sourceShares([{ source: 'agmarknet', n: 0 }])).toEqual([{ source: 'agmarknet', n: 0, pct: 0 }]);
    expect(sourceShares([])).toEqual([]);
  });

  // **THE NUMBER THE CANON DOES NOT PUT ON A TILE.** Manual entry is where a typo comes from, so the share of today's
  // price intelligence that a human typed is the figure an operator should watch.
  it('isolates the human-entered share', () => {
    expect(humanEnteredShare(mix)).toBe(5);
    expect(humanEnteredShare([{ source: 'agmarknet', n: 100 }])).toBe(0);
  });
});

describe('ADMIN-SWEEP · the quarantine', () => {
  it('ranks an order-of-magnitude typo above a merely odd price', () => {
    expect(severityKey(90_000)).toBe('mp11.sev.extreme');   // a 10× entry
    expect(severityKey(6_000)).toBe('mp11.sev.high');
    expect(severityKey(2_500)).toBe('mp11.sev.moderate');
    expect(severityClass(90_000)).toContain('is-danger');
    expect(severityClass(2_500)).toContain('is-warn');
  });

  it('treats an unknown deviation as a warning rather than as nothing', () => {
    expect(severityKey(null)).toBe('mp11.sev.unknown');
    expect(severityClass(null)).toContain('is-warn');
  });

  it('offers a decision only on a held observation', () => {
    expect(canDecide('quarantined')).toBe(true);
    expect(canDecide('released')).toBe(false);
    expect(canDecide('rejected')).toBe(false);
    // An accepted observation was never held; there is nothing to decide.
    expect(canDecide('accepted')).toBe(false);
    // A state this code cannot describe is not decidable.
    expect(canDecide('pending')).toBe(false);
  });

  it('says what happened instead of showing a blank on a decided row', () => {
    expect(decidedNoticeKey('quarantined')).toBeNull();
    expect(decidedNoticeKey('released')).toBe('mp11.decided.released');
    expect(decidedNoticeKey('rejected')).toBe('mp11.decided.rejected');
    expect(decidedNoticeKey('accepted')).toBe('mp11.decided.notHeld');
  });

  it('names the refusal that releasing does NOT backfill alerts', () => {
    // An alert saying "groundnut crossed your threshold" nine hours late, after the mandi has closed, invites a farmer
    // to act on a window that has shut — worse than no alert. The queue's job is to be fast, not to time-travel.
    expect(RELEASE_DOES_NOT_BACKFILL_ALERTS).toBe('mp11.release.noBackfill');
  });

  // **AN EMPTY QUEUE MEANS TWO OPPOSITE THINGS**, and the manual share is what tells them apart: clean data, or a gate
  // that is not gating. Before this wave the second was always the answer, because nothing gated anything.
  it('distinguishes "nothing held" from "nothing gated"', () => {
    expect(guardStateKey(3, 5)).toBe('mp11.guard.holding');
    expect(guardStateKey(0, 5)).toBe('mp11.guard.noneHeldWithManual');
    expect(guardStateKey(0, 0)).toBe('mp11.guard.noManual');
  });
});

describe('ADMIN-SWEEP · staleness is day-granular and says so', () => {
  it('grades a mandi by how many dates it has been silent', () => {
    expect(stalenessKey(0)).toBe('mp11.stale.fresh');
    expect(stalenessKey(1)).toBe('mp11.stale.fresh');
    expect(stalenessKey(2)).toBe('mp11.stale.stale');
    expect(stalenessKey(6)).toBe('mp11.stale.severe');
  });
});
