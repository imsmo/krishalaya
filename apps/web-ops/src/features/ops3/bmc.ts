// apps/web-ops/src/features/ops3/bmc.ts · PC-56 OPS-3b · THE TANK (W366 + the bmc form chain W3282–W3285 + the bmc mutate chain W3286–W3288) —
// PURE helpers. Founder 2026-11-08 (`05_OPS.md` "OPS-3 SPLIT"): Q12-A ("this console reads the cooler and records manual readings only"; "Request
// tanker dispatch" refused by name; the cooler's band, level, compressor and retirement stay on the organisation's console) · Q13-A (the manual
// reading offered here, labelled as manual, with no photo) · Q10-A (no member on this page) · Q14-A ("signed in as you").
//
// NO CLIENT MATH (E3): every figure is the server's — the reading and the band are the server's one-decimal strings, the tank volume and the stated
// level its litre strings, the counts its integers, the series its points. Nothing here works out a percentage, an average, a variance or a
// difference, and nothing is drawn between two readings. `fillPct` (a number the API returns) is never read. The temperature a person types is
// checked by PATTERN only (the API's own, `bmc.dto.ts` `tempC`) and sent as typed; the SERVER records it at its own time and gives the verdict.
import type { DairyBmcReading, DairyBmcTile, DairyMcc } from '@krishalaya/sdk-js';

export const BMC = '/bmc';
/** The reading the server answered, kept for THIS browser (httpOnly, path /bmc, ten minutes) so the success state shows the SERVER's answer. */
export const READING_COOKIE = 'kv_bmc_reading';
export const READING_COOKIE_MAX_AGE_SEC = 600;
/** The series window the page asks the monitor for — the same 24 hours the server's counts cover. */
export const SERIES_HOURS = 24;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The API's own pattern for a temperature (`bmc.dto.ts`): an optional minus, up to three digits, at most one decimal. */
const TEMP = /^-?\d{1,3}(\.\d)?$/;
const one = (v: string | string[] | undefined | null): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
export function parseUnit(v: string | string[] | undefined | null): string | null { const s = one(v); return UUID.test(s) ? s : null; }
/** The typed temperature, kept as the person typed it (no `Number`), or null when it is not the API's shape. */
export function parseTemp(v: string | string[] | undefined | null): string | null { const s = one(v); return TEMP.test(s) ? s : null; }
/** The raw typed value, for echoing back into the form on its error state (bounded, never parsed). */
export function typedTemp(v: string | string[] | undefined | null): string { return one(v).slice(0, 12); }

export type BmcState = 'ok' | 'off' | 'monitorOff' | 'forbidden' | 'error';
/**
 * The page's state from its two reads. `GET /v1/dairy/mccs/mine` answers 404 when `dairy` is switched off; `GET /v1/dairy/bmc/monitor` answers 404
 * when `dairy_bmc_monitor` is (switched-off routes answer 404 — the flag guard); 403 is a person with no dairy read permission.
 */
export function bmcState(mine: 'ok' | number | 'failed', monitor: 'ok' | number | 'failed'): BmcState {
  if (mine === 404) return 'off';
  if (mine === 403 || monitor === 403) return 'forbidden';
  if (monitor === 404) return 'monitorOff';
  if (mine !== 'ok' || monitor !== 'ok') return 'error';
  return 'ok';
}

export type BmcScope = 'custody' | 'organisation';
/**
 * WHICH COOLERS THIS PAGE SHOWS. The monitor returns every active cooler of the organisation to any dairy reader (it is not scoped to custody at
 * the API — OPS-3b §2). The page shows the coolers at the centres in the signed-in person's OPEN custody; a person who holds no centre (an
 * administrator, say) is shown the organisation's coolers, and the page says so. A cooler's centre is the tile's own `mccId`.
 */
