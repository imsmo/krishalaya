// modules/twin/domain/twin-rules.ts · PC-56 TENANT-12 · THE DIGITAL TWIN'S RULES. PURE (no I/O, no float on a figure).
//
// THE LAW (brief §A, survey F-1): no figure that no registered model and recorded run produced — ever. A band may be shown only
// where (a) a model code + version is registered in `ai_models` at production/canary, (b) a `twin_runs` row records the input
// snapshot hash, the assumption values with their cited sources, the pinned model version and the seed, (c) the outputs are
// stored with that row and an `ai_inferences` row points at it, (d) the page shows model code + version + the AI disclosure.
// `gateVerdict` decides (a) and (the runner); `bandShown` decides (b)–(c) for a stored run; the API never carries a band the
// latter did not pass. No model is registered this wave, so `gateVerdict` answers TWIN_NO_MODEL_REGISTERED and every results
// cell is "Too few runs — no registered model".
//
// MEASURED FACTS are a different thing and never carry an AI badge: parcels mapped of registered, soil tests and their latest
// sampled-on, seasons, registered devices, feed as-ofs, and the one W422 fact — actual yield, last full season, qtl/ha — which
// prints only where the yield unit AND the parcel area unit convert (`yieldFact`), over at least `twin.min_group_size` members.

/* ------------------------------------------------------------------------------------------------------------ */
/* VOCABULARY                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** The `ai_models.code` a scenario model would be registered under. Nothing is registered under it today. */
export const TWIN_MODEL_CODE = 'twin.scenario';
export const ASSUMPTION_UNITS = ['pct', 'hectare'] as const;
export type AssumptionUnit = (typeof ASSUMPTION_UNITS)[number];
export const MIN_CITATION = 10;
export const MAX_CITATION = 500;
export const MIN_NAME = 3;
export const MAX_NAME = 120;
export const MIN_REASON = 3;
export const MAX_REASON = 300;
/** A value: an optional sign, up to 9 integer digits, up to 4 decimals (numeric(14,4)). */
const VALUE_RE = /^-?\d{1,9}(\.\d{1,4})?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface KeyDef { code: string; unit: AssumptionUnit; min: string; max: string }
export interface TemplateDef { code: string; keys: string[] }

/** What the canon draws that this platform cannot stand behind — each printed on its page by name, never faked. */
export const TWIN_REFUSED_BY_NAME = [
  'model',            // W421/W422 "twin-model v0.9 · AI-labelled", P10/P50/P90 of 500 runs — no model is registered (ai_models)
  'runHash',          // W421 "run 7a1c…9e02" — no run has ever happened; a refused attempt is not a run
  'replay',           // W421 "Replay" — nothing to replay
  'sourceDefaults',   // W421 "−20% (IMD historical baseline)", "+4% (input cost index)" — no such series is recorded here
  'deviceReadings',   // W420 "Soil pods · 30-min", "Weather masts · hourly" — registry only; no readings, no ingestion
  'alertIngestion',   // W420 weather row — IMD / Skymet are not connected; weather_alerts has no ingesting writer
  'herdSync',         // W420 "Herd synced … BMC-linked" — animals carry no BMC link and no INAPH sync exists
  'parcelSurvey',     // W420 "Parcel survey · quarterly · Q2-2026" — no survey object exists
  'memberProfiles',   // W420 "Member profiles 1,240 · all licensed members" — "licensed member" is defined nowhere
  'districtDrill',    // W422 district drill — aggregate-only, and no aggregate band exists to drill into
  'mapLayer',         // W420 "shown as such on every map layer" — no map layer exists in this console
] as const;
export type TwinRefusal = (typeof TWIN_REFUSED_BY_NAME)[number];

/* ------------------------------------------------------------------------------------------------------------ */
/* THE GATE                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export interface ServingModel { id: string; code: string; version: string; status: string }
export type GateCode = 'TWIN_NO_MODEL_REGISTERED' | 'TWIN_NO_RUNNER';
export type GateVerdict = { allowed: false; code: GateCode; model: ServingModel | null } | { allowed: true; model: ServingModel };

/**
 * May a run be queued? Only behind a model registered at production/canary under TWIN_MODEL_CODE — AND a runner that can execute
 * it. No runner exists in this codebase (apps/ai-services has no scenario model), so a registered model would still be refused,
 * by its own name (TWIN_NO_RUNNER). `runnerAvailable` is a parameter so the day one is built is a one-line change with a test.
 */
