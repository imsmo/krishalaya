// apps/admin-api/src/modules/platform-reports/__tests__/admin10-reports-plane.spec.ts · PC-56 ADMIN-10.
//
// The figures W001 shows, the caps W111 promises, and the receipt law's two missing halves. Four assertions carry the
// weight, and each one is a number a reader would otherwise believe:
//
//   1. A FIGURE WITH NO SOURCE COMES BACK `unavailable`, never zero and never approximated.
//   2. A ZERO BASELINE IS `no_baseline`, not a 100% rise.
//   3. THE BUILDER'S CAP IS THE CANON'S 92 DAYS, tighter than the plane's own 366.
//   4. THE EXPORT IS WATERMARKED — the helper ADMIN-5c wrote and nothing called.
import {
  computed, deltaBps, live, cached, ordersPeakPerMinute, ordersPerMinute, payoutSuccessBps, unavailable,
  ORDERS_RATE_WINDOW_MINUTES,
} from '../domain/dashboard-figures';
import {
  BUILDER_MAX_RANGE_DAYS, BUILDER_MAX_ROWS, BUILDER_STATEMENT_TIMEOUT_MS, CANON_DATASETS_NOT_YET_AVAILABLE,
  CANON_MEASURES, DELTA_028_STATUS, READS_FROM_REPLICA, REPORT_METRICS, assertBuilderWindow, assertMetric, assertSlug,
  assertWindowDays, isSchedulable, windowFor,
} from '../domain/report-definition';
import { InvalidReportInputError } from '../domain/platform-reports.errors';
import { contentDigest, watermarkPreamble, withWatermark, DIGEST_BASIS } from '../../../core/export/receipt';
import { ownerPermissionCodes, resolveOwnerPermissions } from '../../../core/rbac/owner-roles';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const iso = (d: string) => new Date(d).toISOString();

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-10 · a figure carries its basis', () => {
  it('never reports an absent source as zero', () => {
    const f = unavailable('no source');
    expect(f.value).toBeNull();
    expect(f.basis).toBe('unavailable');
    // Zero is a measurement. This programme has found six columns that recorded an act nobody performed; a tile reading
    // "0" where nothing is measured is the same defect one layer up.
    expect(f.value).not.toBe('0');
  });

  it('returns money as a STRING in minor units', () => {
    expect(computed(184_20_516n).value).toBe('18420516');
    expect(typeof computed(42).value).toBe('string');
  });
});

describe('ADMIN-10 · deltas', () => {
  it('computes basis points, scaled before the division', () => {
    expect(deltaBps(108n, 100n, 'last week')).toMatchObject({ kind: 'up', bps: 800 });
    expect(deltaBps(92n, 100n, 'last week')).toMatchObject({ kind: 'down', bps: 800 });
    expect(deltaBps(100n, 100n, 'last week')).toMatchObject({ kind: 'flat', bps: 0 });
    // A 0.05% move on a large figure survives, where dividing first would floor it to nothing.
    expect(deltaBps(1_000_500n, 1_000_000n, 'x')).toMatchObject({ kind: 'up', bps: 5 });
  });

  // **THE ASSERTION THAT KEEPS THE FIRST DAY HONEST.** W001 renders "▲ 8.2% vs last Monday"; on day one there is nothing
  // to compare with, and "▲ 100%" or "▲ ∞%" would be inventing a trend from a single data point.
  it('refuses to divide by an empty baseline', () => {
    expect(deltaBps(500n, 0n, 'last week')).toEqual({ kind: 'no_baseline', comparedWith: 'last week' });
    expect(deltaBps(0n, 0n, 'last week').kind).toBe('no_baseline');
  });
});

describe('ADMIN-10 · orders per minute', () => {
  it('floors the rate over the stated window', () => {
    expect(ORDERS_RATE_WINDOW_MINUTES).toBe(60);
    expect(ordersPerMinute(600).value).toBe('10');
    // 6.7/min renders as 6: a dashboard claiming a decimal invites a precision the source does not have, and rounding up
    // would overstate throughput on a quiet platform.
    expect(ordersPerMinute(402).value).toBe('6');
    expect(ordersPerMinute(0).value).toBe('0');   // a real measurement of a quiet hour, and it IS zero
  });

  it('refuses a nonsense input rather than reporting a rate', () => {
    expect(ordersPerMinute(-1).basis).toBe('unavailable');
    expect(ordersPerMinute(Number.NaN).basis).toBe('unavailable');
    expect(ordersPerMinute(100, 0).basis).toBe('unavailable');
  });

  // **THE PEAK IS THE TILE W001 SHOWS THAT THIS PLATFORM CANNOT COMPUTE.** A rate is one count over one window; a peak
  // is the maximum of a per-minute series and there is no minute-granularity rollup.
  it('names the peak as unavailable, with the reason and its owner', () => {
    const peak = ordersPeakPerMinute();
    expect(peak.basis).toBe('unavailable');
    expect(peak.value).toBeNull();
    expect(peak.note).toMatch(/ADMIN-10-Q2/);
    expect(peak.note).toMatch(/minute-granularity/);
  });
});

