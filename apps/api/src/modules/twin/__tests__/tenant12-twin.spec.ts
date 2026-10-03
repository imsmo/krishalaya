// modules/twin/__tests__/tenant12-twin.spec.ts · PC-56 TENANT-12 · the twin's pure rules (no infra). Each block would fail on HEAD
// 0a85b30 (no twin module, no gate, no assumption citations, no yield unit, no boundary validator, a job whose SQL could not parse).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TWIN_MODEL_CODE, TWIN_REFUSED_BY_NAME, bandShown, canonicalSnapshot, conversion, gateVerdict, normaliseValue, reasonRefusal, resultsCell,
  reviewAssumptions, reviewScenario, toTenThou, yieldFact, KeyDef, AssumptionValue,
} from '../domain/twin-rules';
import { actsFor, assertTransition, canTransition, statusAfterAssumptions } from '../domain/twin-scenario.state';
import { DUE_ALERTS_SQL, RECIPIENTS_SQL } from '../../land-soil-weather/jobs/weather-advisory-push.job';
import { RUNNER_AVAILABLE } from '../services/twin.service';

const KEYS: KeyDef[] = [
  { code: 'rainfall_delta_pct', unit: 'pct', min: '-100', max: '300' },
  { code: 'price_delta_pct', unit: 'pct', min: '-100', max: '300' },
  { code: 'drip_adoption_pct', unit: 'pct', min: '0', max: '100' },
  { code: 'member_profile_area_ha', unit: 'hectare', min: '0.01', max: '1000' },
];
const EDGES = [{ from: 'quintal', to: 'kg', factor: '100.0000000000' }, { from: 'ton', to: 'kg', factor: '1000.0000000000' }, { from: 'hectare', to: 'acre', factor: '2.4710500000' }];
const cite = 'IMD district rainfall statement, Junagadh, June 2026';

describe('PC-56 TENANT-12 · A — THE GATE: no figure without a registered model and a recorded run', () => {
  it('no model → TWIN_NO_MODEL_REGISTERED; a non-serving or foreign model is no model; a serving model without a runner → TWIN_NO_RUNNER', () => {
    expect(gateVerdict(null)).toEqual({ allowed: false, code: 'TWIN_NO_MODEL_REGISTERED', model: null });
    expect(gateVerdict({ id: 'm', code: TWIN_MODEL_CODE, version: '1', status: 'shadow' }).allowed).toBe(false);
    expect(gateVerdict({ id: 'm', code: 'price_bands', version: 'baseline-v1', status: 'production' })).toMatchObject({ code: 'TWIN_NO_MODEL_REGISTERED' });
    expect(gateVerdict({ id: 'm', code: TWIN_MODEL_CODE, version: '1', status: 'production' })).toMatchObject({ allowed: false, code: 'TWIN_NO_RUNNER' });
    expect(gateVerdict({ id: 'm', code: TWIN_MODEL_CODE, version: '1', status: 'canary' }, true)).toMatchObject({ allowed: true });
    // the service is told there is no runner — this constant changes only WITH a queued-path test
    expect(RUNNER_AVAILABLE).toBe(false);
  });
  it('a band is shown ONLY from a done run that names model, version, input hash, seed, outputs and its inference', () => {
    const done = { status: 'done', modelCode: TWIN_MODEL_CODE, modelVersion: '1', inputSnapshotHash: 'a'.repeat(64), seed: '7', outputs: { p50: 1 }, aiInferenceId: '9' };
    expect(bandShown(done)).toBe(true);
    for (const k of ['modelCode', 'modelVersion', 'inputSnapshotHash', 'aiInferenceId'] as const) expect(bandShown({ ...done, [k]: null })).toBe(false);
    expect(bandShown({ ...done, seed: null })).toBe(false);
    expect(bandShown({ ...done, outputs: null })).toBe(false);
    expect(bandShown({ ...done, status: 'refused' })).toBe(false);
    expect(bandShown(null)).toBe(false);
  });
  it('every results cell over refused attempts is "too few runs — no registered model"', () => {
    const refused = { id: 'r1', status: 'refused', modelCode: null, modelVersion: null, inputSnapshotHash: 'b'.repeat(64), seed: null, outputs: null, aiInferenceId: null };
    expect(resultsCell([], false)).toEqual({ state: 'too_few_runs_no_model' });
    expect(resultsCell([refused, refused], false)).toEqual({ state: 'too_few_runs_no_model' });
    expect(resultsCell([refused], true)).toEqual({ state: 'too_few_runs' });
  });
  it('the refusals the canon draws are named (model, run hash, replay, source defaults, readings, ingestion, herd sync, survey…)', () => {
    expect(TWIN_REFUSED_BY_NAME).toEqual(expect.arrayContaining(['model', 'runHash', 'replay', 'sourceDefaults', 'deviceReadings', 'alertIngestion', 'herdSync', 'parcelSurvey']));
  });
  it('the snapshot is canonical (order- and format-independent) — the replay key a future run is pinned by', () => {
    const a: AssumptionValue = { key: 'rainfall_delta_pct', value: '-20.00', unit: 'pct', citation: ` ${cite} `, asOf: '2026-06-30' };
    const b: AssumptionValue = { key: 'member_profile_area_ha', value: '1.2', unit: 'hectare', citation: 'FPO member census 2026, median holding', asOf: '2026-04-01' };
    expect(canonicalSnapshot([a, b])).toBe(canonicalSnapshot([b, { ...a, value: '-20' }]));
    expect(JSON.parse(canonicalSnapshot([a, b]))[1]).toEqual({ key: 'rainfall_delta_pct', value: '-20', unit: 'pct', citation: cite, asOf: '2026-06-30' });
  });
});

