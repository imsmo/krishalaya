// apps/admin-api/src/modules/catalogue-depth/domain/crop-lens.ts · the CROP LENS
// (PC-56 ADMIN-3c, canon W023 + W110 — closes DELTA-008 and ADMIN-3-Q4). No I/O → unit-provable.
//
// THIS FILE GOVERNS AGRONOMY ADVICE, which makes it different from every other domain in this console. A wrong unit
// conversion misquotes a quantity and somebody notices. A wrong crop calendar tells a farmer to sow at the wrong time,
// and they find out at harvest.
//
// So the canon's rule is the strictest thing here and it is enforced twice — once in migration 0104 as a CHECK and once
// below with a message: "sourced from ICAR/state depts, NEVER FABRICATED", "source field is mandatory". The column had
// been nullable since 0061, so the schema had permitted exactly what the canon forbids.
//
// THE OTHER RULE IS ABOUT WHAT THE PLATFORM REFUSES TO COMPUTE. W110 states it plainly: "The app never computes a
// specific farm's current stage — no per-parcel sowing date exists, and we do not fabricate one (honestly-absent rule)."
// Stage offsets are RELATIVE TO SOWING, and nothing in this module turns them into a date.
import { InvalidCropCalendarError, InvalidMandiMappingError } from './catalogue-depth.errors';

/* ------------------------------------------------------------------ seasons */

/** Mirrors 0061's CHECK. */
export const SEASONS = ['kharif', 'rabi', 'zaid', 'perennial'] as const;
export type Season = (typeof SEASONS)[number];
export function isSeason(v: string): v is Season {
  return (SEASONS as readonly string[]).includes(v);
}

/**
 * A CROP'S SEASONS, DERIVED FROM ITS SOURCED CALENDARS — the answer to DELTA-008's season half.
 *
 * Returns `null`, not an empty array, when the crop has no calendars. The distinction is the point: `[]` would render as
 * "no seasons", which is a claim that the crop grows in none of them. `null` renders as "unknown", which is what we
 * actually know. A season we have not sourced is not a season we have ruled out.
 *
 * Ordered by the agricultural year rather than alphabetically, because "Kharif · Rabi" is how a farmer reads it and
 * "Kharif · Perennial · Rabi" is how a sort() reads it.
 */
export function seasonsForCrop(
  calendars: ReadonlyArray<{ season: string; isActive?: boolean }>,
): Season[] | null {
  const live = calendars.filter((c) => c.isActive !== false);
  if (live.length === 0) return null;
  const held = new Set(live.map((c) => c.season).filter(isSeason));
  if (held.size === 0) return null;
  return SEASONS.filter((s) => held.has(s));
}

/** One line for the W023 column, or null when unknown. Never "—" invented here; the caller decides how to show absence. */
export function seasonsLabel(seasons: Season[] | null): string | null {
  return seasons && seasons.length > 0 ? seasons.join(' · ') : null;
}

/* ------------------------------------------------------------------ stages */

export interface StageInput { name?: unknown; dayFrom?: unknown; dayTo?: unknown; advisory?: unknown }
export interface Stage { name: string; dayFrom: number; dayTo: number; advisory: string | null }

export const MAX_STAGES = 20;
/** Two years. A calendar longer than this is a perennial's whole life, not a season's timeline. */
export const MAX_DAY = 730;
export const MIN_SOURCE = 3;

/**
 * Validate the stage timeline.
 *
 * FIVE RULES, and every one of them exists because breaking it produces a timeline that RENDERS FINE and misinforms:
 *   1. AT LEAST ONE STAGE. A calendar with none is a duration wearing an agronomy label; 0104 CHECKs this too.
 *   2. dayFrom <= dayTo per stage. A stage that ends before it starts draws as a zero-width band nobody sees.
 *   3. STAGES MUST NOT OVERLAP. Two stages claiming day 40 means the farmer is told two different things about the same
 *      day, and the chart shows whichever the renderer happens to draw last.
 *   4. NO GAPS. A missing day 55–60 is a week the calendar says nothing about, which reads as "nothing to do" rather
 *      than "we did not write this down".
 *   5. THE TIMELINE MUST FIT THE DURATION. A calendar whose stages run to day 140 while claiming 105–120 days is
 *      internally inconsistent, and the inconsistency is invisible on a chart that scales to its own data.
 */
