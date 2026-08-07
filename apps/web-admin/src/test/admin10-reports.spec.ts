// apps/web-admin/src/test/admin10-reports.spec.ts · PC-56 ADMIN-10 console spec.
//
// The dashboard is the screen an operator GLANCES at, which makes it the screen where a wrong number does the most
// damage. Four assertions carry the weight:
//
//   * a figure with no source never renders as zero, and `hasValue` is what stops it;
//   * "nothing to compare with" and "no change" are different sentences;
//   * an empty ALERT panel says whether nothing is wrong or nothing is being checked;
//   * the money block is withheld without withholding the page — the permission split W001 describes.
import {
  alertStackClass, alertStackKey, bpsToPercent, bucketKey, deliveryKey, deltaClass, deltaKey, figureClass, figureKey,
  freshnessClass, freshnessKey, hasValue, isMoneyMetric, isStreamBacked, metricKey, mismatchClass, mismatchKey,
  rangeTooLong, receiptComplete, replicaClass, replicaKey, revenueStateKey, truncatedKey, watermarkKey,
  type Delta, type Figure,
} from '../features/reports/dashboard';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;
const fig = (o: Partial<Figure> = {}): Figure => ({ basis: 'computed', value: '42', ...o });

describe('ADMIN-10 · a tile never prints a number it does not have', () => {
  it('renders a value only when one was computed', () => {
    expect(hasValue(fig())).toBe(true);
    expect(hasValue(fig({ basis: 'unavailable', value: null }))).toBe(false);
    expect(hasValue(fig({ basis: 'partial_window', value: null }))).toBe(false);
    expect(hasValue(null)).toBe(false);
    // The specific mistake this guards: a `null` value rendered by a template becomes the string "null" on screen.
    expect(hasValue(fig({ value: null }))).toBe(false);
    // **TWO CONDITIONS NEED A CASE EACH — and this one survived a mutation until it was written.** Deleting the
    // `basis === 'computed'` check passed every test above, because every non-computed fixture also had a null value.
    // A figure that carries a number under a non-computed basis is exactly what must NOT be printed: the backend may
    // one day return a partial figure with a provisional value, and the tile would render it as fact.
    expect(hasValue({ basis: 'partial_window', value: '99' })).toBe(false);
    expect(hasValue({ basis: 'unavailable', value: '0' })).toBe(false);
  });

  it('has a different sentence for absent, partial and unreadable', () => {
    const keys = new Set([
      figureKey(fig({ basis: 'unavailable' })),
      figureKey(fig({ basis: 'partial_window' })),
      figureKey(null),
    ]);
    expect(keys.size).toBe(3);
    for (const k of keys) expect(dict[k]).toBeTruthy();
  });

  it('draws an absent figure muted rather than alarming', () => {
    // A missing source is not an incident. A PARTIAL window is closer to one — the tile is live and cannot answer yet.
    expect(figureClass(fig({ basis: 'unavailable' }))).toContain('is-muted');
    expect(figureClass(fig({ basis: 'partial_window' }))).toContain('is-warn');
    expect(figureClass(fig())).not.toContain('is-warn');
  });
});

describe('ADMIN-10 · deltas', () => {
  const d = (o: Partial<Delta> = {}): Delta => ({ kind: 'up', bps: 820, comparedWith: 'last week', ...o });

  it('formats basis points as one decimal, without floats', () => {
    expect(bpsToPercent(820)).toBe('8.2');
    expect(bpsToPercent(5)).toBe('0.0');
    expect(bpsToPercent(10_000)).toBe('100.0');
    expect(bpsToPercent(-250)).toBe('-2.5');
  });

  // **"NOTHING TO COMPARE WITH" IS NOT "NO CHANGE".** On the platform's first day the second is a claim.
  it('separates no-baseline from flat, and both from a reasoned refusal', () => {
    expect(deltaKey(d({ kind: 'flat', bps: 0 }))).toBe('rp.delta.flat');
    expect(deltaKey(d({ kind: 'no_baseline' }))).toBe('rp.delta.noBaseline');
    // The active-tenant delta: there IS a baseline conceptually and this platform cannot compute it, which is a third
    // sentence again — the tile says why rather than implying nothing happened.
    expect(deltaKey(d({ kind: 'no_baseline', unavailableReason: 'nothing snapshots tenants.status' })))
      .toBe('rp.delta.cannotCompare');
    expect(dict['rp.delta.cannotCompare']).toMatch(/\{reason\}/);
  });

  it('colours a rise and a fall and leaves the rest neutral', () => {
    expect(deltaClass(d({ kind: 'up' }))).toContain('is-up');
    expect(deltaClass(d({ kind: 'down' }))).toContain('is-down');
    expect(deltaClass(d({ kind: 'flat' }))).not.toContain('is-up');
    expect(deltaClass(d({ kind: 'no_baseline' }))).toContain('is-muted');
  });
});

