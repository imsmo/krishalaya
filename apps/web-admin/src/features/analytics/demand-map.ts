// apps/web-admin/src/features/analytics/demand-map.ts · W108 pure console logic (PC-56 ADMIN-SWEEP-c3).
//
// The canon's choropleth admits it is a mock ("production renders vector district boundaries") — and no boundary
// geometry exists anywhere on the platform, only admin_regions CENTROIDS. So the map drawn here is the honest one:
// centroid marks placed by real coordinates, toned by real intensity, with districts that HAVE no centroid listed
// beside it rather than dropped. Boundary polygons are GAP-BACKEND, named in the tracker, not faked in SVG.

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export const EXPORT_REASON_MIN = 10;   // one floor with the server

export function buildExport(v: { reason: string; week?: string }): Built<{ reason: string; week?: string }> {
  const reason = v.reason.trim();
  if (reason.length < EXPORT_REASON_MIN) return { ok: false, error: 'reason' };
  return { ok: true, value: v.week ? { reason, week: v.week } : { reason } };
}

/** Intensity bucket 0–4 against the page's own maximum — a relative tone, and the legend SAYS it is relative
 *  (the darkest district on a quiet week is not the darkest district of the year). */
export function heatBucket(valueMinor: string, maxMinor: string): number {
  const v = BigInt(valueMinor), max = BigInt(maxMinor);
  if (max <= 0n || v <= 0n) return 0;
  const r = Number((v * 1000n) / max);   // ‰ of the max, safe in Number
  if (r >= 750) return 4;
  if (r >= 500) return 3;
  if (r >= 250) return 2;
  return 1;
}

/** Project centroids into a padded 0–100 viewport. Real coordinates, relative frame: the marks sit where the
 *  districts sit relative to EACH OTHER. A single district centres; latitude flips (north = up). */
export function projectCentroids(list: readonly { id: string; lat: number; lng: number }[]): { id: string; xPct: number; yPct: number }[] {
  if (list.length === 0) return [];
  const lats = list.map((p) => p.lat), lngs = list.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat, spanLng = maxLng - minLng;
  const PAD = 10;
  return list.map((p) => ({
    id: p.id,
    xPct: spanLng === 0 ? 50 : PAD + ((p.lng - minLng) / spanLng) * (100 - 2 * PAD),
    yPct: spanLat === 0 ? 50 : PAD + ((maxLat - p.lat) / spanLat) * (100 - 2 * PAD),
  }));
}

/** '2026-W28' + its window → 'Week 28 · 06 Jul–12 Jul'. The window arrives as [start, nextMonday), so the label's
 *  last day is end − 1 day — printing the exclusive bound would show a Monday that is not in the week. */
export function weekLabel(isoWeek: string, startIso: string, endIso: string): string {
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  const start = new Date(startIso);
  const last = new Date(new Date(endIso).getTime() - 86_400_000);
  return `Week ${Number(isoWeek.slice(6))} · ${fmt(start)}–${fmt(last)}`;
}

/** Gap cells tone like risk, covered cells stay quiet — there is deliberately no green: supply meeting demand is
 *  the normal state of a marketplace, not an achievement to celebrate into a chip. */
export function gapClass(pct: number): string {
  return pct >= 50 ? 'kv-status kv-status--danger' : 'kv-status kv-status--warn';
}