export function assertStages(raw: unknown, durationMin: number, durationMax: number): Stage[] {
  if (!Array.isArray(raw)) throw new InvalidCropCalendarError('stages must be an array');
  if (raw.length === 0) {
    throw new InvalidCropCalendarError('a calendar needs at least one stage — the stage timeline is what makes it agronomy rather than a duration');
  }
  if (raw.length > MAX_STAGES) throw new InvalidCropCalendarError(`a calendar may have at most ${MAX_STAGES} stages`);

  const stages: Stage[] = raw.map((s: StageInput, i) => {
    const name = String(s?.name ?? '').trim();
    if (name.length < 2 || name.length > 60) {
      throw new InvalidCropCalendarError(`stage ${i + 1}: name must be 2–60 characters`);
    }
    const dayFrom = Number(s?.dayFrom);
    const dayTo = Number(s?.dayTo);
    if (!Number.isInteger(dayFrom) || dayFrom < 0 || dayFrom > MAX_DAY) {
      throw new InvalidCropCalendarError(`stage "${name}": dayFrom must be a whole number of days from sowing, 0–${MAX_DAY}`);
    }
    if (!Number.isInteger(dayTo) || dayTo < 0 || dayTo > MAX_DAY) {
      throw new InvalidCropCalendarError(`stage "${name}": dayTo must be a whole number of days from sowing, 0–${MAX_DAY}`);
    }
    // RULE 2
    if (dayTo < dayFrom) {
      throw new InvalidCropCalendarError(`stage "${name}" ends on day ${dayTo} and starts on day ${dayFrom} — it cannot end before it begins`);
    }
    const advisory = String(s?.advisory ?? '').trim() || null;
    if (advisory && advisory.length > 2000) {
      throw new InvalidCropCalendarError(`stage "${name}": the advisory is too long`);
    }
    return { name, dayFrom, dayTo, advisory };
  });

  const ordered = [...stages].sort((a, b) => a.dayFrom - b.dayFrom || a.dayTo - b.dayTo);

  // The FIRST stage should begin at sowing. Not refused — a calendar that starts at transplanting on day 21 is real —
  // but a first stage starting late is worth surfacing rather than silently accepting.
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    // RULE 3 — a strict overlap. Touching is fine: one stage ending on day 35 and the next starting on 35 is how these
    // are written in practice (the boundary day belongs to both in the agronomy, not in the data).
    if (cur.dayFrom < prev.dayTo) {
      throw new InvalidCropCalendarError(
        `stages "${prev.name}" (${prev.dayFrom}–${prev.dayTo}) and "${cur.name}" (${cur.dayFrom}–${cur.dayTo}) overlap — a farmer would be told two different things about the same day`);
    }
    // RULE 4
    if (cur.dayFrom > prev.dayTo) {
      throw new InvalidCropCalendarError(
        `days ${prev.dayTo}–${cur.dayFrom} fall between "${prev.name}" and "${cur.name}" with no stage covering them — a gap reads as "nothing to do" rather than "not written down"`);
    }
  }

  // RULE 5
  const last = ordered[ordered.length - 1];
  if (last.dayTo > durationMax) {
    throw new InvalidCropCalendarError(
      `the timeline runs to day ${last.dayTo} but the calendar claims at most ${durationMax} days — one of the two is wrong`);
  }
  if (last.dayTo < durationMin) {
    throw new InvalidCropCalendarError(
      `the timeline ends on day ${last.dayTo} but the calendar claims at least ${durationMin} days — the last stage is missing or the duration is wrong`);
  }
  return ordered;
}

/* ------------------------------------------------------------------ the calendar */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CalendarInput {
  cropName: string; season: string; source: string;
  durationDaysMin: string | number; durationDaysMax: string | number;
  stages: unknown; categoryId?: string | null; regionId?: string | null;
}
export interface Calendar {
  cropName: string; season: Season; source: string;
  durationDaysMin: number; durationDaysMax: number;
  stages: Stage[]; categoryId: string | null; regionId: string | null;
}

/**
 * Validate a whole calendar.
 *
 * THE SOURCE CHECK COMES FIRST, before anything about days, because it is the rule the canon repeats and the one whose
 * absence would make everything else worthless. A perfectly-shaped timeline nobody can attribute is not agronomy.
 */
export function assertCalendar(input: CalendarInput): Calendar {
  // RULE ZERO — the source. W110: "Add sourced calendars only — ICAR or state agri departments; source field is mandatory."
  const source = String(input.source ?? '').trim();
  if (source.length < MIN_SOURCE) {
    throw new InvalidCropCalendarError(
      'name the source — ICAR, a state agriculture department, a named institute. Agronomy advice a farmer plants by is never fabricated, and an unattributed calendar cannot be checked by anybody.');
  }
  if (source.length > 120) throw new InvalidCropCalendarError('source is too long');

  const cropName = String(input.cropName ?? '').trim();
  if (cropName.length < 2 || cropName.length > 120) {
    throw new InvalidCropCalendarError('cropName must be 2–120 characters');
  }
  const season = String(input.season ?? '').trim().toLowerCase();
  if (!isSeason(season)) throw new InvalidCropCalendarError(`season must be one of ${SEASONS.join('|')}`);

  const durationDaysMin = intOrThrow(input.durationDaysMin, 'durationDaysMin');
  const durationDaysMax = intOrThrow(input.durationDaysMax, 'durationDaysMax');
  if (durationDaysMax < durationDaysMin) {
    throw new InvalidCropCalendarError('the maximum duration cannot be shorter than the minimum');
  }
  if (durationDaysMax > MAX_DAY) throw new InvalidCropCalendarError(`a duration longer than ${MAX_DAY} days is a perennial's life, not a season`);

  const stages = assertStages(input.stages, durationDaysMin, durationDaysMax);

  // A malformed id is DROPPED rather than stored: a dangling reference would make the crop→calendar join silently miss,
  // and a missing season reads as "unknown" which is at least honest.
  const categoryId = UUID_RE.test(String(input.categoryId ?? '')) ? String(input.categoryId) : null;
  const regionId = UUID_RE.test(String(input.regionId ?? '')) ? String(input.regionId) : null;

  return { cropName, season, source, durationDaysMin, durationDaysMax, stages, categoryId, regionId };
}

