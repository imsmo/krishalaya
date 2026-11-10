// packages/sdk-js/src/test/gov1b-overview.spec.ts · PC-56 GOV-1b — `gov.overview()`: one GET of /v1/gov/overview carrying the session, the
// data returned as the server gave it; the gov resource still offers no write on an application.
import { createClient } from '../client';

describe('PC-56 GOV-1b · SDK gov.overview', () => {
  it('GET /v1/gov/overview with the session; the body is the server\'s', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const body = { window: { kind: 'all_time', draftsCounted: false }, computedAt: '2026-11-10T00:00:00.000Z', schemes: { count: 1 }, byScheme: [], totals: { total: 0, byStatus: {} }, queues: [] };
    const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl, getToken: () => 'tok' });
    expect(await c.gov.overview()).toEqual(body);
    expect(calls.map((x) => [x.url, x.init.method])).toEqual([['https://api.test/v1/gov/overview', 'GET']]);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(c.gov)).sort()).toEqual(['constructor', 'me', 'overview']);
  });
});