describe('ADMIN-10 · freshness', () => {
  it('names the cached case loudly and the live case plainly', () => {
    expect(freshnessKey({ kind: 'live', asOf: 'x' })).toBe('rp.fresh.asOf');
    expect(freshnessKey({ kind: 'cached', asOf: 'x', reason: 'y' })).toBe('rp.fresh.cached');
    expect(freshnessClass({ kind: 'cached' })).toContain('is-warn');
    expect(freshnessClass({ kind: 'unavailable' })).toContain('is-danger');
    // W001's error state, verbatim in spirit: keep the figures, name the moment they were true.
    expect(dict['rp.fresh.cached']).toMatch(/CACHED FIGURES from \{at\}/);
  });

  // **THE WORD "LIVE" IS A CLAIM.** W001 labels its lifecycle band "(live)" and offers a "Live revenue ticker".
  it('does not call a point-in-time read live', () => {
    expect(isStreamBacked()).toBe(false);
    expect(dict['rp.lifecycle.pointInTime']).toMatch(/not a stream/);
  });
});

describe('ADMIN-10 · the alert stack', () => {
  // **THE MOST DANGEROUS MISREADING ON THE PAGE.** An empty alert panel reads as "all clear"; here it means the checks
  // are not wired, and the two must not look the same.
  it('distinguishes "nothing is wrong" from "nothing is being checked"', () => {
    expect(alertStackKey(0, 0)).toBe('rp.alerts.clear');
    expect(alertStackKey(0, 3)).toBe('rp.alerts.noneComputable');
    expect(alertStackKey(2, 3)).toBe('rp.alerts.some');
    expect(alertStackClass(0, 0)).toContain('is-ok');
    expect(alertStackClass(0, 3)).toContain('is-warn');
    expect(alertStackClass(1, 0)).toContain('is-danger');
    expect(dict['rp.alerts.noneComputable']).toMatch(/not because everything is well/);
  });
});

describe('ADMIN-10 · the revenue gate W001 describes', () => {
  it('withholds the money without withholding the page', () => {
    expect(revenueStateKey(true)).toBe('rp.revenue.visible');
    expect(revenueStateKey(false)).toBe('rp.revenue.gated');
    // The copy tells the operator what to ask for — and that they already have access to the screen, which is exactly
    // W001's restricted state ("Your role (Ops · L2) can't view platform revenue").
    expect(dict['rp.revenue.gated']).toMatch(/\{perm\}/);
    expect(dict['rp.revenue.gated']).toMatch(/you already have that/);
  });
});