function intOrThrow(v: unknown, field: string): number {
  const s = String(v ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) throw new InvalidCropCalendarError(`${field} must be a whole number of days`);
  return Number(s);
}

/**
 * THE HONESTLY-ABSENT RULE, as a function that exists to be called and always refuses.
 *
 * W110: "Day offsets are relative to sowing. The app never computes a specific farm's current stage — no per-parcel
 * sowing date exists, and we do not fabricate one."
 *
 * This is here rather than nowhere because the temptation is real and recurring: a `crop_seasons` table DOES exist (0010)
 * with a `sown_on` column, and it would be one join away from "your wheat is in the pegging stage". But `crop_seasons` is
 * per-PARCEL operational data a farmer entered about one field, and a calendar is a regional reference — using one to
 * date the other would present a generic timeline as a statement about somebody's actual soil. The function names the
 * refusal so a future caller finds the reasoning instead of writing the join.
 */
export function currentStageForFarm(): never {
  throw new Error(
    'The platform does not compute a farm\'s current growth stage. Calendar day offsets are relative to sowing and are regional reference data; crop_seasons.sown_on is one farmer\'s entry about one parcel. Joining them would present a generic timeline as a fact about their field. See W110\'s honestly-absent rule.');
}

/* ------------------------------------------------------------------ the mandi mapping (DELTA-008's other half) */

export const AGMARKNET_PROVIDER = 'agmarknet';
/** Agmarknet commodity codes as the canon shows them (AGM-1101). Kept loose enough for the real registry's variants but
 *  tight enough that a mandi code or a free-text crop name cannot be pasted in by mistake. */
const COMMODITY_CODE_RE = /^[A-Z]{2,6}-?[0-9]{2,8}$/;

export interface MappingInput { productId: string; externalId: string }
export interface Mapping { productId: string; externalId: string; providerCode: string }

/**
 * Validate a product ↔ Agmarknet commodity mapping.
 *
 * IT IS A PRODUCT, NOT A CROP, and that is the correction this wave makes to the canon's own screen. `mandi_prices` keys
 * on `product_id`; a category-level mapping would look right on the admin table and resolve to no price at all on the
 * farmer's Mandi Pulse. The crop row shows a ROLLUP over its products instead.
 */
export function assertMapping(input: MappingInput): Mapping {
  const productId = String(input.productId ?? '').trim();
  if (!UUID_RE.test(productId)) {
    throw new InvalidMandiMappingError('a mapping attaches to a PRODUCT, identified by uuid — mandi prices key on product_id, so a crop-level mapping would resolve to no price');
  }
  const externalId = String(input.externalId ?? '').trim().toUpperCase();
  if (!COMMODITY_CODE_RE.test(externalId)) {
    throw new InvalidMandiMappingError('the Agmarknet commodity code looks like AGM-1101 — this is the COMMODITY code, not a mandi (market) code');
  }
  return { productId, externalId, providerCode: AGMARKNET_PROVIDER };
}

/** Sync states `external_entity_refs` already models. `pending` is what a fresh mapping is until the ingest confirms the
 *  code resolves upstream — claiming `synced` on insert would assert something nobody has checked. */
export const SYNC_STATES = ['pending', 'synced', 'failed', 'conflict'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/**
 * The W023 rollup: how many products in a crop branch carry a mapping.
 *
 * Returns `null` for the share when the branch has NO products. A crop with nothing to map is not 0% mapped — it is a
 * crop nobody has created products for, and a red "unmapped" badge beside it would be a criticism of nothing. Same
 * unknown-≠-zero rule the coverage matrix follows.
 */
export function mappingRollup(
  products: ReadonlyArray<{ productId: string; externalId?: string | null }>,
): { total: number; mapped: number; pct: number | null; state: 'none' | 'partial' | 'all' | 'no_products' } {
  const total = products.length;
  if (total === 0) return { total: 0, mapped: 0, pct: null, state: 'no_products' };
  const mapped = products.filter((p) => !!p.externalId).length;
  return {
    total, mapped,
    pct: Math.round((mapped / total) * 100),
    state: mapped === 0 ? 'none' : mapped === total ? 'all' : 'partial',
  };
}
