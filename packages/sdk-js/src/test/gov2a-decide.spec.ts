// packages/sdk-js/src/test/gov2a-decide.spec.ts · PC-56 GOV-2a — the `gov` resource's one act and the authority's schemes read; the tenant
// verify / approve / reject / close now surface the API's refusal by name (SCHEME_DECISIONS_ARE_THE_AUTHORITYS).
import { createClient } from '../client';
import { SdkError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (c: Call) => JSON.parse(String(c.init.body ?? 'null'));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const base = { baseUrl: 'https://api.test' };

describe('PC-56 GOV-2a · SDK gov act + schemes', () => {
  it('applications.act posts {act, reasonCode?, note?} with the caller\'s Idempotency-Key; no amount field exists on the input type', async () => {
    const { fn, calls } = fakeFetch({ data: { id: 'x1', act: 'reject', status: 'rejected', from: 'under_verification', decidedAt: null, recorded: true } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.gov.applications.act('x1', { act: 'verify' }, 'k1');
    const r = await c.gov.applications.act('x1', { act: 'reject', reasonCode: 'documents_missing', note: 'The land record page is missing.' }, 'k2');
    expect(calls.map((x) => x.url)).toEqual(['https://api.test/v1/gov/applications/x1/act', 'https://api.test/v1/gov/applications/x1/act']);
    expect([hdr(calls[0], 'idempotency-key'), hdr(calls[1], 'idempotency-key')]).toEqual(['k1', 'k2']);
    expect(json(calls[0])).toEqual({ act: 'verify' });
    expect(json(calls[1])).toEqual({ act: 'reject', reasonCode: 'documents_missing', note: 'The land record page is missing.' });
    expect(r.status).toBe('rejected');
  });

  it('applications.list carries the scheme filter', async () => {
    const { fn, calls } = fakeFetch({ data: [], meta: { nextCursor: null } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.gov.applications.list({ schemeId: 's1', status: 'under_verification' });
    expect(calls[0].url).toBe('https://api.test/v1/gov/applications?status=under_verification&schemeId=s1');
  });

  it('schemes: list / get / versions / diff are GETs — no write method exists on schemes in this realm', async () => {
    const { fn, calls } = fakeFetch({ data: [] });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.gov.schemes.list(); await c.gov.schemes.get('s1'); await c.gov.schemes.versions('s1'); await c.gov.schemes.diff('s1', 3);
    expect(calls.map((x) => [x.init.method, x.url])).toEqual([
      ['GET', 'https://api.test/v1/gov/schemes'], ['GET', 'https://api.test/v1/gov/schemes/s1'],
      ['GET', 'https://api.test/v1/gov/schemes/s1/versions'], ['GET', 'https://api.test/v1/gov/schemes/s1/versions/3/diff'],
    ]);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(c.gov.schemes)).sort()).toEqual(['constructor', 'diff', 'get', 'list', 'versions']);
  });

  it('the tenant verify / approve / reject / close surface SCHEME_DECISIONS_ARE_THE_AUTHORITYS as an SdkError code', async () => {
    const refusal = { error: { code: 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS', message: 'Applications are checked and decided by the government authority that runs the scheme, not by the organisation.' } };
    const { fn } = fakeFetch(refusal, 403);
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    for (const call of [() => c.schemes.verifyApplication('a1'), () => c.schemes.approveApplication('a1'), () => c.schemes.rejectApplication('a1', 'x'), () => c.schemes.closeApplication('a1')]) {
      const e = await call().then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(SdkError);
      expect([(e as SdkError).code, (e as SdkError).status]).toEqual(['SCHEME_DECISIONS_ARE_THE_AUTHORITYS', 403]);
    }
  });
});
