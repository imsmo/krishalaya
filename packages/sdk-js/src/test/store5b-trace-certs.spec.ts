// @krishalaya/sdk-js · PC-56 STORE-5b — the contract this wave adds, pinned with an injected fake fetch (no network):
//   • traceability.scan answers the v3 shape (organisation + slug, product, place, events with hashes, certificates, the seal);
//   • traceability.verify → GET …/verify, anonymous (no bearer); the named refusals arrive as their codes;
//   • traceability.requestExport → POST …/export with the Idempotency-Key and the bearer → { jobId };
//   • certificates.public(id) / publicByNo({ no }) → GET certificates/public[/:id] anonymous; CERTIFICATE_NOT_PUBLISHED is its own code;
//   • the listing public types carry `self_declared`; the flags carry `certificates_public`.
import { createClient } from '../client';
import type { ListingSearchPage, PublicCertificate, StorefrontFlags, TraceProvenance, TraceVerification } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });
const header = (c: Call, h: string) => new Headers(c.init.headers as HeadersInit).get(h);

describe('PC-56 STORE-5b · SDK traceability v3 + verify + export', () => {
  it('scan answers the v3 shape; verify is a public GET; requestExport is a keyed, signed-in POST', async () => {
    const v3: TraceProvenance = { qrToken: 'KVTR9J4K2M', organisation: { displayName: 'Anand FPO', slug: 'anand-fpo' }, createdAt: '2026-10-17T00:00:00Z',
      product: { title: 'GG-20 groundnut', quantity: 25, unit: 'quintal' }, place: { village: 'Vanthali', district: 'Junagadh' },
      events: [{ no: 1, eventCode: 'harvested', at: '2026-10-17T00:00:00Z', meta: {}, eventHash: 'a'.repeat(64), hashVersion: 2 }],
      certificates: [{ id: 'c1', typeCode: 'npop', status: 'verified', validUntil: '2026-12-31' }],
      anchor: { value: 'a'.repeat(64), anchoredAt: '2026-10-17T00:00:00Z', anchoredEventCount: 1, matchesHead: true }, sealed: true };
    const v: TraceVerification = { qrToken: 'KVTR9J4K2M', organisation: { displayName: 'Anand FPO', slug: 'anand-fpo' }, events: [], chain: 'ok', brokenAt: null, v1Count: 0,
      anchor: { value: null, anchoredAt: null, anchoredEventCount: null, matchesHead: false }, formula: 'v2' };
    const { fn, calls } = fakeFetch((c) => (c.url.endsWith('/verify') ? { body: { data: v } } : c.url.endsWith('/export') ? { status: 201, body: { data: { jobId: 'j1' } } } : { body: { data: v3 } }));
    const api = client(fn);
    expect(await api.traceability.scan('KVTR9J4K2M')).toEqual(v3);
    expect(await api.traceability.verify('KVTR9J4K2M')).toEqual(v);
    expect(await api.traceability.requestExport('KVTR9J4K2M', 'trace-export:k1')).toEqual({ jobId: 'j1' });
    expect(calls[1].url).toBe('https://api.test/v1/traceability/scan/KVTR9J4K2M/verify');
    expect(header(calls[1], 'authorization')).toBeNull();
    expect([calls[2].init.method, calls[2].url]).toEqual(['POST', 'https://api.test/v1/traceability/scan/KVTR9J4K2M/export']);
    expect(header(calls[2], 'idempotency-key')).toBe('trace-export:k1');
    expect(header(calls[2], 'authorization')).toBe('Bearer tok');
  });
  it('the named refusals arrive as their codes', async () => {
    for (const code of ['TRACE_NO_LONGER_PUBLISHED', 'TRACE_NOT_PUBLISHED', 'TRACE_SCAN_NOT_FOUND']) {
      const { fn } = fakeFetch(() => ({ status: 404, body: { error: { code, message: code } } }));
      await expect(client(fn).traceability.verify('KVTR9J4K2M')).rejects.toMatchObject({ code, status: 404 });
    }
    const { fn } = fakeFetch(() => ({ status: 503, body: { error: { code: 'TRACE_EXPORT_UNAVAILABLE', message: 'x' } } }));
    await expect(client(fn).traceability.requestExport('KVTR9J4K2M', 'k')).rejects.toMatchObject({ code: 'TRACE_EXPORT_UNAVAILABLE', status: 503 });
  });
});

describe('PC-56 STORE-5b · SDK public certificates', () => {
  it('public(id) and publicByNo({ no }) are anonymous GETs; CERTIFICATE_NOT_PUBLISHED is its own code', async () => {
    const c: PublicCertificate = { id: 'c1', organisation: { displayName: 'Anand FPO', slug: 'anand-fpo' }, typeCode: 'lab_report', certNo: 'LAB-1', issuingBody: 'JAU',
      validFrom: '2026-06-06', validUntil: '2026-09-06', status: 'verified', subjectType: 'listing', coversListing: 'GG-20', checkedBy: { organisation: 'Anand FPO', role: 'fpo_coordinator', at: null }, rejectionReason: null };
    const { fn, calls } = fakeFetch(() => ({ body: { data: c } }));
    expect(await client(fn).certificates.public('c1')).toEqual(c);
    expect(await client(fn).certificates.publicByNo({ no: 'LAB-1' })).toEqual(c);
    expect(calls[0].url).toBe('https://api.test/v1/certificates/public/c1');
    expect(calls[1].url).toBe('https://api.test/v1/certificates/public?no=LAB-1');
    expect(header(calls[0], 'authorization')).toBeNull();
    const off = fakeFetch(() => ({ status: 404, body: { error: { code: 'CERTIFICATE_NOT_PUBLISHED', message: 'x' } } }));
    await expect(client(off.fn).certificates.public('c1')).rejects.toMatchObject({ code: 'CERTIFICATE_NOT_PUBLISHED' });
  });
  it('the listing types carry self_declared; the flags carry certificates_public', () => {
    const page: Pick<ListingSearchPage, 'facets'> = { facets: { grade: [], ungraded: 0, organic: { certified: 1, selfDeclared: 2, natural: 0, none: 0 }, district: [], saleType: [] } };
    const card = { organic: 'self_declared' } as Pick<ListingSearchPage['items'][number], 'organic'>;
    const f: StorefrontFlags = { org_self_signup: false, certificates_public: true };
    expect([page.facets?.organic.selfDeclared, card.organic, f.certificates_public]).toEqual([2, 'self_declared', true]);
  });
});
