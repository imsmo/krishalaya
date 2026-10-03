// apps/web-tenant/src/features/twin/twin.ts · PC-56 TENANT-12 · THE DIGITAL TWIN, in the console. PURE.
//
// W420 (`/twin`; canon slug `twin/overview` redirects) — the ground truth with as-ofs, or the Locked page when the API's
// `digital_twin` flag is off (GET /twin/access is the one read outside the flag); W421 (`/twin/scenarios`) — scenarios, the cited
// assumptions sheet with its history; W422 (`/twin/scenarios/results`, the canon route comment — the catalog's `…/compare` is
// noted, F-17) — every band cell "Too few runs — no registered model", the one measured fact, "Send as proposal" → "no run to
// cite". Chains: the form chain W2800–W2803 (`/twin/scenarios/new` create · `/twin/scenarios/[id]/assumptions` save) and the
// mutate chain W2804–W2806 (`/twin/scenarios/[id]/act` run · archive; `/twin/ask` the Locked page's one ask). Every back / retry
// link returns to the ORIGINATING screen (F-18 — the canon points all seven at W420).
//
// THE RULE THIS FILE EXISTS FOR: the console never prints a figure the API did not pass. No model is registered, so there is no
// band, no P10/P50/P90, no run hash, no "500 runs" and no AI badge anywhere in this area; measured facts print with their source
// and as-of and never with an AI badge. Every word is a key (Law 7); every list mirrors the API's (the console spec reads both).
import type { TwinFeed, TwinResultsCell, TwinYieldFact } from '@krishalaya/sdk-js';

export const TWIN_HREF = '/twin';
export const SCENARIOS_HREF = '/twin/scenarios';
export const RESULTS_HREF = '/twin/scenarios/results';
export const NEW_SCENARIO_HREF = '/twin/scenarios/new';
export const ASK_HREF = '/twin/ask';
export const PLAN_HREF = '/plan';
export const scenarioHref = (id: string) => `${SCENARIOS_HREF}?id=${encodeURIComponent(id)}`;
export const assumptionsBase = (id: string) => `${SCENARIOS_HREF}/${encodeURIComponent(id)}/assumptions`;
export const assumptionsHref = (id: string) => `${assumptionsBase(id)}?step=edit`;
export const actBase = (id: string) => `${SCENARIOS_HREF}/${encodeURIComponent(id)}/act`;
export const actHref = (id: string, act: TwinAct) => `${actBase(id)}?step=confirm&act=${act}`;
export const resultsHref = (a: string, b?: string | null) => `${RESULTS_HREF}?a=${encodeURIComponent(a)}${b ? `&b=${encodeURIComponent(b)}` : ''}`;

/* ---------------------------------------------------------------------------------------------------------- */
/* THE API'S OWN LISTS (mirrored; the console spec asserts they agree)                                        */
/* ---------------------------------------------------------------------------------------------------------- */

