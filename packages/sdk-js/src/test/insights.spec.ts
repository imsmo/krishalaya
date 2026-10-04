// @krishalaya/sdk-js · PC-56 TENANT-SW-f (F-19) — the insights / reports / studio-insights resources against a fake fetch: every route the
// console's W193–W196 / W417 pages use is a typed method with the right verb, path, query, body and Idempotency-Key; a refused figure arrives
// as data ({ kind: 'refused', code }), never as a number; the lesson-progress capture is additive (old calls send exactly what they sent).
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body(call)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const route = (c: Call) => `${c.init.method} ${c.url.replace('https://api.test/v1/', '')}`;
const ID = '0190a0a0-0000-7000-8000-000000000001';

describe('SW-f · insights SDK (F-19)', () => {
  it('mandi pulse · demand map · wastage: reads with µs cursors, exports idempotent, a refused figure stays data', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.includes('wastage/events?') ? { data: [{ id: ID }], meta: { nextCursor: 'MTc1OTU3' } }
      : c.url.endsWith('insights/wastage') ? { data: { share: { kind: 'refused', code: 'NO_GMV' } } } : { data: { id: ID } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.insights.memberPulse({ cursor: 'abc', limit: 5 });
    await c.insights.exportMemberPulse('k1');
    await c.insights.demandMap({ reach: 'districts', limit: 1 });
    await c.insights.exportDemandMap('districts', 'k2');
    const w = await c.insights.wastage();
    const ev = await c.insights.wastageEvents({ limit: 1 });
    await c.insights.exportWastage('k3');
    await c.insights.rerunWastage('Backfill after the outage', 'k4');
    expect(calls.map(route)).toEqual([
      'GET insights/mandi-pulse?cursor=abc&limit=5', 'POST insights/mandi-pulse/export', 'GET insights/demand-map?reach=districts&limit=1', 'POST insights/demand-map/export',
      'GET insights/wastage', 'GET insights/wastage/events?limit=1', 'POST insights/wastage/export', 'POST insights/wastage/rerun']);
    expect([hdr(calls[1], 'idempotency-key'), hdr(calls[3], 'idempotency-key'), hdr(calls[6], 'idempotency-key'), hdr(calls[7], 'idempotency-key')]).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ reach: 'districts' });
    expect(JSON.parse(String(calls[7].init.body))).toEqual({ reason: 'Backfill after the outage' });
    expect(w.share).toEqual({ kind: 'refused', code: 'NO_GMV' });
    expect(ev).toEqual({ items: [{ id: ID }], nextCursor: 'MTc1OTU3' });
  });

  it('a typed loss goes to the one route the API refuses it on (MANUAL_WASTAGE_REFUSED) — the SDK adds no write of its own', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: null }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.insights.recordManualWastage({ valueMinor: '100' }, 'k5');
    expect(calls.map(route)).toEqual(['POST insights/wastage/events']);
  });

  it('reports: catalogue · definitions · save · archive WITH a reason · run · runs · schedules · create · deactivate WITH a reason', async () => {
    const { fn, calls } = fakeFetch((c) => (c.init.method === 'GET' && !c.url.includes(`/${ID}`) && !c.url.endsWith('catalogue') ? { data: [], meta: { nextCursor: null } } : { data: { id: ID } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.reports.catalogue();
    await c.reports.definitions({ limit: 20 });
    await c.reports.definition(ID);
    await c.reports.saveDefinition({ title: 'Monthly orders', datasetCode: 'orders', dimensions: ['month'], measures: ['orders'], rangeDays: 30 }, 'k6');
    await c.reports.archiveDefinition(ID, 'Replaced by v2', 'k7');
    await c.reports.requestRun({ datasetCode: 'orders', dimensions: ['month'], measures: ['orders'], from: '2026-07-01', to: '2026-09-30' }, 'k8');
    await c.reports.runs({ limit: 3 });
    await c.reports.run(ID);
    await c.reports.schedules();
    await c.reports.createSchedule({ definitionId: ID, cadence: 'weekly', weekdayIso: 1, timeIst: '07:30', recipientRoles: ['tenant_admin'] }, 'k9');
    await c.reports.deactivateSchedule(ID, 'No longer needed here', 'k10');
    expect(calls.map(route)).toEqual([
      'GET insights/reports/catalogue', 'GET insights/reports/definitions?limit=20', `GET insights/reports/definitions/${ID}`, 'POST insights/reports/definitions',
      `POST insights/reports/definitions/${ID}/archive`, 'POST insights/reports/runs', 'GET insights/reports/runs?limit=3', `GET insights/reports/runs/${ID}`,
      'GET insights/reports/schedules', 'POST insights/reports/schedules', `POST insights/reports/schedules/${ID}/deactivate`]);
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ reason: 'Replaced by v2' });
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ datasetCode: 'orders', dimensions: ['month'], measures: ['orders'], from: '2026-07-01', to: '2026-09-30' });
    expect(JSON.parse(String(calls[10].init.body))).toEqual({ reason: 'No longer needed here' });
    for (const i of [3, 4, 5, 9, 10]) expect(hdr(calls[i], 'idempotency-key')).toMatch(/^k\d+$/);
  });

  it('studio insights: the course list and one course; the progress capture is ADDITIVE (an old call sends exactly what it sent)', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: [], meta: { nextCursor: null, scope: 'own' } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    const list = await c.studioInsights.courses({ limit: 10 });
    await c.studioInsights.course(ID);
    await c.enrollments.markProgress(ID, ID, { secondsWatched: 30, completed: false });
    await c.enrollments.markProgress(ID, ID, { completed: true, answers: [1, null, 0], watch: { startedAt: '2026-10-04T05:00:00Z', endedAt: '2026-10-04T05:01:00Z' } });
    expect(calls.map(route)).toEqual(['GET education/studio/insights?limit=10', `GET education/studio/insights/${ID}`,
      `POST education/enrollments/${ID}/lessons/${ID}/progress`, `POST education/enrollments/${ID}/lessons/${ID}/progress`]);
    expect(list.scope).toBe('own');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ secondsWatched: 30, completed: false });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ completed: true, answers: [1, null, 0], watch: { startedAt: '2026-10-04T05:00:00Z', endedAt: '2026-10-04T05:01:00Z' } });
  });
});