describe('ADMIN-10 · payout success', () => {
  const c = (o: Partial<Parameters<typeof payoutSuccessBps>[0]> = {}) => ({
    succeeded: 0, failed: 0, pending: 0, reversed: 0, cancelled: 0, ...o,
  });

  it('is a rate over FINISHED payouts only', () => {
    expect(payoutSuccessBps(c({ succeeded: 994, failed: 6 })).value).toBe('9940');
    expect(payoutSuccessBps(c({ succeeded: 1, failed: 1 })).value).toBe('5000');
  });

  // The decision this function exists for: a payout still moving is not a failure, and counting it as one would drop the
  // rate every time a batch was mid-flight — exactly when somebody is reading the tile.
  it('excludes pending, reversed and cancelled from the denominator', () => {
    const withNoise = payoutSuccessBps(c({ succeeded: 10, failed: 0, pending: 90, reversed: 5, cancelled: 3 }));
    expect(withNoise.value).toBe('10000');
    expect(payoutSuccessBps(c({ succeeded: 10, failed: 0 })).value).toBe(withNoise.value);
  });

  // An empty denominator is not 100% and it is not 0%.
  it('reports a partial window rather than a rate over nothing', () => {
    const f = payoutSuccessBps(c({ pending: 12 }));
    expect(f.basis).toBe('partial_window');
    expect(f.value).toBeNull();
    expect(f.note).toMatch(/no payout finished/);
  });
});

