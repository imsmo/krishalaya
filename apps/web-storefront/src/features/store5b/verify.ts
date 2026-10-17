// apps/web-storefront/src/features/store5b/verify.ts · PC-56 STORE-5b · C2 / C7 — THE VERIFY PAGE'S PURE HALF (W304).
//
// The page prints the server's recompute (`GET …/verify`) and THE EXACT FORMULA, so a reader can recompute it from the downloaded record:
//     event_hash = sha256( prev_hash | lot | event_code | canonical(meta) | at )
// `canonicalJson` below is the page's own copy of the canonical text (sorted keys at every depth, no whitespace, numbers and strings as JSON
// prints them) — the spec checks it against the SHARED vectors the API's spec reads (apps/api shared/hash/__fixtures__), so the formula the
// page explains is the formula the API hashes. Nothing here hashes (no crypto on the page): the server's verdict is printed, never re-judged.
export type Recompute = 'ok' | 'mismatch' | 'unverifiable_v1';

export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return 'null';
}
/** The text the v2 hash covers (the formula's input) — printed in the worked example, hashed only by whoever checks. */
export function hashInput(prev: string, lot: string, code: string, meta: Record<string, unknown>, at: string): string {
  return `${prev}|${lot}|${code}|${canonicalJson(meta)}|${at}`;
}

/** The verdict sentence per event. */
export function verdictKey(r: string): string {
  if (r === 'ok') return 'store5b.verify.ok';
  if (r === 'unverifiable_v1') return 'store5b.verify.v1';
  return 'store5b.verify.mismatch';
}
/** The chain's summary sentence: every v2 event recomputes / MISMATCH at event n — every hash after it breaks. */
export function chainSummary(v: { chain: string; brokenAt: number | null; v1Count: number; events: readonly unknown[] }): { key: string; vars: Record<string, string | number> } {
  if (v.chain === 'broken_at' && v.brokenAt !== null) return { key: 'store5b.verify.brokenAt', vars: { n: v.brokenAt } };
  if (v.events.length === 0) return { key: 'store5b.verify.noEvents', vars: {} };
  if (v.v1Count === v.events.length) return { key: 'store5b.verify.allV1', vars: {} };
  return { key: v.v1Count > 0 ? 'store5b.verify.okWithV1' : 'store5b.verify.allOk', vars: { n: v.v1Count } };
}