describe('ADMIN-10 · W111 · the builder', () => {
  it('labels every whitelisted metric and bucket, and an unknown one visibly', () => {
    for (const m of ['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor']) {
      expect(dict[metricKey(m)]).toBeTruthy();
    }
    expect(metricKey('secret_table')).toBe('rp.metric.other');
    for (const b of ['day', 'week', 'month']) expect(dict[bucketKey(b)]).toBeTruthy();
    expect(bucketKey('fortnight')).toBe('rp.bucket.other');
  });

  it('knows which metrics are money, so a GMV is not printed as a count', () => {
    expect(isMoneyMetric('gmv_minor')).toBe(true);
    expect(isMoneyMetric('dbt_minor')).toBe(true);
    expect(isMoneyMetric('orders')).toBe(false);
  });

  // **THE CLAIM W111 MAKES THAT IS FALSE.** One pool, on the primary; the console says so and the sentence is chosen by
  // the payload's fact rather than by the copy, so it changes when a replica lands.
  it('says which server answers, and warns when it is the primary', () => {
    expect(replicaKey(false)).toBe('rp.builder.primary');
    expect(replicaKey(true)).toBe('rp.builder.replica');
    expect(replicaClass(false)).toContain('is-warn');
    expect(replicaClass(true)).not.toContain('is-warn');
    expect(dict['rp.builder.primary']).toMatch(/competes with live traffic/);
  });

  it('checks the range client-side without pretending to be the control', () => {
    expect(rangeTooLong('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z', 92)).toBe(true);
    expect(rangeTooLong('2026-06-01T00:00:00Z', '2026-07-12T00:00:00Z', 92)).toBe(false);
    // A malformed or backwards range is NOT reported as "too long" — the server's message is the accurate one and this
    // must not pre-empt it with a wrong reason.
    expect(rangeTooLong('nonsense', '2026-07-12T00:00:00Z', 92)).toBe(false);
    expect(rangeTooLong('2026-07-12T00:00:00Z', '2026-06-01T00:00:00Z', 92)).toBe(false);
  });

  it('explains why a saved window is relative', () => {
    expect(dict['rp.saved.windowHelp']).toMatch(/wrong the day after it is saved/);
  });
});

describe('ADMIN-10 · the receipt law, on screen', () => {
  const r = {
    id: 'r1', report: 'builder:gmv_minor', generatedAt: '2026-08-07T10:00:00Z', rowCount: 14, truncated: false,
    fileName: 'gmv.csv', contentSha256: 'a'.repeat(64), digestBasis: 'data', watermarked: true, generatedBy: 'op-1',
  };

  // W2127 enumerates five fields. A receipt missing one does not answer the question it exists for.
  it('checks every field W2127 names', () => {
    expect(receiptComplete(r)).toBe(true);
    for (const missing of ['fileName', 'contentSha256', 'generatedAt', 'generatedBy'] as const) {
      expect(receiptComplete({ ...r, [missing]: undefined })).toBe(false);
    }
    expect(receiptComplete({ ...r, rowCount: undefined })).toBe(false);
    // Zero rows is a complete receipt for an empty result — `rowCount: 0` must not read as missing.
    expect(receiptComplete({ ...r, rowCount: 0 })).toBe(true);
  });

  // These four keys are COMPUTED at runtime, so the i18n catalogue test cannot see them — it checks literal keys in the
  // source. A prefix typo here (`rp.export.` for `rp.exports.`) rendered four labels as raw key strings and no existing
  // test noticed. Asserting `dict[...]` for every computed key is the cheapest way to close that hole.
  it('says whether the file is the whole answer', () => {
    expect(truncatedKey(true)).toBe('rp.exports.truncated');
    expect(dict[truncatedKey(true)]).toMatch(/not the whole answer/);
    expect(dict[truncatedKey(false)]).toBeTruthy();
  });

  // **THE HALF ADMIN-5c WROTE AND NOTHING CALLED.** The console reports it per file, so a run of unstamped rows is
  // visible rather than needing a grep.
  it('reports whether the artefact itself is stamped', () => {
    expect(watermarkKey(true)).toBe('rp.exports.watermarked');
    expect(watermarkKey(false)).toBe('rp.exports.notWatermarked');
    expect(dict[watermarkKey(false)]).toBe('NOT STAMPED');
  });

  it('tells the truth about the queue W2126 promises', () => {
    expect(deliveryKey(false)).toBe('rp.exports.sync');
    expect(dict['rp.exports.sync']).toMatch(/there is no queue/);
    expect(dict['rp.exports.sync']).toMatch(/ADMIN-10-Q1/);
  });

  // The one number that makes a receipt worth having.
  it('makes a digest mismatch the loudest thing on the page', () => {
    expect(mismatchKey(0)).toBe('rp.exports.noMismatch');
    expect(mismatchKey(1)).toBe('rp.exports.mismatch');
    expect(mismatchClass(1)).toContain('is-danger');
    expect(mismatchClass(0)).toContain('is-ok');
    expect(dict['rp.exports.mismatch']).toMatch(/the one thing a receipt exists to catch/);
  });

  it('does not let an empty receipt list read as a clean history', () => {
    expect(dict['rp.exports.empty.body']).toMatch(/not that nothing was ever exported/);
  });
});
