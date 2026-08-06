// apps/web-admin/src/features/catalogue/crops.ts · the CROP LENS, console side (PC-56 ADMIN-3c, canon W023 + W110).
//
// THE TWO THINGS THIS FILE EXISTS TO KEEP HONEST, both of which are absences the screen must not render as facts:
//
//   1. A CROP WITH NO SOURCED CALENDAR HAS UNKNOWN SEASONS. Not "no seasons". The API sends `null`; this module keeps it
//      null all the way to the cell, because "grows in no season" is a claim about a crop and "we have not sourced it" is
//      a statement about us.
//   2. A CROP WITH NO PRODUCTS IS NOT 0% MAPPED. There is nothing to map. A red "unmapped" badge beside it would be a
//      criticism of nothing, and it would never clear.
//
// The stage form is the other half: a timeline is only coherent as a SET, so the form submits all of it and the server
// validates the whole thing. A per-stage save could leave a gap between two saves.

export const SEASONS = ['kharif', 'rabi', 'zaid', 'perennial'] as const;
export type Season = (typeof SEASONS)[number];

export const MIN_REASON = 10;
export const MAX_STAGES = 20;
export const MAX_DAY = 730;
/** How many stage rows the form renders beyond what exists. Six: the canon's own groundnut calendar has six stages. */
export const BLANK_STAGE_ROWS = 6;

export interface CropRow {
  id: string; code: string; defaultName: string; path: string; depth: number; isActive: boolean;
  seasons: string[] | null; seasonsLabel?: string | null; seasonsUnknown?: boolean;
  calendarCount: number; productCount: number; mappedCount: number; varietyCount: number;
  mandi?: { total: number; mapped: number; pct: number | null; state: string };
}
export interface StageRow { name: string; dayFrom: number; dayTo: number; advisory?: string | null }
export interface CalendarRow {
  id: string; cropName: string; season: string;
  categoryId?: string | null; categoryCode?: string | null;
  regionId?: string | null; regionName?: string | null;
  durationDaysMin: number; durationDaysMax: number;
  stages: StageRow[]; source: string; isActive: boolean; createdAt?: string | null;
}
export interface ProductMappingRow {
  productId: string; defaultName: string; code?: string | null;
  externalId?: string | null; syncStatus?: string | null; lastSyncedAt?: string | null;
}

/* ------------------------------------------------------------------ reading */

/** The season cell. NULL stays NULL — the caller renders "unknown", never a dash that could read as "none". */
export function seasonsText(row: Pick<CropRow, 'seasons' | 'seasonsLabel'>): string | null {
  if (row.seasonsLabel) return row.seasonsLabel;
  if (!row.seasons || row.seasons.length === 0) return null;
  return SEASONS.filter((s) => row.seasons!.includes(s)).join(' · ');
}

/** True when we genuinely do not know, as opposed to knowing there are none. */
export function seasonsUnknown(row: Pick<CropRow, 'seasons' | 'seasonsUnknown' | 'calendarCount'>): boolean {
  if (typeof row.seasonsUnknown === 'boolean') return row.seasonsUnknown;
  return !row.seasons || row.seasons.length === 0;
}

/** The mandi badge's CSS class. `no_products` is NEUTRAL — there is nothing to map, which is not a failure. */
export function mandiClass(state: string | undefined): string {
  switch (state) {
    case 'all': return 'kv-status--ok';
    case 'partial': return 'kv-status--warn';
    case 'none': return 'kv-status--danger';
    case 'no_products':
    default: return 'kv-status--muted';
  }
}

/** The badge's i18n key. */
export function mandiKey(state: string | undefined): 'all' | 'partial' | 'none' | 'noProducts' {
  switch (state) {
    case 'all': return 'all';
    case 'partial': return 'partial';
    case 'none': return 'none';
    default: return 'noProducts';
  }
}

/** A mapping's sync state, or null when the product has none at all. `pending` is a real state and must not read as an
 *  absence; an unmapped product has no state, which is different. */
export function syncStateOf(row: Pick<ProductMappingRow, 'externalId' | 'syncStatus'>): string | null {
  if (!row.externalId) return null;
  return row.syncStatus ?? 'pending';
}

/**
 * Where the timeline's stages leave a gap or overlap — the same rules the server enforces, computed here ONLY so the
 * chart can mark the problem rather than the operator discovering it at submit. The server's refusal is the authority.
 */
export function timelineProblems(stages: readonly StageRow[]): string[] {
  const out: string[] = [];
  const ordered = [...stages].sort((a, b) => a.dayFrom - b.dayFrom);
  for (let i = 0; i < ordered.length; i += 1) {
    const s = ordered[i];
    if (s.dayTo < s.dayFrom) out.push(`${s.name}: ends on day ${s.dayTo} but starts on ${s.dayFrom}`);
    if (i === 0) continue;
    const prev = ordered[i - 1];
    if (s.dayFrom < prev.dayTo) out.push(`${prev.name} and ${s.name} overlap`);
    else if (s.dayFrom > prev.dayTo) out.push(`days ${prev.dayTo}–${s.dayFrom} are not covered by any stage`);
  }
  return out;
}

