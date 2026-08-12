// apps/web-admin/src/features/analytics/farmer360.ts · W109 pure console logic (PC-56 ADMIN-SWEEP-b4).
//
// The one rule this file owns outright: NULL IS NOT ZERO. A tile whose value is null prints "unknown" with its
// basis — a farmer with no dairy membership must never read as a farmer earning ₹0 from dairy.

export interface MoneyTile { valueMinor: string | null; basis: string; n: number }

export function formatMinor(v: string | null): string {
  if (v === null) return '';
  const neg = v.startsWith('-');
  const s = (neg ? v.slice(1) : v).padStart(3, '0');
  // Indian grouping: the last three digits, then pairs — ₹8,64,200.00, never ₹864,200.00.
  const rupees = s.slice(0, -2).replace(/(\d)(?=(\d\d)+\d$)/g, '$1,');
  return `${neg ? '−' : ''}₹${rupees}.${s.slice(-2)}`;
}

/** What a tile prints: a figure, or the honest word for its absence. */
export function tileText(t: MoneyTile): { key: 'value' | 'unknown'; text: string } {
  return t.valueMinor === null ? { key: 'unknown', text: '' } : { key: 'value', text: formatMinor(t.valueMinor) };
}

export function bandClass(band: string | null): string {
  if (band === 'trusted') return 'kv-status kv-status--ok';
  if (band === 'restricted' || band === 'blocked') return 'kv-status kv-status--err';
  if (band === 'caution') return 'kv-status kv-status--warn';
  return 'kv-status';
}

export function timelineIcon(kind: string): string {
  return kind === 'order' ? '₹' : kind === 'listing' ? '◆' : '✓';
}

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export const EXPORT_REASON_MIN = 10;   // one floor with the server

export function buildExport(v: { reason: string }): Built<{ reason: string }> {
  const reason = v.reason.trim();
  if (reason.length < EXPORT_REASON_MIN) return { ok: false, error: 'reason' };
  return { ok: true, value: { reason } };
}

/** Search input gate: ≥2 chars (a single letter would sweep the population). No phone shapes are special-cased —
 *  the server has no phone predicate to hit anyway; this is display-side hygiene only. */
export function buildSearch(v: { q: string }): Built<{ q: string }> {
  const q = v.q.trim();
  if (q.length < 2) return { ok: false, error: 'q' };
  return { ok: true, value: { q } };
}
