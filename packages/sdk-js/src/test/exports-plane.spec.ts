// @krishalaya/sdk-js · the tenant export plane's methods (PC-56 TENANT-6e-2). TENANT-6c-6 found routes that had existed
// for five waves with no SDK method; this file exists so that cannot be said of W2553/W2554's four routes.
import { createClient } from '../client';
import { SdkError } from '../errors';

interface Call { url: string; init: Record<string, any> }
function fakeFetch(handler: (c: Call, n: number) => { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    const call = { url: String(url), init: init ?? {} }; calls.push(call);
    const r = handler(call, calls.length);
    const status = r.status ?? 200;
    const text = r.raw !== undefined ? r.raw : JSON.stringify(r.body ?? {});
    return new Response(text, { status, headers: { 'content-type': r.raw !== undefined ? 'text/csv' : 'application/json', ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const base = { baseUrl: 'https://api.test', fetchImpl: undefined as any, getToken: () => 'tok' };

describe('TENANT-6e-2 · the export plane over the wire', () => {
  it('enqueues the dairy insights export with the window and an Idempotency-Key, defaulting to 90', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'j1', status: 'queued', standing: { position: 1, ahead: 0, eta: { kind: 'no_history' } } } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const job = await c.dairy.enqueueInsightsExport({}, 'idem-1');
    expect(job.id).toBe('j1');
    expect(job.standing?.eta).toEqual({ kind: 'no_history' });
    expect(calls[0].url).toBe('https://api.test/v1/dairy/insights/export');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(calls[0].init.body)).toEqual({ window: 90 });
    await c.dairy.enqueueInsightsExport({ window: 30 }, 'idem-2');
    expect(JSON.parse(calls[1].init.body)).toEqual({ window: 30 });
  });

  it('reads a job and mints a link on the shared routes', async () => {
    const { fn, calls } = fakeFetch((c) => c.url.endsWith('/link')
      ? { body: { data: { token: 'p.s', jti: 'x', expiresAt: '2026-09-10T00:15:00.000Z', ttlSec: 900, downloadPath: '/v1/exports/j1/download' } } }
      : { body: { data: { id: 'j1', status: 'ready', receipt: { rowCount: 27, sha256: 'a'.repeat(64) }, download: { kind: 'available', linkTtlSec: 900 } } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const job = await c.exportsPlane.get('j1');
    expect(job.receipt?.rowCount).toBe(27);
    expect(calls[0].url).toBe('https://api.test/v1/exports/j1');
    const link = await c.exportsPlane.mintLink('j1');
    expect(link.ttlSec).toBe(900);
    expect(calls[1].init.method).toBe('POST');
    expect(calls[1].url).toBe('https://api.test/v1/exports/j1/link');
  });

  it('opens the download as a RAW response with the token and the bearer, and never parses the bytes', async () => {
    const { fn, calls } = fakeFetch(() => ({ raw: '\uFEFFa,b\r\n1,2\r\n', headers: { 'x-export-sha256': 'deadbeef' } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const res = await c.exportsPlane.openDownload('j1', 'p.s');
    expect(res.status).toBe(200);
    // Bytes, not `text()`: the WHATWG decoder strips a BOM and the console must forward the file byte for byte.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);   // the BOM survives
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe('\uFEFFa,b\r\n1,2\r\n');
    expect(res.headers.get('x-export-sha256')).toBe('deadbeef');
    expect(calls[0].url).toBe('https://api.test/v1/exports/j1/download?token=p.s');
    expect(calls[0].init.headers.authorization).toBe('Bearer tok');
    expect(calls[0].init.headers.accept).toBe('*/*');
  });

  it('a refused download is a typed error carrying the outcome, not a file', async () => {
    const { fn } = fakeFetch(() => ({ status: 403, body: { error: { code: 'EXPORT_DOWNLOAD_REFUSED', message: 'Download refused: refused_expired', details: { outcome: 'refused_expired' } }, meta: { request_id: 'r1' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const err = await c.exportsPlane.openDownload('j1', 'stale').catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.code).toBe('EXPORT_DOWNLOAD_REFUSED');
    expect(err.status).toBe(403);
    expect(err.details).toEqual({ outcome: 'refused_expired' });
    expect(err.requestId).toBe('r1');
  });
});
