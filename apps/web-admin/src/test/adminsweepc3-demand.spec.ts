// PC-56 ADMIN-SWEEP-c3 · demand map console logic — real geometry, relative tone, the same floors as the server.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EXPORT_REASON_MIN, buildExport, gapTone, heatBucket, projectCentroids, weekLabel } from '../features/analytics/demand-map';

describe('ADMIN-SWEEP-c3 · heat buckets are relative and the boundaries are exact', () => {
  it('tones against the page maximum in bigint-safe permille', () => {
    expect(heatBucket('1000', '1000')).toBe(4);
    expect(heatBucket('750', '1000')).toBe(4);
    expect(heatBucket('749', '1000')).toBe(3);
    expect(heatBucket('500', '1000')).toBe(3);
    expect(heatBucket('499', '1000')).toBe(2);
    expect(heatBucket('250', '1000')).toBe(2);
    expect(heatBucket('249', '1000')).toBe(1);
    expect(heatBucket('1', '1000')).toBe(1);
    expect(heatBucket('0', '1000')).toBe(0);
    expect(heatBucket('5', '0')).toBe(0);      // no maximum → nothing to be relative to
    expect(heatBucket('123456789012345678', '123456789012345678')).toBe(4);   // beyond Number-safe
  });
});

describe('ADMIN-SWEEP-c3 · centroid projection', () => {
  it('places districts relative to each other, north up, inside the padded frame', () => {
    const p = projectCentroids([
      { id: 'north-west', lat: 24, lng: 69 },
      { id: 'south-east', lat: 20, lng: 73 },
    ]);
    const nw = p.find((x) => x.id === 'north-west')!;
    const se = p.find((x) => x.id === 'south-east')!;
    expect(nw.xPct).toBe(10); expect(nw.yPct).toBe(10);    // west + north → left + top
    expect(se.xPct).toBe(90); expect(se.yPct).toBe(90);
  });
  it('a single district centres instead of dividing by zero', () => {
    expect(projectCentroids([{ id: 'only', lat: 22, lng: 70 }])).toEqual([{ id: 'only', xPct: 50, yPct: 50 }]);
  });
  it('no centroids, no marks', () => {
    expect(projectCentroids([])).toEqual([]);
  });
});

describe('ADMIN-SWEEP-c3 · the week label and the export gate', () => {
  it("prints the canon's own chip from the half-open window — the exclusive Monday never shows", () => {
    expect(weekLabel('2026-W28', '2026-07-06T00:00:00.000Z', '2026-07-13T00:00:00.000Z')).toBe('Week 28 · 06 Jul–12 Jul');
  });
  it('the export reason floor matches the server’s', () => {
    expect(buildExport({ reason: 'too short' })).toEqual({ ok: false, error: 'reason' });
    expect(buildExport({ reason: 'monthly growth review', week: '2026-W28' }))
      .toEqual({ ok: true, value: { reason: 'monthly growth review', week: '2026-W28' } });
    expect(EXPORT_REASON_MIN).toBe(10);
  });
  it('gap tone escalates at 50% and there is deliberately no green', () => {
    expect(gapTone(49)).toBe('warning');
    expect(gapTone(50)).toBe('danger');
  });
});

describe('ADMIN-SWEEP-c3 · the absences that ARE the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const page = () => strip(fs.readFileSync(path.join(__dirname, '..', 'app', 'analytics', 'demand-map', 'page.tsx'), 'utf8'));

  it('the page never links the mutate chain — no rebuild/retry action exists to link', () => {
    const src = page();
    expect(src).not.toMatch(/W213[89]|W2140/);            // the canon chain pages are not routes here
    expect(src.match(/<form/g)).toHaveLength(1);          // the export is the page's ONLY action
    expect(src).toContain('exportDemandAction');
  });
  it('the page draws no boundary polygons — centroid marks only', () => {
    expect(page()).not.toMatch(/<path\s/);                // an SVG path would be invented geography
    expect(page()).toContain('projectCentroids');
  });
});
