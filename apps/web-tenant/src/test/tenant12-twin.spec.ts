// apps/web-tenant/src/test/tenant12-twin.spec.ts · PC-56 TENANT-12 · the twin console's pure rules + its agreement with the API.
// Fails on HEAD 0a85b30 (no twin area at all). Pins: the lists mirror the API's own; every key the pages can ask for exists in en;
// no band is drawn without a `band` cell; the pages carry no AI badge and no canon figure; back links return to the originating screen.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import {
  DEVICE_KINDS, FEED_CODES, GATE_CODES, KEY_CODES, REFUSAL_CODES, SCENARIO_STATUSES, TEMPLATE_CODES, TRANSPORT_CODES, TWIN_REFUSED_BY_NAME,
  actHref, assumptionCarry, assumptionInput, assumptionValues, asOfKey, bandShown, byNameKey, cellKey, deviceKindKey, factLine, failureCodesFrom, feedLine,
  feedNameKey, inputNameOf, keyLabel, refusalKey, resultsHref, retryIsMutation, scenarioValues, seasonKey, statusKey, templateKey, twinState, unitKey,
} from '../features/twin/twin';

const API = join(__dirname, '..', '..', '..', 'api', 'src', 'modules');
const rules = readFileSync(join(API, 'twin', 'domain', 'twin-rules.ts'), 'utf8');
const migration = readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'migrations', '0190_twin_frame.sql'), 'utf8');
const fmt = (n: number) => String(n);

describe('PC-56 TENANT-12 · the console mirrors the API', () => {
  it('statuses, templates, keys, device kinds and feeds are the API\'s (0190 + domain)', () => {
    for (const s of SCENARIO_STATUSES) expect(readFileSync(join(API, 'twin', 'domain', 'twin-scenario.state.ts'), 'utf8')).toContain(`'${s}'`);
    for (const c of [...TEMPLATE_CODES, ...KEY_CODES, ...DEVICE_KINDS]) expect(migration).toContain(`'${c}'`);
    for (const f of FEED_CODES) expect(migration).toContain(`('${f}',`);
  });
  it('every refusal and gate code the API names has a sentence; the refused-by-name list is the API\'s', () => {
    for (const c of [...REFUSAL_CODES, ...GATE_CODES]) expect(rules + readFileSync(join(API, 'twin', 'domain', 'twin.errors.ts'), 'utf8') + readFileSync(join(API, 'twin', 'services', 'twin-devices.service.ts'), 'utf8')).toContain(c);
    for (const r of TWIN_REFUSED_BY_NAME) expect(rules).toContain(`'${r}'`);
  });
});

describe('PC-56 TENANT-12 · every key the pages can ask for exists (en; parity covers hi / gu)', () => {
  it('key builders resolve for every known value and fall back for unknown ones', () => {
    const keys = [
      ...SCENARIO_STATUSES.map(statusKey), statusKey('x'), ...TEMPLATE_CODES.map(templateKey), templateKey(null), ...KEY_CODES.map(keyLabel), keyLabel('x'),
      unitKey('pct'), unitKey('hectare'), unitKey(null), ...DEVICE_KINDS.map(deviceKindKey), deviceKindKey('x'), ...FEED_CODES.map(feedNameKey), feedNameKey('x'),
      ...TWIN_REFUSED_BY_NAME.map(byNameKey), byNameKey('x'), ...[...REFUSAL_CODES, ...GATE_CODES, ...TRANSPORT_CODES].map(refusalKey), refusalKey('NOPE'),
      ...['kharif', 'rabi', 'zaid', 'perennial', 'x'].map(seasonKey),
      cellKey({ state: 'too_few_runs_no_model' }), cellKey({ state: 'too_few_runs' }), cellKey({ state: 'band', runId: 'r' }),
    ];
    for (const k of keys) expect({ k, present: k in en }).toEqual({ k, present: true });
    for (const s of ['flaggedOff', 'restricted', 'notFound', 'error', 'scenariosOff', 'resultsOff', 'runRestricted']) {
      expect(`twin.state.${s}.title` in en).toBe(true); expect(`twin.state.${s}.body` in en).toBe(true);
    }
    for (const a of ['run', 'archive']) { expect(`twin.act.${a}.title` in en).toBe(true); expect(`twin.act.${a}.proceed` in en).toBe(true); }
  });
  it('feed and fact sentences exist for every state the API can send', () => {
    const feeds = [
      { code: 'parcel_register', state: 'recorded', detail: { registered: 2, mapped: 1 } }, { code: 'parcel_register', state: 'none', detail: {} },
      { code: 'soil_tests', state: 'recorded', detail: { tests: 1, parcelsTested: 1 } }, { code: 'soil_tests', state: 'none', detail: {} },
      { code: 'devices', state: 'not_connected', detail: { soilPods: 1, weatherMasts: 0 } },
      { code: 'mandi_prices', state: 'recorded', detail: { platformRows: 3, tenantObservations: 1 } }, { code: 'mandi_prices', state: 'none', detail: { tenantObservations: 0 } },
      { code: 'weather_forecast', state: 'live', detail: { forecastLive: true, provider: 'open-meteo' } }, { code: 'weather_forecast', state: 'none', detail: { forecastLive: false } },
    ] as const;
    for (const f of feeds) {
      const full = { sourceTables: [], asOf: null, ...f } as never;
      const l = feedLine(full, fmt); expect(l.key in en).toBe(true); expect(asOfKey(full) in en).toBe(true);
    }
    for (const fact of [
      { state: 'shown', qtlPerHa: '19.4', year: 2025, season: 'kharif', seasons: 5, members: 5, notComparable: 0 }, { state: 'no_harvest' }, { state: 'no_crop' },
      { state: 'not_comparable_unit_missing', year: 2025, season: 'rabi', seasons: 2 }, { state: 'below_group_floor', year: 2025, season: 'kharif', members: 1, floor: 5 },
    ] as const) expect(factLine(fact as never, fmt).key in en).toBe(true);
    expect(factLine({ state: 'shown', qtlPerHa: '19.4', year: 2025, season: 'kharif', seasons: 5, members: 5, notComparable: 0 }, fmt).vars.value).toBe('19.4');
  });
});

