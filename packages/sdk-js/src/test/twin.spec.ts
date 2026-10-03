// @krishalaya/sdk-js · PC-56 TENANT-12 · the twin, crop-season, soil-test and parcel resources speak the 12 API: one typed method per
// route (F-13 — eight land routes had no SDK method; the twin had none at all), the Idempotency-Key where the API requires one, the
// boundary on register / update (F-2), and `run` surfacing the gate's refusal by name. Pinned with a fake fetch.
import { createClient } from '../client';
import { SdkError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (body: unknown, status = 200) => { const f = fakeFetch(body, status); return { c: createClient({ baseUrl: 'https://api.test', fetchImpl: f.fn, getToken: () => 'tok', retries: 0 }), calls: f.calls }; };
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const json = (c: Call) => (c.init.body ? JSON.parse(String(c.init.body)) : undefined);
const T = 'https://api.test/v1/twin';
const poly = { type: 'Polygon' as const, coordinates: [[[72.1, 21.1], [72.2, 21.1], [72.2, 21.2], [72.1, 21.1]]] };

describe('PC-56 TENANT-12 · twin resource ↔ the API', () => {
  it('access / requestAccess (the Locked page, not behind the flag) — the ask is keyed', async () => {
    const { c, calls } = client({ data: { enabled: false, written: true, request: { requestedAt: '2026-10-03T10:00:00.000Z' } } });
    await c.twin.access(); await c.twin.requestAccess('k-ask');
    expect(calls[0].url).toBe(`${T}/access`);
    expect(calls[1].url).toBe(`${T}/access-request`); expect(calls[1].init.method).toBe('POST'); expect(hdr(calls[1])['idempotency-key']).toBe('k-ask');
  });
  it('overview / catalogue / scenarios (µs cursor) / scenario / results', async () => {
    const { c, calls } = client({ data: { items: [], counts: { draft: 0, ready: 0, archived: 0 }, total: 0, nextCursor: null } });
    await c.twin.overview(); await c.twin.catalogue();
    await c.twin.scenarios({ status: 'ready', cursor: 'CUR', limit: 10 });
    await c.twin.scenario('s 1'); await c.twin.results('a1', 'b1'); await c.twin.results('a1');
    expect(calls.map((x) => x.url)).toEqual([`${T}/overview`, `${T}/catalogue`, `${T}/scenarios?status=ready&cursor=CUR&limit=10`, `${T}/scenarios/s%201`, `${T}/results?a=a1&b=b1`, `${T}/results?a=a1`]);
  });
  it('create / preview / assumptions (PUT, keyed) / act preview / archive (keyed, reason)', async () => {
    const { c, calls } = client({ data: { id: 's1', status: 'draft' } });
    await c.twin.previewScenario({ name: 'Monsoon −20%', templateCode: 'rainfall_shock' });
    await c.twin.createScenario({ name: 'Monsoon −20%', templateCode: 'rainfall_shock' }, 'k-c');
    const a = [{ key: 'rainfall_delta_pct', value: '-20', citation: 'IMD district statement June 2026', asOf: '2026-06-30' }];
    await c.twin.previewAssumptions('s1', a); await c.twin.saveAssumptions('s1', a, 'k-a');
    await c.twin.previewAct('s1', 'archive', 'superseded'); await c.twin.archive('s1', 'superseded by SC-019', 'k-x');
    expect(calls[1].init.method).toBe('POST'); expect(hdr(calls[1])['idempotency-key']).toBe('k-c');
    expect(calls[2].url).toBe(`${T}/scenarios/s1/assumptions/preview`); expect(json(calls[2])).toEqual({ assumptions: a });
    expect(calls[3].init.method).toBe('PUT'); expect(hdr(calls[3])['idempotency-key']).toBe('k-a');
    expect(calls[4].url).toBe(`${T}/scenarios/s1/acts/archive/preview`); expect(json(calls[4])).toEqual({ reason: 'superseded' });
    expect(calls[5].url).toBe(`${T}/scenarios/s1/archive`); expect(json(calls[5])).toEqual({ reason: 'superseded by SC-019' });
  });
  it('run rejects with the gate\'s code by name (409 TWIN_NO_MODEL_REGISTERED) and the recorded attempt id', async () => {
    const { c, calls } = client({ error: { code: 'TWIN_NO_MODEL_REGISTERED', message: 'no scenario model is registered', details: { gate: 'ai_models', runId: 'r1', recorded: true } } }, 409);
    const err = await c.twin.run('s1', 'k-run').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err).toMatchObject({ code: 'TWIN_NO_MODEL_REGISTERED', status: 409 });
    expect((err as SdkError).details).toMatchObject({ runId: 'r1', recorded: true });
    expect(calls[0].url).toBe(`${T}/scenarios/s1/run`); expect(hdr(calls[0])['idempotency-key']).toBe('k-run');
  });
  it('devices: list / register (keyed) / retire (keyed, reason)', async () => {
    const { c, calls } = client({ data: { items: [], nextCursor: null, canManage: true, ingestion: 'not_built' } });
    await c.twin.devices({ kind: 'soil_pod' }); await c.twin.registerDevice({ kind: 'soil_pod', serial: 'SP-0031' }, 'k-d'); await c.twin.retireDevice('d1', 'replaced after lightning', 'k-r');
    expect(calls[0].url).toBe(`${T}/devices?kind=soil_pod&limit=50`);
    expect(hdr(calls[1])['idempotency-key']).toBe('k-d'); expect(json(calls[1])).toEqual({ kind: 'soil_pod', serial: 'SP-0031' });
    expect(calls[2].url).toBe(`${T}/devices/d1/retire`); expect(json(calls[2])).toEqual({ reason: 'replaced after lightning' });
  });
});