export function gateVerdict(model: ServingModel | null, runnerAvailable = false): GateVerdict {
  if (!model || (model.status !== 'production' && model.status !== 'canary') || model.code !== TWIN_MODEL_CODE) {
    return { allowed: false, code: 'TWIN_NO_MODEL_REGISTERED', model: null };
  }
  if (!runnerAvailable) return { allowed: false, code: 'TWIN_NO_RUNNER', model };
  return { allowed: true, model };
}

export interface StoredRun {
  status: string; modelCode: string | null; modelVersion: string | null; inputSnapshotHash: string | null; seed: string | null;
  outputs: unknown; aiInferenceId: string | null;
}
/** A band may be shown ONLY from a done run that names model, version, input hash, seed, outputs AND its inference. */
export function bandShown(run: StoredRun | null): boolean {
  return !!run && run.status === 'done' && !!run.modelCode && !!run.modelVersion && !!run.inputSnapshotHash && run.seed !== null
    && run.outputs !== null && run.outputs !== undefined && !!run.aiInferenceId;
}
/** The results cell for one scenario in a pair: a band (never today) or the honest state. */
export type ResultsCell = { state: 'band'; runId: string } | { state: 'too_few_runs_no_model' } | { state: 'too_few_runs' };
export function resultsCell(runs: Array<StoredRun & { id: string }>, modelRegistered: boolean): ResultsCell {
  const done = runs.find((r) => bandShown(r));
  if (done) return { state: 'band', runId: done.id };
  return modelRegistered ? { state: 'too_few_runs' } : { state: 'too_few_runs_no_model' };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE SNAPSHOT (the replay key a future run is pinned by)                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

export interface AssumptionValue { key: string; value: string; unit: string; citation: string; asOf: string }
/** Canonical, order-independent JSON of what an attempt was made with — hashed (sha256) by the service. */
export function canonicalSnapshot(rows: AssumptionValue[]): string {
  const norm = [...rows].map((r) => ({ key: r.key, value: normaliseValue(r.value) ?? r.value, unit: r.unit, citation: r.citation.trim(), asOf: r.asOf }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify(norm);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* DECIMALS (exact — strings and bigints, never IEEE float)                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

/** `'-07.50'` → `'-7.5'`; null when not a value. Exact (string arithmetic). */
export function normaliseValue(raw: string): string | null {
  const s = raw.trim();
  if (!VALUE_RE.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const int = i.replace(/^0+(?=\d)/, '');
  const frac = f.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return out === '0' ? '0' : `${neg ? '-' : ''}${out}`;
}
/** A value as ten-thousandths (bigint). */
export function toTenThou(v: string): bigint {
  const n = normaliseValue(v);
  if (n === null) throw new Error(`not a value: ${v}`);
  const neg = n.startsWith('-');
  const [i, f = ''] = (neg ? n.slice(1) : n).split('.');
  const b = BigInt(i + (f + '0000').slice(0, 4));
  return neg ? -b : b;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ASSUMPTIONS REVIEW (W2800 form-error = W2801 review with refusals)                                       */
/* ------------------------------------------------------------------------------------------------------------ */

export type AssumptionRefusalCode =
  | 'NO_PERMISSION' | 'SCENARIO_ARCHIVED' | 'NO_ASSUMPTIONS' | 'KEY_UNKNOWN' | 'KEY_DUPLICATE' | 'KEY_NOT_IN_TEMPLATE'
  | 'VALUE_REQUIRED' | 'VALUE_INVALID' | 'VALUE_OUT_OF_RANGE' | 'UNIT_MISMATCH'
  | 'CITATION_REQUIRED' | 'CITATION_TOO_SHORT' | 'CITATION_TOO_LONG' | 'CITATION_HAS_MARKUP'
  | 'ASOF_REQUIRED' | 'ASOF_INVALID' | 'ASOF_FUTURE' | 'NOTHING_CHANGED';
export interface Refusal { field: string | null; code: string }
export interface AssumptionInput { key: string; value?: string | null; unit?: string | null; citation?: string | null; asOf?: string | null }
export interface AssumptionReview {
  ready: boolean; refusals: Refusal[];
  rows: Array<{ key: string; unit: AssumptionUnit | null; value: string | null; citation: string | null; asOf: string | null; changed: boolean }>;
  diff: Array<{ key: string; before: AssumptionValue | null; after: AssumptionValue }>;
  setKeys: string[];
}

const isCivilDay = (s: string) => {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * The review the API computes before any write — and re-computes on the locked rows at the write. Every refusal, against the field
 * to blame (`<key>.value`, `<key>.citation`, …). A citation and an as-of are REQUIRED for every value (0190's NOT NULLs are the
 * floor under this): a number without a source is not stored.
 */
export function reviewAssumptions(input: AssumptionInput[], f: {
  canRun: boolean; archived: boolean; keys: KeyDef[]; templateKeys: string[] | null; today: string;
  current: Map<string, AssumptionValue>;
}): AssumptionReview {
  const refusals: Refusal[] = [];
  if (!f.canRun) refusals.push({ field: null, code: 'NO_PERMISSION' });
  if (f.archived) refusals.push({ field: null, code: 'SCENARIO_ARCHIVED' });
  if (input.length === 0) refusals.push({ field: null, code: 'NO_ASSUMPTIONS' });
  const byCode = new Map(f.keys.map((k) => [k.code, k]));
  const seen = new Set<string>();
  const rows: AssumptionReview['rows'] = [];
  const diff: AssumptionReview['diff'] = [];
  for (const a of input) {
    const key = (a.key ?? '').trim();
    const def = byCode.get(key);
    if (!def) { refusals.push({ field: `${key || '?'}.key`, code: 'KEY_UNKNOWN' }); continue; }
    if (seen.has(key)) { refusals.push({ field: `${key}.key`, code: 'KEY_DUPLICATE' }); continue; }
    seen.add(key);
    if (f.templateKeys && f.templateKeys.length > 0 && !f.templateKeys.includes(key)) refusals.push({ field: `${key}.key`, code: 'KEY_NOT_IN_TEMPLATE' });
    const before = refusals.length;
    const rawValue = (a.value ?? '').trim();
    const value = rawValue ? normaliseValue(rawValue) : null;
    if (!rawValue) refusals.push({ field: `${key}.value`, code: 'VALUE_REQUIRED' });
    else if (value === null) refusals.push({ field: `${key}.value`, code: 'VALUE_INVALID' });
    else if (toTenThou(value) < toTenThou(def.min) || toTenThou(value) > toTenThou(def.max)) refusals.push({ field: `${key}.value`, code: 'VALUE_OUT_OF_RANGE' });
    const unit = (a.unit ?? def.unit).trim();
    if (unit !== def.unit) refusals.push({ field: `${key}.unit`, code: 'UNIT_MISMATCH' });
    const citation = (a.citation ?? '').trim();
    if (!citation) refusals.push({ field: `${key}.citation`, code: 'CITATION_REQUIRED' });
    else if (citation.length < MIN_CITATION) refusals.push({ field: `${key}.citation`, code: 'CITATION_TOO_SHORT' });
    else if (citation.length > MAX_CITATION) refusals.push({ field: `${key}.citation`, code: 'CITATION_TOO_LONG' });
    else if (/[<>]/.test(citation)) refusals.push({ field: `${key}.citation`, code: 'CITATION_HAS_MARKUP' });
    const asOf = (a.asOf ?? '').trim();
    if (!asOf) refusals.push({ field: `${key}.asOf`, code: 'ASOF_REQUIRED' });
    else if (!isCivilDay(asOf)) refusals.push({ field: `${key}.asOf`, code: 'ASOF_INVALID' });
    else if (asOf > f.today) refusals.push({ field: `${key}.asOf`, code: 'ASOF_FUTURE' });
    const ok = refusals.length === before;
    const cur = f.current.get(key) ?? null;
    const after: AssumptionValue | null = ok && value !== null ? { key, value, unit: def.unit, citation, asOf } : null;
    const changed = !!after && (!cur || normaliseValue(cur.value) !== after.value || cur.citation.trim() !== after.citation || cur.asOf !== after.asOf || cur.unit !== after.unit);
    rows.push({ key, unit: def.unit, value, citation: citation || null, asOf: asOf || null, changed });
    if (after && changed) diff.push({ key, before: cur, after });
  }
  if (refusals.length === 0 && diff.length === 0 && input.length > 0) refusals.push({ field: null, code: 'NOTHING_CHANGED' });
  const setKeys = Array.from(new Set([...f.current.keys(), ...diff.map((d) => d.key)]));
  return { ready: refusals.length === 0, refusals, rows, diff, setKeys };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE SCENARIO REVIEW (create from template)                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export type ScenarioRefusalCode = 'NO_PERMISSION' | 'NAME_REQUIRED' | 'NAME_TOO_SHORT' | 'NAME_TOO_LONG' | 'TEMPLATE_UNKNOWN' | 'PRODUCT_UNKNOWN';
export interface ScenarioInput { name?: string | null; templateCode?: string | null; productId?: string | null }
export function reviewScenario(input: ScenarioInput, f: { canRun: boolean; templates: TemplateDef[]; productKnown: boolean | null }) {
  const refusals: Refusal[] = [];
  if (!f.canRun) refusals.push({ field: null, code: 'NO_PERMISSION' });
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) refusals.push({ field: 'name', code: 'NAME_REQUIRED' });
  else if (name.length < MIN_NAME) refusals.push({ field: 'name', code: 'NAME_TOO_SHORT' });
  else if (name.length > MAX_NAME) refusals.push({ field: 'name', code: 'NAME_TOO_LONG' });
  const templateCode = (input.templateCode ?? '').trim() || null;
  const template = templateCode ? f.templates.find((t) => t.code === templateCode) ?? null : null;
  if (templateCode && !template) refusals.push({ field: 'templateCode', code: 'TEMPLATE_UNKNOWN' });
  const productId = (input.productId ?? '').trim() || null;
  if (productId && f.productKnown === false) refusals.push({ field: 'productId', code: 'PRODUCT_UNKNOWN' });
  return { ready: refusals.length === 0, refusals, name, templateCode, productId, keys: template?.keys ?? [] };
}

export function reasonRefusal(raw: string | null | undefined): 'REASON_REQUIRED' | 'REASON_TOO_SHORT' | 'REASON_TOO_LONG' | null {
  const s = (raw ?? '').trim();
  if (!s) return 'REASON_REQUIRED';
  if (s.length < MIN_REASON) return 'REASON_TOO_SHORT';
  if (s.length > MAX_REASON) return 'REASON_TOO_LONG';
  return null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ONE W422 FACT — actual yield, last full season, qtl/ha                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** A unit factor as an exact rational (numerator / denominator), built from `unit_conversions.factor` strings. */
export interface Ratio { num: bigint; den: bigint }
const SCALE = 10_000_000_000n; // unit_conversions.factor is numeric(20,10)
export function ratioOf(factor: string): Ratio {
  const [i, f = ''] = factor.trim().split('.');
  return { num: BigInt(i + (f + '0000000000').slice(0, 10)), den: SCALE };
}
const mul = (a: Ratio, b: Ratio): Ratio => ({ num: a.num * b.num, den: a.den * b.den });
const inv = (a: Ratio): Ratio => ({ num: a.den, den: a.num });

/** from → to as a rational, walking `unit_conversions` both ways (BFS). null = no path (not comparable). */
export function conversion(from: string, to: string, edges: Array<{ from: string; to: string; factor: string }>): Ratio | null {
  if (from === to) return { num: 1n, den: 1n };
  const adj = new Map<string, Array<{ to: string; r: Ratio }>>();
  for (const e of edges) {
    const r = ratioOf(e.factor);
    if (r.num === 0n) continue;
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push({ to: e.to, r });          // 1 from = factor to
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push({ to: e.from, r: inv(r) });
  }
  const seen = new Set([from]);
  const queue: Array<{ unit: string; r: Ratio }> = [{ unit: from, r: { num: 1n, den: 1n } }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur.unit) ?? []) {
      if (seen.has(n.to)) continue;
      const r = mul(cur.r, n.r);
      if (n.to === to) return r;
      seen.add(n.to); queue.push({ unit: n.to, r });
    }
  }
  return null;
}

export interface HarvestRow { ownerUserId: string; year: number; season: string; harvestedAt: string; actualYield: string | null; yieldUnit: string | null; area: string; areaUnit: string }
export type YieldFact =
  | { state: 'shown'; qtlPerHa: string; year: number; season: string; seasons: number; members: number; notComparable: number }
  | { state: 'no_harvest' }
  | { state: 'not_comparable_unit_missing'; year: number; season: string; seasons: number }
  | { state: 'below_group_floor'; year: number; season: string; members: number; floor: number }
  | { state: 'no_crop' };

const decimalToMilli = (v: string, places: number): bigint => { const [i, f = ''] = v.split('.'); return BigInt(i + (f + '0'.repeat(places)).slice(0, places)); };

/**
 * Actual yield over the LAST FULL SEASON of one crop, in quintal per hectare — a measured fact, printed with one decimal.
 *   • the last full season = the (year, season) of the most recently recorded harvest of this crop in this tenant;
 *   • a season is COMPARABLE only when its yield unit converts to quintal AND its parcel's area unit converts to hectare
 *     (`unit_conversions`); the rest are counted as "not comparable — unit missing" and excluded, never guessed;
 *   • Σ yield (qtl) ÷ Σ area (ha) over the comparable seasons, exact rational arithmetic, rounded half-up to 0.1;
 *   • over at least `floor` distinct members (twin.min_group_size) — below it the fact is not shown (aggregate-only, W422).
 */
export function yieldFact(rows: HarvestRow[], edges: Array<{ from: string; to: string; factor: string }>, floor: number): YieldFact {
  const harvested = rows.filter((r) => r.actualYield !== null);
  if (harvested.length === 0) return { state: 'no_harvest' };
  const last = [...harvested].sort((a, b) => (b.year - a.year) || (a.harvestedAt < b.harvestedAt ? 1 : a.harvestedAt > b.harvestedAt ? -1 : 0))[0];
  const inSeason = harvested.filter((r) => r.year === last.year && r.season === last.season);
  let qNum = 0n, qDen = 1n, aNum = 0n, aDen = 1n; let notComparable = 0; const members = new Set<string>(); let comparable = 0;
  for (const r of inSeason) {
    const yq = r.yieldUnit ? conversion(r.yieldUnit, 'quintal', edges) : null;
    const ah = conversion(r.areaUnit, 'hectare', edges);
    if (!yq || !ah) { notComparable++; continue; }
    // yield (thousandths) × factor → quintals; area (ten-thousandths) × factor → hectares — summed as exact fractions
    const y: Ratio = { num: decimalToMilli(r.actualYield as string, 3) * yq.num, den: 1000n * yq.den };
    const a: Ratio = { num: decimalToMilli(r.area, 4) * ah.num, den: 10_000n * ah.den };
    qNum = qNum * y.den + y.num * qDen; qDen = qDen * y.den;
    aNum = aNum * a.den + a.num * aDen; aDen = aDen * a.den;
    members.add(r.ownerUserId); comparable++;
  }
  if (comparable === 0) return { state: 'not_comparable_unit_missing', year: last.year, season: last.season, seasons: inSeason.length };
  if (members.size < floor) return { state: 'below_group_floor', year: last.year, season: last.season, members: members.size, floor };
  if (aNum === 0n) return { state: 'not_comparable_unit_missing', year: last.year, season: last.season, seasons: inSeason.length };
  // (qNum/qDen) / (aNum/aDen) to one decimal, half-up
  const tenths = (qNum * aDen * 10n * 2n + qDen * aNum) / (qDen * aNum * 2n);
  const qtlPerHa = `${tenths / 10n}.${tenths % 10n}`;
  return { state: 'shown', qtlPerHa, year: last.year, season: last.season, seasons: comparable, members: members.size, notComparable };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* FRESHNESS (9d's pattern: a fact carries its as-of; without one it is not shown)                              */
/* ------------------------------------------------------------------------------------------------------------ */

export type FeedState = 'live' | 'recorded' | 'none' | 'not_connected';
export interface FeedRow { code: string; sourceTables: string[]; state: FeedState; asOf: string | null; detail: Record<string, string | number | boolean | null> }