describe('PC-56 TENANT-12 · A — the console\'s half of the gate', () => {
  it('a band is drawn ONLY for a band cell; every honest cell is a sentence', () => {
    expect(bandShown({ state: 'too_few_runs_no_model' })).toBe(false);
    expect(bandShown({ state: 'too_few_runs' })).toBe(false);
    expect(bandShown({ state: 'band', runId: 'r1' })).toBe(true);
    expect(en[cellKey({ state: 'too_few_runs_no_model' })]).toBe('Too few runs — no registered model');
  });
  it('the twin pages carry no AI badge and none of the canon\'s fabricated figures', () => {
    const dir = join(__dirname, '..', 'app', 'twin');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) files.push(p); } };
    walk(dir);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      // the CODE, not the header comments (which quote the canon's figures in order to refuse them)
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect({ f, badge: /AiBadge|ai-badge/.test(src) }).toEqual({ f, badge: false });
      for (const n of ['14.2', '16.1', '17.8', '19.4', '9,300', '3,182', '3,900', '7a1c', 'v0.9', '500 runs']) expect({ f, n, found: src.includes(n) }).toEqual({ f, n, found: false });
    }
    for (const k of Object.keys(en).filter((x) => x.startsWith('twin.'))) expect({ k, n: /twin-model v0\.9|500 runs|14\.2|16\.1/.test(en[k]) }).toEqual({ k, n: false });
  });
  it('Retry on a run failure is a page load, never a re-run', () => { expect(retryIsMutation()).toBe(false); });
});

describe('PC-56 TENANT-12 · states, values in the URL, back links', () => {
  it('404 on the area\'s own read = flagged off (the Locked page); 403 = restricted; 404 on an id = not found', () => {
    expect(twinState(undefined, 404)).toBe('flaggedOff'); expect(twinState('TWIN_FORBIDDEN', 403)).toBe('restricted');
    expect(twinState(undefined, 404, true)).toBe('notFound'); expect(twinState('X', 500)).toBe('error');
    expect(failureCodesFrom('TWIN_REFUSED', 422, { refusals: [{ code: 'CITATION_REQUIRED' }, { code: 'ASOF_REQUIRED' }] })).toEqual(['CITATION_REQUIRED', 'ASOF_REQUIRED']);
    expect(failureCodesFrom('TWIN_NO_MODEL_REGISTERED', 409, { runId: 'r' })).toEqual(['TWIN_NO_MODEL_REGISTERED']);
  });
  it('assumption values travel as v_/c_/a_ per key; untouched keys are not sent; refusal fields map to inputs', () => {
    const v = assumptionValues({ v_rainfall_delta_pct: ' -20 ', c_rainfall_delta_pct: 'IMD statement June 2026', a_rainfall_delta_pct: '2026-06-30', v_bogus: '1' }, ['rainfall_delta_pct', 'member_profile_area_ha', 'bogus']);
    expect(Object.keys(v)).toEqual(['rainfall_delta_pct', 'member_profile_area_ha']);
    expect(assumptionInput(v)).toEqual([{ key: 'rainfall_delta_pct', value: '-20', citation: 'IMD statement June 2026', asOf: '2026-06-30' }]);
    expect(assumptionCarry(v)).toEqual({ v_rainfall_delta_pct: '-20', c_rainfall_delta_pct: 'IMD statement June 2026', a_rainfall_delta_pct: '2026-06-30' });
    expect(inputNameOf('rainfall_delta_pct.citation')).toBe('c_rainfall_delta_pct'); expect(inputNameOf(null)).toBeNull();
    expect(scenarioValues({ name: ' Monsoon ', templateCode: 'nope', productId: 'x' })).toEqual({ name: 'Monsoon', templateCode: '', productId: '', productQ: '' });
  });
  it('F-18: chain links return to the originating screen (scenarios / results), never all to W420', () => {
    expect(actHref('s1', 'run')).toBe('/twin/scenarios/s1/act?step=confirm&act=run');
    expect(resultsHref('a', 'b')).toBe('/twin/scenarios/results?a=a&b=b');
    const act = readFileSync(join(__dirname, '..', 'app', 'twin', 'scenarios', '[id]', 'act', 'page.tsx'), 'utf8');
    expect(act).toMatch(/twin\.chain\.backToScenarios/);
    const assume = readFileSync(join(__dirname, '..', 'app', 'twin', 'scenarios', '[id]', 'assumptions', 'page.tsx'), 'utf8');
    expect(assume).toMatch(/scenarioHref\(/);
  });
  it('the sidebar links the area ungated (the API flag decides Locked vs content)', () => {
    const sb = readFileSync(join(__dirname, '..', 'components', 'Sidebar.tsx'), 'utf8');
    expect(sb).toMatch(/\{ key: 'twin', href: '\/twin', label: t\.t\('nav\.twin'\) \}/);
  });
});