export const SCENARIO_STATUSES = ['draft', 'ready', 'archived'] as const;
export const TEMPLATE_CODES = ['rainfall_shock', 'price_shock', 'input_cost_shock', 'drip_adoption'] as const;
export const KEY_CODES = ['rainfall_delta_pct', 'price_delta_pct', 'input_cost_delta_pct', 'drip_adoption_pct', 'member_profile_area_ha'] as const;
export const DEVICE_KINDS = ['soil_pod', 'weather_mast'] as const;
export const FEED_CODES = ['parcel_register', 'soil_tests', 'devices', 'mandi_prices', 'weather_forecast'] as const;
export const TWIN_ACTS = ['run', 'archive'] as const;
export type TwinAct = (typeof TWIN_ACTS)[number];
export const TWIN_REFUSED_BY_NAME = ['model', 'runHash', 'replay', 'sourceDefaults', 'deviceReadings', 'alertIngestion', 'herdSync', 'parcelSurvey', 'memberProfiles', 'districtDrill', 'mapLayer'] as const;
/** The review refusals (scenario + assumptions), the act refusals and the gate's codes — each a sentence. */
export const REFUSAL_CODES = [
  'NO_PERMISSION', 'NAME_REQUIRED', 'NAME_TOO_SHORT', 'NAME_TOO_LONG', 'TEMPLATE_UNKNOWN', 'PRODUCT_UNKNOWN',
  'SCENARIO_ARCHIVED', 'NO_ASSUMPTIONS', 'KEY_UNKNOWN', 'KEY_DUPLICATE', 'KEY_NOT_IN_TEMPLATE', 'VALUE_REQUIRED', 'VALUE_INVALID', 'VALUE_OUT_OF_RANGE',
  'UNIT_MISMATCH', 'CITATION_REQUIRED', 'CITATION_TOO_SHORT', 'CITATION_TOO_LONG', 'CITATION_HAS_MARKUP', 'ASOF_REQUIRED', 'ASOF_INVALID', 'ASOF_FUTURE',
  'NOTHING_CHANGED', 'REASON_REQUIRED', 'REASON_TOO_SHORT', 'REASON_TOO_LONG',
] as const;
export const GATE_CODES = ['TWIN_NO_MODEL_REGISTERED', 'TWIN_NO_RUNNER'] as const;
export const TRANSPORT_CODES = ['DATABASE_REFUSED', 'TWIN_REFUSED', 'TWIN_FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'FORBIDDEN', 'unknown'] as const;
/** Mirrors the API's bounds so a form says them before the route does. */
export const MIN_CITATION = 10;
export const MAX_CITATION = 500;
export const MIN_REASON = 3;
export const MAX_REASON = 300;
/** A run is never a mutation that succeeds today; Retry on its failure screen is a page load back to confirm. */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isAct = (v: unknown): v is TwinAct => has(TWIN_ACTS, v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* ---------------------------------------------------------------------------------------------------------- */
/* KEYS                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------- */

export const statusKey = (s: string) => `twin.status.${has(SCENARIO_STATUSES, s) ? s : 'unknown'}`;
export const templateKey = (c: string | null | undefined) => (c && has(TEMPLATE_CODES, c) ? `twin.template.${c}` : 'twin.template.none');
export const keyLabel = (c: string) => `twin.key.${has(KEY_CODES, c) ? c : 'unknown'}`;
export const unitKey = (u: string | null | undefined) => `twin.unit.${u === 'hectare' ? 'hectare' : u === 'pct' ? 'pct' : 'unknown'}`;
export const deviceKindKey = (k: string) => `twin.device.${has(DEVICE_KINDS, k) ? k : 'unknown'}`;
export const feedNameKey = (c: string) => `twin.feed.${has(FEED_CODES, c) ? c : 'unknown'}.name`;
export const byNameKey = (r: string) => `twin.byName.${has(TWIN_REFUSED_BY_NAME, r) ? r : 'other'}`;
export function refusalKey(code: string): string {
  if (has(REFUSAL_CODES, code) || has(GATE_CODES, code) || has(TRANSPORT_CODES, code)) return `twin.refusal.${code}`;
  return 'twin.refusal.unknown';
}
/** The results cell — never a band today; the sentence for each honest state. */
export function cellKey(cell: TwinResultsCell): string {
  if (cell.state === 'too_few_runs_no_model') return 'twin.cell.tooFewNoModel';
  if (cell.state === 'too_few_runs') return 'twin.cell.tooFew';
  return 'twin.cell.band';
}
/** THE CONSOLE'S HALF OF THE GATE: a band is drawn only for a `band` cell (which the API never returns while no model exists). */
export const bandShown = (cell: TwinResultsCell): boolean => cell.state === 'band';

/** The page state from a transport failure: 404 on the area's own read = the flag is off (Locked / flagged off); 403 = no twin.view. */
export function twinState(code: string | undefined, status?: number, forId = false): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'TWIN_FORBIDDEN' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (status === 403 && (!code || !has(TRANSPORT_CODES, code))) return ['FORBIDDEN'];
  if (status === 404 && (!code || !has(TRANSPORT_CODES, code))) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A FEED ROW AND THE FACT SAY (sentences, vars handed to the page's formatter)                          */
/* ---------------------------------------------------------------------------------------------------------- */

export type Line = { key: string; vars: Record<string, string> };
/** One feed row's sentence. Numbers are formatted by the page (`fmt`); dates arrive as the API gave them. */
export function feedLine(f: TwinFeed, fmt: (n: number) => string): Line {
  const d = f.detail; const n = (k: string) => fmt(Number(d[k] ?? 0));
  switch (f.code) {
    case 'parcel_register': return f.state === 'none' ? { key: 'twin.feed.parcel_register.none', vars: {} } : { key: 'twin.feed.parcel_register.recorded', vars: { registered: n('registered'), mapped: n('mapped') } };
    case 'soil_tests': return f.state === 'none' ? { key: 'twin.feed.soil_tests.none', vars: {} } : { key: 'twin.feed.soil_tests.recorded', vars: { tests: n('tests'), parcels: n('parcelsTested') } };
    case 'devices': return { key: 'twin.feed.devices.registryOnly', vars: { pods: n('soilPods'), masts: n('weatherMasts') } };
    case 'mandi_prices': return f.state === 'recorded'
      ? { key: 'twin.feed.mandi_prices.platform', vars: { rows: n('platformRows'), tenant: n('tenantObservations') } }
      : { key: 'twin.feed.mandi_prices.none', vars: { tenant: n('tenantObservations') } };
    case 'weather_forecast': return d.forecastLive
      ? { key: 'twin.feed.weather_forecast.live', vars: { provider: String(d.provider ?? '') } }
      : { key: 'twin.feed.weather_forecast.none', vars: {} };
    default: return { key: 'twin.feed.unknown', vars: {} };
  }
}
/** The as-of cell: a date, or the honest reason there is none (never a dash that reads as "today"). */
export function asOfKey(f: TwinFeed): string {
  if (f.asOf) return 'twin.asOf.at';
  if (f.code === 'weather_forecast') return f.detail.forecastLive ? 'twin.asOf.onDemand' : 'twin.asOf.none';
  if (f.code === 'devices') return 'twin.asOf.noReadings';
  return 'twin.asOf.none';
}

/** The one W422 fact — actual yield, last full season, qtl/ha — or why it is not shown. */
export function factLine(f: TwinYieldFact, fmt: (n: number) => string): Line {
  switch (f.state) {
    case 'shown': return { key: 'twin.fact.shown', vars: { value: f.qtlPerHa, season: f.season, year: String(f.year), members: fmt(f.members), seasons: fmt(f.seasons) } };
    case 'not_comparable_unit_missing': return { key: 'twin.fact.notComparable', vars: { season: f.season, year: String(f.year), seasons: fmt(f.seasons) } };
    case 'below_group_floor': return { key: 'twin.fact.belowFloor', vars: { members: fmt(f.members), floor: fmt(f.floor) } };
    case 'no_crop': return { key: 'twin.fact.noCrop', vars: {} };
    default: return { key: 'twin.fact.noHarvest', vars: {} };
  }
}
export const seasonKey = (s: string) => `twin.season.${s === 'kharif' || s === 'rabi' || s === 'zaid' || s === 'perennial' ? s : 'unknown'}`;

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORMS' VALUES IN THE URL (6d-4's mechanism)                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export interface ScenarioValues { name: string; templateCode: string; productId: string; productQ: string }
export function scenarioValues(sp: Record<string, string | string[] | undefined>): ScenarioValues {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const tpl = one('templateCode');
  return { name: one('name').slice(0, 200), templateCode: has(TEMPLATE_CODES, tpl) ? tpl : '', productId: isUuid(one('productId')) ? one('productId') : '', productQ: one('productQ').slice(0, 60) };
}
/** Per key: `v_<key>` value, `c_<key>` citation, `a_<key>` as-of. Unknown keys are dropped. */
export interface AssumptionValues { [key: string]: { value: string; citation: string; asOf: string } }
export function assumptionValues(sp: Record<string, string | string[] | undefined>, keys: readonly string[]): AssumptionValues {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const out: AssumptionValues = {};
  for (const k of keys) if (has(KEY_CODES, k)) out[k] = { value: one(`v_${k}`).trim().slice(0, 20), citation: one(`c_${k}`).trim().slice(0, MAX_CITATION + 50), asOf: one(`a_${k}`).trim().slice(0, 10) };
  return out;
}
export function assumptionCarry(v: AssumptionValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) { if (x.value) out[`v_${k}`] = x.value; if (x.citation) out[`c_${k}`] = x.citation; if (x.asOf) out[`a_${k}`] = x.asOf; }
  return out;
}
/** Only the keys a person actually filled travel to the API (an untouched key is not "set to empty"). */
export function assumptionInput(v: AssumptionValues): Array<{ key: string; value: string; citation: string; asOf: string }> {
  return Object.entries(v).filter(([, x]) => x.value || x.citation || x.asOf).map(([key, x]) => ({ key, value: x.value, citation: x.citation, asOf: x.asOf }));
}
/** Three cited values in three languages is longer than 1,500 characters; the form declares its own ceiling (7b's rule). */
export const MAX_CARRIED_ASSUMPTIONS = 4000;
/** The field a refusal points at (`rainfall_delta_pct.citation`) as the form's input name (`c_rainfall_delta_pct`). */
export function inputNameOf(field: string | null): string | null {
  if (!field) return null;
  const [k, part] = field.split('.');
  return part === 'value' ? `v_${k}` : part === 'citation' ? `c_${k}` : part === 'asOf' ? `a_${k}` : null;
}