describe('PC-56 TENANT-12 · F-13 — the land routes that had no SDK method', () => {
  const L = 'https://api.test/v1/land';
  it('parcels: register carries boundaryGeojson; all = box=all; update is a PATCH with the desk\'s reason', async () => {
    const { c, calls } = client({ data: { id: 'p1' } });
    await c.parcels.register({ areaValue: '1.2', boundaryGeojson: poly }, 'k-p');
    await c.parcels.all({ limit: 5 });
    await c.parcels.update('p1', { boundaryGeojson: poly, reason: 'boundary from the 7/12 sketch' });
    expect(json(calls[0])).toMatchObject({ areaValue: '1.2', boundaryGeojson: poly });
    expect(calls[1].url).toBe(`${L}/parcels?box=all&limit=5`);
    expect(calls[2].init.method).toBe('PATCH'); expect(json(calls[2])).toEqual({ boundaryGeojson: poly, reason: 'boundary from the 7/12 sketch' });
  });
  it('crop seasons: plan (keyed, with the yield unit) / list / sow / harvest (unit) / abandon (reason)', async () => {
    const { c, calls } = client({ data: { id: 'c1' } });
    await c.cropSeasons.plan({ parcelId: 'p1', productId: 'g1', season: 'kharif', year: 2026, expectedYield: '20', yieldUnitCode: 'quintal' }, 'k-s');
    await c.cropSeasons.list('p1', 'sown'); await c.cropSeasons.sow('c1', '2026-06-20');
    await c.cropSeasons.harvest('c1', { actualYield: '19.4', yieldUnitCode: 'quintal' }); await c.cropSeasons.abandon('c1', 'hail');
    expect(hdr(calls[0])['idempotency-key']).toBe('k-s'); expect(json(calls[0])).toMatchObject({ yieldUnitCode: 'quintal' });
    expect(calls[1].url).toBe(`${L}/crop-seasons?parcelId=p1&status=sown`);
    expect(calls[3].url).toBe(`${L}/crop-seasons/c1/harvest`); expect(json(calls[3])).toEqual({ actualYield: '19.4', yieldUnitCode: 'quintal' });
    expect(json(calls[4])).toEqual({ reason: 'hail' });
  });
  it('soil tests: record is keyed (Law 3); list by parcel', async () => {
    const { c, calls } = client({ data: [] });
    await c.soilTests.record({ parcelId: 'p1', sampledOn: '2026-05-01', results: { ph: 6.8 } }, 'k-t'); await c.soilTests.list('p1');
    expect(hdr(calls[0])['idempotency-key']).toBe('k-t'); expect(calls[1].url).toBe(`${L}/soil-tests?parcelId=p1`);
  });
});