/** A stage's share of the timeline, for the bar widths. Returns 0 when the total is 0 rather than dividing by it. */
export function stageWidthPct(stage: StageRow, totalDays: number): number {
  if (!(totalDays > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(((stage.dayTo - stage.dayFrom) / totalDays) * 100)));
}

/* ------------------------------------------------------------------ forms */

export type FormBag = (name: string) => string;
export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMODITY_RE = /^[A-Za-z]{2,6}-?[0-9]{2,8}$/;

function reason(get: FormBag): string | null {
  const r = get('reason').trim();
  return r.length >= MIN_REASON && r.length <= 1000 ? r : null;
}

export interface CalendarPayload {
  cropName: string; season: string; source: string;
  durationDaysMin: number; durationDaysMax: number;
  stages: StageRow[]; categoryId?: string; regionId?: string; reason: string;
}

/**
 * Build a calendar from the indexed stage rows.
 *
 * THE SOURCE IS CHECKED FIRST, matching the server's own ordering, because it is the rule the canon repeats and the one
 * whose absence makes everything else worthless. An entirely blank stage row is SKIPPED — that is how the form offers
 * more rows than a short calendar needs without forcing the operator to count.
 */
export function buildCalendar(get: FormBag): Built<CalendarPayload> {
  const source = get('source').trim();
  if (source.length < 3 || source.length > 120) return { ok: false, error: 'source' };

  const cropName = get('cropName').trim();
  if (cropName.length < 2 || cropName.length > 120) return { ok: false, error: 'cropName' };
  const season = get('season').trim().toLowerCase();
  if (!(SEASONS as readonly string[]).includes(season)) return { ok: false, error: 'season' };

  const minRaw = get('durationDaysMin').trim();
  const maxRaw = get('durationDaysMax').trim();
  if (!/^\d{1,4}$/.test(minRaw) || !/^\d{1,4}$/.test(maxRaw)) return { ok: false, error: 'duration' };
  const durationDaysMin = Number(minRaw);
  const durationDaysMax = Number(maxRaw);
  if (durationDaysMax < durationDaysMin) return { ok: false, error: 'durationOrder' };
  if (durationDaysMax > MAX_DAY) return { ok: false, error: 'durationLong' };

  const stages: StageRow[] = [];
  const count = Number(get('stageCount').trim() || '0');
  if (!Number.isInteger(count) || count < 1 || count > MAX_STAGES + BLANK_STAGE_ROWS) {
    return { ok: false, error: 'stageCount' };
  }
  for (let i = 0; i < count; i += 1) {
    const name = get(`stage_${i}_name`).trim();
    const fromRaw = get(`stage_${i}_dayFrom`).trim();
    const toRaw = get(`stage_${i}_dayTo`).trim();
    // an entirely blank row is an unused slot, not an error
    if (!name && !fromRaw && !toRaw) continue;
    if (!name) return { ok: false, error: 'stageName' };
    if (!/^\d{1,4}$/.test(fromRaw) || !/^\d{1,4}$/.test(toRaw)) return { ok: false, error: 'stageDays' };
    const advisory = get(`stage_${i}_advisory`).trim();
    stages.push({
      name, dayFrom: Number(fromRaw), dayTo: Number(toRaw), ...(advisory ? { advisory } : {}),
    });
  }
  if (stages.length === 0) return { ok: false, error: 'noStages' };
  if (stages.length > MAX_STAGES) return { ok: false, error: 'tooManyStages' };

  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };

  const out: CalendarPayload = {
    cropName, season, source, durationDaysMin, durationDaysMax, stages, reason: r,
  };
  const categoryId = get('categoryId').trim();
  if (categoryId) {
    if (!UUID_RE.test(categoryId)) return { ok: false, error: 'categoryId' };
    out.categoryId = categoryId;
  }
  const regionId = get('regionId').trim();
  if (regionId) {
    if (!UUID_RE.test(regionId)) return { ok: false, error: 'regionId' };
    out.regionId = regionId;
  }
  return { ok: true, value: out };
}

export interface MappingPayload { productId: string; externalId: string; reason: string }

/** A mapping attaches a PRODUCT to a commodity code. The refusal message on the server names why it cannot be a crop. */
export function buildMapping(get: FormBag): Built<MappingPayload> {
  const productId = get('productId').trim();
  if (!UUID_RE.test(productId)) return { ok: false, error: 'productId' };
  const externalId = get('externalId').trim().toUpperCase();
  if (!COMMODITY_RE.test(externalId)) return { ok: false, error: 'commodityCode' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { productId, externalId, reason: r } };
}

/** The stage rows a form renders: what exists, then blanks. */
export function formStages(existing: readonly StageRow[]): Array<StageRow | null> {
  const ordered = [...existing].sort((a, b) => a.dayFrom - b.dayFrom);
  return [...ordered, ...Array.from({ length: BLANK_STAGE_ROWS }, () => null)];
}
