// packages/sdk-js/src/test/gov0-console.spec.ts · PC-56 GOV-0 — the `gov` resource: the realm's routes, which calls are anonymous, which
// carry an Idempotency-Key, and that it offers no SSO / hardware-key method and no write on an application.
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown, meta: Record<string, unknown> = { nextCursor: null }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ data: body, meta }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (c: Call) => JSON.parse(String(c.init.body ?? 'null'));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const base = { baseUrl: 'https://api.test' };

describe('PC-56 GOV-0 · SDK gov resource', () => {
  it('auth: otp / verify / choose / 2fa verify / enrol / confirm / refresh are ANONYMOUS on /v1/gov/auth/*; logout carries the session', async () => {
    const { fn, calls } = fakeFetch({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.gov.auth.otp('+919812345678');
    await c.gov.auth.verify('+919812345678', '123456');
    await c.gov.auth.verify('+919812345678', '123456', 'a1');
    await c.gov.auth.choose('choice-token-choice-token', 'a2');
    await c.gov.auth.verifyTwoFactor({ challengeToken: 'x'.repeat(43), code: '123456' });
    await c.gov.auth.enrol('e'.repeat(43));
    await c.gov.auth.confirm('e'.repeat(43), '654321');
    await c.gov.auth.refresh('r'.repeat(43));
    await c.gov.auth.logout();
    expect(calls.map((x) => x.url)).toEqual(['otp', 'verify', 'verify', 'verify', '2fa/verify', '2fa/enrol', '2fa/confirm', 'refresh', 'logout'].map((p) => `https://api.test/v1/gov/auth/${p}`));
    for (const x of calls.slice(0, 8)) expect(hdr(x, 'authorization')).toBeUndefined();
    expect(hdr(calls[8], 'authorization')).toBe('Bearer tok');
    expect(json(calls[2])).toEqual({ phone: '+919812345678', code: '123456', authorityId: 'a1' });
    expect(json(calls[3])).toEqual({ choiceToken: 'choice-token-choice-token', authorityId: 'a2' });
    expect(json(calls[6])).toEqual({ enrolToken: 'e'.repeat(43), code: '654321' });
  });

  it('members: request / approve / remove carry the caller\'s Idempotency-Key; list and me carry the session', async () => {
    const { fn, calls } = fakeFetch({ id: 'm1' });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.gov.me();
    await c.gov.members.list();
    await c.gov.members.request({ phone: '+919812345678', roleCode: 'authority_officer', termMonths: 6, reason: 'district scheme officer' }, 'k1');
    await c.gov.members.approve('m1', 'k2');
    await c.gov.members.remove('m1', 'transferred to another department', 'k3');
    expect(calls.map((x) => x.url)).toEqual(['me', 'members', 'members/requests', 'members/m1/approve', 'members/m1/remove'].map((p) => `https://api.test/v1/gov/${p}`));
    expect([hdr(calls[2], 'idempotency-key'), hdr(calls[3], 'idempotency-key'), hdr(calls[4], 'idempotency-key')]).toEqual(['k1', 'k2', 'k3']);
    expect(json(calls[4])).toEqual({ reason: 'transferred to another department' });
    for (const x of calls) expect(hdr(x, 'authorization')).toBe('Bearer tok');
  });

  it('applications: a list (meta mapped) and one opening — no review, decision or SSO method exists', async () => {
    const { fn, calls } = fakeFetch([{ id: 'x1' }], { nextCursor: 'cur', limit: 25, asOf: '2026-11-10T00:00:00.000Z' });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.gov.applications.list({ status: 'submitted', limit: 25 });
    await c.gov.applications.get('x1');
    expect(calls[0].url).toBe('https://api.test/v1/gov/applications?status=submitted&limit=25');
    expect(page).toEqual({ items: [{ id: 'x1' }], nextCursor: 'cur', limit: 25, asOf: '2026-11-10T00:00:00.000Z' });
    expect(calls[1].url).toBe('https://api.test/v1/gov/applications/x1');
    const apps = Object.getOwnPropertyNames(Object.getPrototypeOf(c.gov.applications)).sort();
    expect(apps).toEqual(['constructor', 'get', 'list']);
    const auth = Object.getOwnPropertyNames(Object.getPrototypeOf(c.gov.auth));
    for (const m of ['sso', 'departmental', 'hardwareKey', 'webauthn']) expect(auth).not.toContain(m);
  });
});
