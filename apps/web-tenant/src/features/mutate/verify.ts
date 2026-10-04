// apps/web-tenant/src/features/mutate/verify.ts · PC-56 TENANT-SW-f · W318 §3 — VERIFY-BEFORE-WRITE, in the SHARED mutate chain.
//
// W318: *"On reconnect the console re-fetches the rows you had open BEFORE re-enabling their write buttons — a checker approving a wage run
// must be approving today's run, not a 40-minute-old ghost … any row that changed shows a diff chip: changed while offline — click shows
// what moved before you act on it."* · *"Never allow approve/reject/pay from cache."* · *"Never auto-replay a console write."*
//
// THE GENERIC MECHANISM (every act page of the sweep waves uses these four calls, nothing else):
//   1. The CONFIRM step renders the row the server described and carries what it showed: `seenToken(row, fields)` → a hidden `kv_seen`
//      input in the confirm form (the row's identity, version / updated_at and the fields the operator is judging).
//   2. The SERVER ACTION, before it writes, calls `verifyBeforeWrite(formData.get('kv_seen'), reread)` — `reread` is the SAME SDK read the
//      confirm step made, made again now. If any carried field differs (or the row is gone), nothing is written.
//   3. It redirects to the chain's failure step with `staleHref(…)` → `error=STALE_ROW&kv_diff=<what moved>`.
//   4. The failure step renders `StaleDiffChip` — "changed while you were looking: field · was · now" — and "re-check and confirm again",
//      which is a link back to the confirm step, which reads the row afresh. Nothing is replayed: the operator presses the button again,
//      on today's row (W318's no-auto-replay law, by construction: nothing is queued anywhere).
// A confirm form that did not carry its snapshot is refused the same way (`SEEN_MISSING`): a write without a "what I saw" is a write blind.
//
// Pure TypeScript, no framework imports — the API's live spec imports this file to prove STALE_ROW against the real API.

export const SEEN_FIELD = 'kv_seen';
export const DIFF_PARAM = 'kv_diff';
export const STALE_ROW = 'STALE_ROW';
export const SEEN_MISSING = 'SEEN_MISSING';
const MAX_DIFFS = 8;
const MAX_VALUE = 120;

export interface FieldDiff { field: string; was: string; now: string }
export type Verdict = { ok: true } | { ok: false; code: typeof STALE_ROW; diffs: FieldDiff[] } | { ok: false; code: typeof SEEN_MISSING; diffs: FieldDiff[] };
type Row = Record<string, unknown>;

const b64u = {
  enc: (s: string): string => {
    const B = (globalThis as { Buffer?: { from(x: string, e: string): { toString(e: string): string } } }).Buffer;
    if (B) return B.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec: (s: string): string => {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const B = (globalThis as { Buffer?: { from(x: string, e: string): { toString(e: string): string } } }).Buffer;
    if (B) return B.from(t, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(t)));
  },
};

/** A field's value as the operator saw it: `a.b` reaches into a nested object; null / undefined print as '—'; objects as JSON. */
export function fieldValue(row: Row | null | undefined, field: string): string {
  let v: unknown = row;
  for (const k of field.split('.')) { if (v === null || v === undefined || typeof v !== 'object') { v = undefined; break; } v = (v as Row)[k]; }
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function snapshot(row: Row | null | undefined, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f, fieldValue(row, f)]));
}

/** The confirm step's hidden `kv_seen` value: the fields it showed and their values, as it showed them. */
export function seenToken(row: Row | null | undefined, fields: readonly string[]): string {
  return b64u.enc(JSON.stringify({ v: 1, f: [...fields], s: snapshot(row, fields) }));
}

export function readSeen(token: unknown): { fields: string[]; values: Record<string, string> } | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 65536) return null;
  try {
    const o = JSON.parse(b64u.dec(token)) as { v?: number; f?: unknown; s?: unknown };
    if (o.v !== 1 || !Array.isArray(o.f) || !o.f.every((x) => typeof x === 'string') || typeof o.s !== 'object' || o.s === null) return null;
    const values = o.s as Record<string, unknown>;
    if (!(o.f as string[]).every((k) => typeof values[k] === 'string')) return null;
    return { fields: o.f as string[], values: values as Record<string, string> };
  } catch { return null; }
}

const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);

/** What moved between what was seen and what is there now — field · was · now. */
export function diffSnapshots(seen: Record<string, string>, now: Record<string, string>): FieldDiff[] {
  return Object.keys(seen).filter((k) => seen[k] !== now[k]).map((k) => ({ field: k, was: clip(seen[k]), now: clip(now[k] ?? '—') }));
}

/**
 * THE RE-READ. Called by the server action immediately before it writes. `reread` is the confirm step's own read, made again; a read that
 * throws a not-found (or returns null) means the row is gone — stale too. Any other failure propagates: the action's own failure path
 * reports it, and nothing is written either way.
 */
export async function verifyBeforeWrite(token: unknown, reread: () => Promise<Row | null>, isGone: (e: unknown) => boolean = defaultGone): Promise<Verdict> {
  const seen = readSeen(token);
  if (!seen) return { ok: false, code: SEEN_MISSING, diffs: [] };
  let row: Row | null;
  try { row = await reread(); }
  catch (e) { if (isGone(e)) row = null; else throw e; }
  if (row === null) return { ok: false, code: STALE_ROW, diffs: [{ field: '(row)', was: 'present', now: 'gone' }] };
  const diffs = diffSnapshots(seen.values, snapshot(row, seen.fields));
  return diffs.length === 0 ? { ok: true } : { ok: false, code: STALE_ROW, diffs };
}
function defaultGone(e: unknown): boolean { const x = e as { status?: number; code?: string }; return x?.status === 404 || /NOT_FOUND$/.test(String(x?.code ?? '')); }

export function diffToken(diffs: readonly FieldDiff[]): string { return b64u.enc(JSON.stringify(diffs.slice(0, MAX_DIFFS).map((d) => [d.field, clip(d.was), clip(d.now)]))); }
export function readDiff(raw: unknown): FieldDiff[] {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4000) return [];
  try {
    const a = JSON.parse(b64u.dec(raw));
    if (!Array.isArray(a)) return [];
    return a.slice(0, MAX_DIFFS).filter((x) => Array.isArray(x) && x.length === 3 && x.every((y) => typeof y === 'string')).map((x) => ({ field: x[0], was: x[1], now: x[2] }));
  } catch { return []; }
}

/** The chain's failure URL for a stale (or snapshot-less) confirm: the carried values survive, so "confirm again" re-reviews the same act. */
export function staleHref(base: string, carry: Record<string, string | null | undefined>, v: Exclude<Verdict, { ok: true }>): string {
  const q = new URLSearchParams();
  for (const [k, val] of Object.entries(carry)) if (val !== null && val !== undefined && String(val).trim() !== '') q.set(k, String(val));
  q.set('step', 'failure'); q.set('error', v.code);
  if (v.diffs.length) q.set(DIFF_PARAM, diffToken(v.diffs));
  return `${base}?${q.toString()}`;
}

/** Is this failure the verify-before-write refusal (so the page renders the diff chip, not the generic failure copy)? */
export function isStaleFailure(error: unknown): boolean { return error === STALE_ROW || error === SEEN_MISSING; }