export function coolersFor(tiles: readonly DairyBmcTile[], centres: readonly DairyMcc[]): { scope: BmcScope; tiles: DairyBmcTile[] } {
  if (centres.length === 0) return { scope: 'organisation', tiles: [...tiles] };
  const held = new Set(centres.map((c) => c.id));
  return { scope: 'custody', tiles: tiles.filter((x) => held.has(x.mccId)) };
}
/** The cooler the page opens on: the one named in `?unit=` IF it is shown, else the first shown at `?mcc=` (W365's link), else the first shown. */
export function pickCooler(tiles: readonly DairyBmcTile[], unit: string | null, mcc: string | null = null): DairyBmcTile | null {
  if (unit) { const hit = tiles.find((x) => x.unitId === unit); if (hit) return hit; }
  if (mcc) { const hit = tiles.find((x) => x.mccId === mcc); if (hit) return hit; }
  return tiles[0] ?? null;
}

/** The server's time as its own date and minute text, UTC (string placement, no clock arithmetic). */
export function atText(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? `${m[1]} ${m[2]} UTC` : null;
}

/** The bmc form chain's failure reasons, named. Server codes first (each a sentence on the page), then the console's own pre-checks. */
export const READING_REASONS = ['custody', 'noThreshold', 'retired', 'notFound', 'forbidden', 'off', 'record'] as const;
export type ReadingReason = (typeof READING_REASONS)[number];
/** The form-error reasons (W3282): the value is not the API's shape, or no cooler shown on the page was named. */
export const FORM_ERRORS = ['temp', 'unit'] as const;
export type FormError = (typeof FORM_ERRORS)[number];

/** A refusal of `POST /v1/dairy/bmc/readings`, named. `null` means the DTO refused the value: the form-error state, not a failure. */
export function readingFailureReason(status: number, code: string | undefined, details?: Record<string, unknown>): ReadingReason | null {
  switch (code) {
    case 'DAIRY_CENTRE_NOT_IN_CUSTODY': return 'custody';
    // the service keeps a reading for a cooler with no band (`readingId` in the details) and refuses a retired cooler before any write
    case 'BMC_READING_REFUSED': return details && typeof details.readingId !== 'undefined' ? 'noThreshold' : 'retired';
    case 'BMC_UNIT_NOT_FOUND': return 'notFound';
    case 'VALIDATION_FAILED': return null;
    default: break;
  }
  if (status === 403) return 'forbidden';
  if (status === 404) return 'off';
  if (status === 422 || status === 400) return null;
  return 'record';
}
export function parseReadingReason(v: string | string[] | undefined | null): ReadingReason {
  const r = one(v);
  return (READING_REASONS as readonly string[]).includes(r) ? (r as ReadingReason) : 'record';
}
export function parseFormError(v: string | string[] | undefined | null): FormError {
  const r = one(v);
  return (FORM_ERRORS as readonly string[]).includes(r) ? (r as FormError) : 'temp';
}

/** What `POST /v1/dairy/bmc/readings` answered, kept for the success state — only these fields, each checked on the way back in. */
export interface RecordedReading { unitId: string; tempC: string; verdict: DairyBmcReading['verdict']; recordedAt: string; band: { minC: string; maxC: string } }
const VERDICTS = ['in_range', 'above_band', 'below_min'];
export function encodeReading(r: RecordedReading): string { return Buffer.from(JSON.stringify(r), 'utf8').toString('base64url'); }
export function decodeReading(raw: string | undefined | null): RecordedReading | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  const band = (o.band ?? {}) as Record<string, unknown>;
  const unitId = s(o.unitId); const tempC = s(o.tempC); const verdict = s(o.verdict); const recordedAt = s(o.recordedAt);
  const minC = s(band.minC); const maxC = s(band.maxC);
  if (!unitId || !UUID.test(unitId) || !tempC || !TEMP.test(tempC) || !verdict || !VERDICTS.includes(verdict) || !recordedAt || !atText(recordedAt)
    || !minC || !TEMP.test(minC) || !maxC || !TEMP.test(maxC)) return null;
  return { unitId, tempC, verdict: verdict as RecordedReading['verdict'], recordedAt, band: { minC, maxC } };
}
/** The form's values as query parameters (the review step and the form-error state echo them; nothing is stored until "Record this reading"). */
export function readingQuery(unit: string, tempC: string): string { return new URLSearchParams({ unit, tempC }).toString(); }
