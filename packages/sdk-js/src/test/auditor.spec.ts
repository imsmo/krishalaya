// @krishalaya/sdk-js · the auditor realm's methods (PC-56 TENANT-9c) — every route the wave added has an SDK method, reads
// keyless, the one write (the export enqueue) and the recorded reveal on their own verbs.
import { createClient } from '../client';
import { AUDITOR_DATASET_CODES, AUDITOR_PACK_SECTIONS } from '../resources/auditor';

interface Call { url: string; init: Record<string, any> }
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  return { fn, calls };
}
const base = { baseUrl: 'https://api.test', getToken: () => 'tok' };

describe('TENANT-9c · the auditor realm over the wire', () => {
  it('reads the overview, the ledger (keyset + window), the pack and the exports — all GET, no key', async () => {
    const { fn, calls } = fakeFetch({ data: { items: [], nextCursor: null } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.auditor.overview({ from: '2026-07-01', to: '2026-09-30' });
    await c.auditor.ledger({ cursor: 'abc', txnType: 'payout', limit: 10 });
    await c.auditor.compliancePack();
    await c.auditor.exports({ cursor: 'n1' });
    expect(calls.map((x) => [x.init.method, x.url])).toEqual([
      ['GET', 'https://api.test/v1/auditor/overview?from=2026-07-01&to=2026-09-30'],
      ['GET', 'https://api.test/v1/auditor/ledger?cursor=abc&txnType=payout&limit=10'],
      ['GET', 'https://api.test/v1/auditor/compliance-pack'],
      ['GET', 'https://api.test/v1/auditor/exports?cursor=n1'],
    ]);
    for (const x of calls) expect(x.init.headers['idempotency-key']).toBeUndefined();
  });
  it('enqueues an export with the confirm page\'s key; the dataset and section vocabularies match the API', async () => {
    const { fn, calls } = fakeFetch({ data: { id: 'j9', status: 'queued' } });
    const c = createClient({ ...base, fetchImpl: fn });
    const job = await c.auditor.enqueueExport({ datasetCode: 'compliance.pack', params: { section: 'gst', from: '2026-07-01', to: '2026-09-30' } }, 'k-9c');
    expect(job.id).toBe('j9');
    expect(calls[0].url).toBe('https://api.test/v1/auditor/exports');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['idempotency-key']).toBe('k-9c');
    expect(JSON.parse(calls[0].init.body)).toEqual({ datasetCode: 'compliance.pack', params: { section: 'gst', from: '2026-07-01', to: '2026-09-30' } });
    expect([...AUDITOR_DATASET_CODES]).toEqual(['audit.trail', 'ledger.entries', 'compliance.pack']);
    expect([...AUDITOR_PACK_SECTIONS]).toEqual(['gst', 'ledger', 'schemes', 'privacy']);
  });
  it('the trail: days in the query, the window back in meta; the recorded reveal posts the reason', async () => {
    const { fn, calls } = fakeFetch({ data: [], meta: { nextCursor: null, window: { from: '2026-07-01', to: '2026-09-30', days: 92, maxDays: 92, zone: 'Asia/Kolkata', defaulted: false } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const p = await c.audit.list({ from: '2026-07-01', to: '2026-09-30' });
    expect(p.window).toMatchObject({ days: 92, zone: 'Asia/Kolkata' });
    expect(calls[0].url).toContain('from=2026-07-01&to=2026-09-30');
    await c.audit.reveal('42', 'member disputes the phone change on 12 Jul');
    expect(calls[1].init.method).toBe('POST');
    expect(calls[1].url).toBe('https://api.test/v1/audit/entries/42/reveal');
    expect(JSON.parse(calls[1].init.body)).toEqual({ reason: 'member disputes the phone change on 12 Jul' });
  });
});
