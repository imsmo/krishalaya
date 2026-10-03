// @krishalaya/sdk-js · PC-56 TENANT-13a · the webhooks resource speaks the 13a API: one typed method per route, the Idempotency-Key on every
// write, a reason on every act, the delivery log's µs cursor passed through untouched, and the secret only ever in a response BODY.
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
const W = 'https://api.test/v1/webhooks';

describe('PC-56 TENANT-13a · webhooks resource ↔ the API', () => {
  it('reads: events / list / preview (no key) — never a secret in a URL', async () => {
    const { c, calls } = client({ data: { items: [], total: 0, contract: {} } });
    await c.webhooks.events(); await c.webhooks.list();
    await c.webhooks.preview({ url: 'https://erp.anandfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' });
    expect(calls.map((x) => x.url)).toEqual([`${W}/events`, W, `${W}/preview`]);
    expect(hdr(calls[2])['idempotency-key']).toBeUndefined();
    for (const x of calls) expect(x.url).not.toMatch(/secret/i);
  });
  it('register / rotate are keyed; the secret comes back in the BODY', async () => {
    const { c, calls } = client({ data: { id: 'w1', secret: 'whsec_ONCE', secretShown: true, secretHint: 'NCE' } });
    const r = await c.webhooks.register({ url: 'https://erp.anandfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' }, 'k-reg');
    expect(r.secret).toBe('whsec_ONCE');
    expect(hdr(calls[0])['idempotency-key']).toBe('k-reg');
    expect(json(calls[0])).toEqual({ url: 'https://erp.anandfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' });
    await c.webhooks.rotateSecret('w 1', 'quarterly rotation', 'k-rot');
    expect(calls[1].url).toBe(`${W}/w%201/rotate-secret`); expect(json(calls[1])).toEqual({ reason: 'quarterly rotation' }); expect(hdr(calls[1])['idempotency-key']).toBe('k-rot');
  });
  it('acts: preview (reason optional) · pause · resume · replay-failed · delete — each keyed and reasoned', async () => {
    const { c, calls } = client({ data: { id: 'w1', act: 'pause', moved: 2, status: 'paused' } });
    await c.webhooks.previewAct('w1', 'resume'); await c.webhooks.previewAct('w1', 'pause', 'maintenance');
    await c.webhooks.pause('w1', 'maintenance', 'k1'); await c.webhooks.resume('w1', 'back up', 'k2');
    await c.webhooks.replayFailed('w1', 'fixed', 'k3'); await c.webhooks.remove('w1', 'decommissioned', 'k4');
    expect(calls.map((x) => `${x.init.method} ${x.url}`)).toEqual([
      `POST ${W}/w1/acts/resume/preview`, `POST ${W}/w1/acts/pause/preview`, `POST ${W}/w1/pause`, `POST ${W}/w1/resume`, `POST ${W}/w1/replay-failed`, `DELETE ${W}/w1`]);
    expect(json(calls[0])).toEqual({}); expect(json(calls[1])).toEqual({ reason: 'maintenance' });
    expect(calls.slice(2).map((x) => hdr(x)['idempotency-key'])).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(json(calls[5])).toEqual({ reason: 'decommissioned' });
  });
  it('the delivery log: filters + µs cursor passed through; one delivery; replay preview + replay (keyed)', async () => {
    const { c, calls } = client({ data: { items: [], nextCursor: null, total: 0, failed: 0, diagnosis: null, retentionDays: 90 } });
    await c.webhooks.deliveries({ endpointId: 'e1', status: 'failed', since: '2026-10-02T09:00:00.000Z', cursor: 'CUR', limit: 50 });
    await c.webhooks.delivery('d1'); await c.webhooks.previewReplay('d1'); await c.webhooks.replay('d1', 'receiver fixed', 'k-rp');
    expect(calls[0].url).toBe(`${W}/deliveries?endpointId=e1&status=failed&since=2026-10-02T09%3A00%3A00.000Z&cursor=CUR&limit=50`);
    expect(calls.slice(1).map((x) => x.url)).toEqual([`${W}/deliveries/d1`, `${W}/deliveries/d1/acts/replay/preview`, `${W}/deliveries/d1/replay`]);
    expect(hdr(calls[3])['idempotency-key']).toBe('k-rp');
  });
  it('a refusal surfaces by name (WEBHOOK_REFUSED with every code)', async () => {
    const { c } = client({ error: { code: 'WEBHOOK_REFUSED', message: 'refused', details: { refusals: [{ field: 'url', code: 'URL_PRIVATE_ADDRESS' }] } } }, 422);
    const e = await c.webhooks.register({ url: 'https://169.254.169.254.nip.io/', eventTypes: ['order.created'], developerEmail: 'd@x.in' }, 'k').catch((x) => x);
    expect(e).toBeInstanceOf(SdkError);
    expect(e.code).toBe('WEBHOOK_REFUSED');
    expect(e.details.refusals[0].code).toBe('URL_PRIVATE_ADDRESS');
  });
});