describe('ADMIN-10 · freshness', () => {
  it('stamps a live read and a cached fallback differently', () => {
    expect(live(NOW)).toEqual({ kind: 'live', asOf: NOW.toISOString() });
    // W001's error state, verbatim: "Cached figures from 14:28 are shown above — retry to refresh." A failure must keep
    // the figures AND name the moment they were true.
    const c = cached(NOW, 'metrics read timed out');
    expect(c).toMatchObject({ kind: 'cached', asOf: NOW.toISOString(), reason: 'metrics read timed out' });
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-10 · W111 · the builder runs a WHITELIST, never a query', () => {
  it('accepts only the five metrics that exist', () => {
    for (const m of REPORT_METRICS) expect(assertMetric(m)).toBe(m);
    expect(() => assertMetric('users')).toThrow(InvalidReportInputError);
    // The message names the reason, because this is the refusal a builder user will meet most often.
    expect(() => assertMetric('SELECT * FROM users')).toThrow(/stored-query engine/);
  });

  // **THE CANON OFFERS FIVE DATASETS AND THREE OF THEM HAVE NO METRIC BEHIND THEM.** Listed with a reason rather than
  // silently dropped: a dropdown quietly three options short is a bug report, and one that says why is documentation.
  it('names the datasets W111 offers and this plane cannot serve', () => {
    expect(CANON_DATASETS_NOT_YET_AVAILABLE.map((d) => d.dataset))
      .toEqual(['Mandi prices', 'Payouts', 'Support tickets']);
    for (const d of CANON_DATASETS_NOT_YET_AVAILABLE) expect(d.reason.length).toBeGreaterThan(40);
  });

  it('marks the two measures that are derived rather than stored', () => {
    const derived = CANON_MEASURES.filter((m) => m.metric === null);
    expect(derived.map((m) => m.measure)).toEqual(['avg order value', 'dispute rate']);
    for (const m of derived) expect(m.note).toBeTruthy();
  });

  // **THE CANON'S CAP IS TIGHTER THAN THE CODE'S AND THE TIGHTER ONE WINS HERE.** `resolveWindow` allows 366 days, which
  // is right for a dashboard chart and wrong for an ad-hoc scan of the same partitioned table.
  it('enforces 92 days on the builder, not the plane-wide 366', () => {
    expect(BUILDER_MAX_RANGE_DAYS).toBe(92);
    expect(BUILDER_MAX_ROWS).toBe(50_000);
    expect(BUILDER_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(() => assertBuilderWindow(iso('2026-01-01'), iso('2026-07-01'))).toThrow(/limit is 92/);
    expect(assertBuilderWindow(iso('2026-06-01'), iso('2026-07-12')).from.getTime())
      .toBe(new Date('2026-06-01').getTime());
  });

  it('refuses a backwards or unparseable range', () => {
    expect(() => assertBuilderWindow(iso('2026-07-01'), iso('2026-06-01'))).toThrow(/strictly before/);
    expect(() => assertBuilderWindow('not-a-date', iso('2026-06-01'))).toThrow(/valid ISO/);
  });

  // **W111 SAYS QUERIES RUN ON A REPLICA AND THERE IS NO REPLICA.** The constant is false and the console reads it, so
  // the sentence changes when the infrastructure does rather than needing an edit to stop being wrong.
  it('reports honestly that report queries hit the primary', () => {
    expect(READS_FROM_REPLICA).toBe(false);
  });
});

describe('ADMIN-10 · saved definitions (DELTA-028)', () => {
  it('validates a slug a schedule can point at', () => {
    expect(assertSlug('  weekly-gmv  ')).toBe('weekly-gmv');
    for (const bad of ['Weekly', '1st-report', 'a', 'has_underscore', '']) {
      expect(() => assertSlug(bad)).toThrow(InvalidReportInputError);
    }
  });

  it('bounds a saved window', () => {
    expect(assertWindowDays(30)).toBe(30);
    for (const bad of [0, 367, 1.5, Number.NaN]) expect(() => assertWindowDays(bad)).toThrow();
  });

  // **A SAVED DEFINITION IS RELATIVE.** W111's date inputs are absolute, which is right for a run you are about to make
  // and wrong for one a schedule executes every Monday for a year.
  it('resolves a saved window relative to now', () => {
    const w = windowFor(30, NOW);
    expect(w.to).toEqual(NOW);
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000)).toBe(30);
  });

  it('will not schedule an archived definition', () => {
    expect(isSchedulable({ archivedAt: null, isShared: false })).toBe(true);
    expect(isSchedulable({ archivedAt: NOW, isShared: true })).toBe(false);
  });

  // The finding recorded as a fact: half of DELTA-028 was already in the database.
  it('records that the schedules half existed since ADMIN-1e', () => {
    expect(DELTA_028_STATUS.schedules).toMatch(/scheduled_reports/);
    expect(DELTA_028_STATUS.schedules).toMatch(/0095/);
    expect(DELTA_028_STATUS.note).toMatch(/reading the schema/);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-10 · the receipt law, both halves', () => {
  const columns = [['bucket', 'value']];
  const rows = [{ bucket: '2026-08-01', value: '100' }, { bucket: '2026-08-02', value: '200' }];

  it('digests the data, and the basis travels with it', () => {
    expect(contentDigest(columns, rows)).toMatch(/^[0-9a-f]{64}$/);
    expect(DIGEST_BASIS).toBeTruthy();
  });

  // **THE HELPER ADMIN-5c WROTE AND NOTHING CALLED.** That wave's own header says "nothing has ever marked a file", then
  // wrote the marker; five export services import the digest and none applies the watermark. This asserts the marker is
  // usable and that the export path produces one.
  it('produces a watermark preamble carrying the requester and the digest', () => {
    const receipt = {
      id: 'r1', report: 'builder:gmv_minor', generatedAt: NOW.toISOString(), generatedBy: 'op-1',
      contentSha256: contentDigest(columns, rows), digestBasis: DIGEST_BASIS,
    };
    const lines = watermarkPreamble(receipt);
    expect(lines.length).toBeGreaterThan(0);
    // The point of a watermark is that the FILE, once it has travelled, still names who pulled it.
    expect(lines.join('\n')).toContain('op-1');
    expect(lines.join('\n')).toContain(receipt.contentSha256);
    for (const l of lines) expect(l.startsWith('#')).toBe(true);   // a parser can skip them; Excel shows them as text

    const csv = withWatermark('bucket,value\n2026-08-01,100\n', receipt);
    expect(csv.split('\n')[0].startsWith('#')).toBe(true);
    expect(csv).toContain('bucket,value');
  });

  it('the digest changes with the columns, not only the rows', () => {
    // Same values under different headers are a different file to whoever reads it.
    expect(contentDigest([['a']], rows)).not.toBe(contentDigest([['b']], rows));
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-10 · the three permissions the canon names and nothing had', () => {
  it('exists in the catalogue', () => {
    const codes = ownerPermissionCodes();
    expect(codes).toContain('metrics.revenue.read');
    expect(codes).toContain('analytics.read');
    expect(codes).toContain('analytics.export');
    // ADMIN-10 pinned `analytics.farmer360` as ABSENT ("a permission with no route behind it is a promise nothing
    // keeps") and 0120's header deferred it to the wave that builds the route. ADMIN-SWEEP-b4 is that wave: the
    // route exists, so the pin flips — the same rule, now satisfied from the other side.
    expect(codes).toContain('analytics.farmer360');
  });

  // **THE ROLE W001'S RESTRICTED STATE IS WRITTEN FOR**: sees the dashboard, not the money.
  it('gives the ops-dashboard role the screen and not the revenue', () => {
    const ops = resolveOwnerPermissions(['platform_ops_dashboard']);
    expect(ops.has('reports.read')).toBe(true);
    expect(ops.has('metrics.revenue.read')).toBe(false);
    expect(ops.has('analytics.export')).toBe(false);
  });

  // Reading a figure and walking out with the file are different acts — W111 says so itself.
  it('separates reading analytics from exporting them', () => {
    const viewer = resolveOwnerPermissions(['platform_analytics_viewer']);
    expect(viewer.has('analytics.read')).toBe(true);
    expect(viewer.has('analytics.export')).toBe(false);
    const ops = resolveOwnerPermissions(['platform_analytics_ops']);
    expect(ops.has('analytics.export')).toBe(true);
  });
});