describe('PC-56 TENANT-12 · W421 — assumptions are typed WITH their source, or not at all', () => {
  const base = { canRun: true, archived: false, keys: KEYS, templateKeys: ['rainfall_delta_pct', 'member_profile_area_ha'], today: '2026-07-13', current: new Map<string, AssumptionValue>() };
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '*'}:${x.code}`);
  it('a value without a citation or an as-of is REFUSED — every refusal named against its field', () => {
    const r = reviewAssumptions([{ key: 'rainfall_delta_pct', value: '-20' }], base);
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(['rainfall_delta_pct.citation:CITATION_REQUIRED', 'rainfall_delta_pct.asOf:ASOF_REQUIRED']);
    const r2 = reviewAssumptions([{ key: 'rainfall_delta_pct', value: '-20', citation: 'IMD', asOf: '2026-07-14' }], base);
    expect(codes(r2)).toEqual(['rainfall_delta_pct.citation:CITATION_TOO_SHORT', 'rainfall_delta_pct.asOf:ASOF_FUTURE']);
  });
  it('keys, values, ranges, units and the template are judged', () => {
    const r = reviewAssumptions([
      { key: 'bogus', value: '1', citation: cite, asOf: '2026-07-01' },
      { key: 'rainfall_delta_pct', value: '-120', citation: cite, asOf: '2026-07-01' },
      { key: 'member_profile_area_ha', value: '1.2x', citation: cite, asOf: '2026-02-30' },
      { key: 'price_delta_pct', value: '5', unit: 'hectare', citation: cite, asOf: '2026-07-01' },
    ], base);
    expect(codes(r)).toEqual(expect.arrayContaining(['bogus.key:KEY_UNKNOWN', 'rainfall_delta_pct.value:VALUE_OUT_OF_RANGE', 'member_profile_area_ha.value:VALUE_INVALID',
      'member_profile_area_ha.asOf:ASOF_INVALID', 'price_delta_pct.key:KEY_NOT_IN_TEMPLATE', 'price_delta_pct.unit:UNIT_MISMATCH']));
  });
  it('a complete cited set is ready, with before/after per key; resaving the same values is NOTHING_CHANGED', () => {
    const input = [{ key: 'rainfall_delta_pct', value: '-20', citation: cite, asOf: '2026-06-30' }, { key: 'member_profile_area_ha', value: '1.20', citation: 'FPO member census 2026, median holding', asOf: '2026-04-01' }];
    const r = reviewAssumptions(input, base);
    expect(r.ready).toBe(true);
    expect(r.diff.map((d) => [d.key, d.before, d.after.value])).toEqual([['rainfall_delta_pct', null, '-20'], ['member_profile_area_ha', null, '1.2']]);
    expect(statusAfterAssumptions('draft', base.templateKeys, r.setKeys)).toBe('ready');
    const current = new Map(r.diff.map((d) => [d.key, d.after]));
    expect(codes(reviewAssumptions(input, { ...base, current }))).toEqual(['*:NOTHING_CHANGED']);
    expect(codes(reviewAssumptions(input, { ...base, canRun: false, archived: true }))).toEqual(expect.arrayContaining(['*:NO_PERMISSION', '*:SCENARIO_ARCHIVED']));
  });
  it('a scenario needs a name; templates and crops are checked', () => {
    const tpl = [{ code: 'rainfall_shock', keys: ['rainfall_delta_pct'] }];
    expect(reviewScenario({ name: '  Monsoon −20%  ', templateCode: 'rainfall_shock' }, { canRun: true, templates: tpl, productKnown: null })).toMatchObject({ ready: true, name: 'Monsoon −20%', keys: ['rainfall_delta_pct'] });
    expect(reviewScenario({ name: 'x', templateCode: 'nope', productId: 'p' }, { canRun: false, templates: tpl, productKnown: false }).refusals.map((x) => x.code))
      .toEqual(['NO_PERMISSION', 'NAME_TOO_SHORT', 'TEMPLATE_UNKNOWN', 'PRODUCT_UNKNOWN']);
    expect(reasonRefusal('')).toBe('REASON_REQUIRED'); expect(reasonRefusal('ok')).toBe('REASON_TOO_SHORT'); expect(reasonRefusal('superseded by SC-019')).toBeNull();
  });
  it('the scenario state machine: draft ⇄ ready → archived (final); run is offered on draft and ready, never on archived', () => {
    expect(canTransition('draft', 'ready')).toBe(true); expect(canTransition('ready', 'archived')).toBe(true);
    expect(() => assertTransition('archived', 'draft')).toThrow();
    expect(actsFor('draft')).toContain('run'); expect(actsFor('archived')).toEqual([]);
    expect(statusAfterAssumptions('draft', null, [])).toBe('draft');
  });
  it('decimals are exact strings — never IEEE float', () => {
    expect(normaliseValue('-07.50')).toBe('-7.5'); expect(normaliseValue('0.0000')).toBe('0'); expect(normaliseValue('1e3')).toBeNull();
    expect(toTenThou('0.1') + toTenThou('0.2')).toBe(toTenThou('0.3'));
  });
});

describe('PC-56 TENANT-12 · B9 — actual yield, last full season, qtl/ha: a measured fact only where both units convert', () => {
  const row = (owner: string, actual: string | null, yieldUnit: string | null, area: string, areaUnit: string, year = 2025, season = 'kharif', at = '2025-11-01T10:00:00') =>
    ({ ownerUserId: owner, year, season, harvestedAt: at, actualYield: actual, yieldUnit, area, areaUnit });
  it('converts kg / quintal / ton and acre / hectare exactly; Σ qtl ÷ Σ ha to one decimal', () => {
    expect(conversion('ton', 'quintal', EDGES)).toEqual({ num: 1000n * 10_000_000_000n * 10_000_000_000n, den: 10_000_000_000n * 100n * 10_000_000_000n });
    expect(conversion('acre', 'litre', EDGES)).toBeNull();
    const rows = [row('a', '20', 'quintal', '1', 'hectare'), row('b', '1800', 'kg', '2.47105', 'acre'), row('c', '2', 'ton', '1', 'hectare'),
      row('d', '19', 'quintal', '1', 'hectare'), row('e', '20', 'quintal', '1', 'hectare')];
    // (20 + 18 + 20 + 19 + 20) qtl ÷ (1 + 1 + 1 + 1 + 1) ha = 19.4
    expect(yieldFact(rows, EDGES, 5)).toEqual({ state: 'shown', qtlPerHa: '19.4', year: 2025, season: 'kharif', seasons: 5, members: 5, notComparable: 0 });
  });
  it('a season with no yield unit is "not comparable — unit missing", never guessed; all missing → the fact is not shown', () => {
    const rows = [row('a', '20', null, '1', 'hectare'), row('b', '20', 'bag', '1', 'hectare')];
    expect(yieldFact(rows, EDGES, 1)).toEqual({ state: 'not_comparable_unit_missing', year: 2025, season: 'kharif', seasons: 2 });
    const mixed = [row('a', '20', 'quintal', '1', 'hectare'), row('b', '20', null, '1', 'hectare')];
    expect(yieldFact(mixed, EDGES, 1)).toMatchObject({ state: 'shown', qtlPerHa: '20.0', notComparable: 1 });
  });
  it('below the aggregate floor (twin.min_group_size) the fact is not shown; no harvest → none', () => {
    expect(yieldFact([row('a', '20', 'quintal', '1', 'hectare')], EDGES, 5)).toEqual({ state: 'below_group_floor', year: 2025, season: 'kharif', members: 1, floor: 5 });
    expect(yieldFact([], EDGES, 5)).toEqual({ state: 'no_harvest' });
  });
  it('the LAST full season is the latest recorded harvest (an older season does not mix in)', () => {
    const rows = [row('a', '10', 'quintal', '1', 'hectare', 2024, 'rabi', '2024-04-01T00:00:00'), row('b', '30', 'quintal', '1', 'hectare', 2025, 'kharif')];
    expect(yieldFact(rows, EDGES, 1)).toMatchObject({ state: 'shown', qtlPerHa: '30.0', year: 2025, season: 'kharif', seasons: 1 });
  });
});

describe('PC-56 TENANT-12 · B6 — the advisory push SQL binds exactly what it uses (F-6)', () => {
  const placeholders = (sql: string) => Array.from(new Set((sql.match(/\$\d+/g) ?? []))).sort();
  it('the claim uses $1 (tenant) and $2 (limit); recipients use $1..$3 — no unused parameter (42P18)', () => {
    expect(placeholders(DUE_ALERTS_SQL)).toEqual(['$1', '$2']);
    expect(placeholders(RECIPIENTS_SQL)).toEqual(['$1', '$2', '$3']);
    expect(RECIPIENTS_SQL).toMatch(/path <@/);
    expect(RECIPIENTS_SQL).toMatch(/severe_only/);
  });
  it('the job is a registered ScheduledJob, and the notification map routes both advisory types to their catalogue codes', () => {
    const mod = fs.readFileSync(path.join(__dirname, '../../land-soil-weather/land-soil-weather.module.ts'), 'utf8');
    expect(mod).toMatch(/this\.jobs\.register\(this\.advisory\)/);
    const map = fs.readFileSync(path.join(__dirname, '../../communication/events/notification-event-map.ts'), 'utf8');
    expect(map).toMatch(/'land\.weather_advisory_active',\s*eventCode: 'weather\.alert'/);
    expect(map).toMatch(/'land\.weather_advisory_severe',\s*eventCode: 'weather\.alert_severe'/);
  });
});

describe('PC-56 TENANT-12 · 0190 — the migration is the wall under the rules', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0190_twin_frame.sql'), 'utf8');
  it('twin_runs: refused rows carry no outputs; outputs only on a done run with its inference; a gate trigger; kv_app S,I only', () => {
    expect(sql).toMatch(/ck_twin_runs_refused CHECK \(status <> 'refused' OR \(refusal_code IN \('TWIN_NO_MODEL_REGISTERED', 'TWIN_NO_RUNNER'\) AND outputs IS NULL AND ai_inference_id IS NULL/);
    expect(sql).toMatch(/ck_twin_runs_outputs CHECK \(outputs IS NULL OR \(status = 'done' AND ai_inference_id IS NOT NULL\)\)/);
    expect(sql).toMatch(/CREATE TRIGGER trg_twin_runs_gate BEFORE INSERT ON twin_runs/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON twin_runs TO kv_app;/);
    expect(sql).not.toMatch(/GRANT UPDATE[^;]*ON twin_runs/);
  });
  it('assumptions need a citation and an as-of (NOT NULL), history by trigger, append-only', () => {
    expect(sql).toMatch(/source_citation text NOT NULL/); expect(sql).toMatch(/source_asof\s+date NOT NULL/);
    expect(sql).toMatch(/CREATE TRIGGER trg_twin_assumptions_history AFTER INSERT OR UPDATE ON twin_assumptions/);
  });
  it('the walls: ai_models, plan / tenant features, add-ons, weather_alerts, price_predictions, crop_calendars; mandi NULL-tenant insert refused', () => {
    for (const t of ['ai_models', 'plan_features', 'tenant_features', 'subscription_addons', 'weather_alerts']) expect(sql).toMatch(new RegExp(`REVOKE INSERT, UPDATE ON ${t} FROM kv_app`));
    expect(sql).toMatch(/REVOKE INSERT, UPDATE ON price_predictions FROM kv_app/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON crop_calendars FROM kv_app/);
    expect(sql).toMatch(/CREATE POLICY mp_insert_own\s+ON mandi_prices FOR INSERT WITH CHECK \(tenant_id = current_tenant_id\(\)\)/);
  });
  it('every new tenant table is RLS ENABLE + FORCE with the 0175 split (never a NULL arm)', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY', t\)/); expect(sql).toMatch(/FORCE ROW LEVEL SECURITY', t\)/);
    expect(sql).toMatch(/FOR SELECT USING \(tenant_id = current_tenant_id\(\)\)', t \|\| '_read'/);
  });
});
