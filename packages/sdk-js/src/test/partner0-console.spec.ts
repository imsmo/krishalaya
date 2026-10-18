// packages/sdk-js/src/test/partner0-console.spec.ts · PC-56 PARTNER-0 — the `partner` resource: the realm's routes, which calls are anonymous,
// which carry an Idempotency-Key, and that the partner console is a DIFFERENT realm from the machine `partnerApi`.
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

describe('PC-56 PARTNER-0 · SDK partner resource', () => {
  it('auth: otp / verify / choose / 2fa / refresh are ANONYMOUS (never a bearer) on /v1/partner/auth/*; logout carries the session', async () => {
    const { fn, calls } = fakeFetch({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.partner.auth.otp('+919812345678');
    await c.partner.auth.verify('+919812345678', '123456');
    await c.partner.auth.verify('+919812345678', '123456', 'p1');
    await c.partner.auth.choose('choice-token-choice-token', 'p2');
    await c.partner.auth.verifyTwoFactor({ challengeToken: 'x'.repeat(43), code: '123456' });
    await c.partner.auth.refresh('r'.repeat(43));
    await c.partner.auth.logout();
    expect(calls.map((x) => x.url)).toEqual(['otp', 'verify', 'verify', 'verify', '2fa/verify', 'refresh', 'logout'].map((p) => `https://api.test/v1/partner/auth/${p}`));
    for (const x of calls.slice(0, 6)) expect(hdr(x, 'authorization')).toBeUndefined();
    expect(hdr(calls[6], 'authorization')).toBe('Bearer tok');
    expect(json(calls[1])).toEqual({ phone: '+919812345678', code: '123456' });
    expect(json(calls[2])).toEqual({ phone: '+919812345678', code: '123456', partnerId: 'p1' });
    expect(json(calls[3])).toEqual({ choiceToken: 'choice-token-choice-token', partnerId: 'p2' });
  });

  it('me + applications: the list maps meta (nextCursor, limit, asOf); the filters are query params', async () => {
    const { fn, calls } = fakeFetch([{ id: 'a1' }], { nextCursor: 'cur', limit: 25, asOf: '2026-10-17T00:00:00.000Z' });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.partner.me();
    const page = await c.partner.applications.list({ reviewQueue: true, status: 'submitted', limit: 25 });
    await c.partner.applications.get('a1');
    expect(calls[0].url).toBe('https://api.test/v1/partner/me');
    expect(calls[1].url).toBe('https://api.test/v1/partner/applications?status=submitted&reviewQueue=true&limit=25');
    expect(page).toEqual({ items: [{ id: 'a1' }], nextCursor: 'cur', limit: 25, asOf: '2026-10-17T00:00:00.000Z' });
    expect(calls[2].url).toBe('https://api.test/v1/partner/applications/a1');
    for (const x of calls) expect(hdr(x, 'authorization')).toBe('Bearer tok');
  });

  it('decide: review / approve / reject carry the caller\'s Idempotency-Key; disburse is sent (and refused by the API)', async () => {
    const { fn, calls } = fakeFetch({ id: 'a1', status: 'approved' });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.partner.decide.review('a1', 'k-r');
    await c.partner.decide.approve('a1', { amountApprovedMinor: '4000000', coolingOffHours: 24 }, 'k-a');
    await c.partner.decide.reject('a1', { note: 'documents incomplete' }, 'k-j');
    await expect(c.partner.decide.disburse('a1', 'k-d')).rejects.toThrow(/refuses/);
    expect(calls.map((x) => [x.url, hdr(x, 'idempotency-key')])).toEqual([
      ['https://api.test/v1/partner/applications/a1/review', 'k-r'], ['https://api.test/v1/partner/applications/a1/approve', 'k-a'],
      ['https://api.test/v1/partner/applications/a1/reject', 'k-j'], ['https://api.test/v1/partner/applications/a1/disburse', 'k-d']]);
    expect(json(calls[1])).toEqual({ amountApprovedMinor: '4000000', coolingOffHours: 24 });
  });

  it('team + invites + 2fa: the invite is keyed; lookup / accept are anonymous; remove / revoke carry a reason', async () => {
    const { fn, calls } = fakeFetch({});
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.partner.team.list();
    await c.partner.team.invite({ phone: '+919812345678', roleCode: 'partner_checker' }, 'k-i');
    await c.partner.team.revokeInvite('i1', 'joined another lender');
    await c.partner.team.removeMember('m1', 'left the credit team');
    await c.partner.invites.lookup('t'.repeat(43));
    await c.partner.invites.accept({ token: 't'.repeat(43), phone: '+919812345678', code: '123456' });
    await c.partner.twoFactor.enrol(); await c.partner.twoFactor.confirm('123456'); await c.partner.twoFactor.state();
    expect(calls.map((x) => x.url.replace('https://api.test/v1/', ''))).toEqual([
      'partner/team', 'partner/team/invites', 'partner/team/invites/i1/revoke', 'partner/team/members/m1/remove',
      `partner/invites/${'t'.repeat(43)}`, 'partner/invites/accept', 'partner/me/2fa/enrol', 'partner/me/2fa/confirm', 'partner/me/2fa']);
    expect(hdr(calls[1], 'idempotency-key')).toBe('k-i');
    expect(json(calls[3])).toEqual({ reason: 'left the credit team' });
    expect(hdr(calls[4], 'authorization')).toBeUndefined(); expect(hdr(calls[5], 'authorization')).toBeUndefined();
  });

  it('the console realm is not the machine realm: `partner` speaks /v1/partner/*, `partnerApi` /v1/partner-api/*', async () => {
    const { fn, calls } = fakeFetch({});
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.partner.me(); await c.partnerApi.me();
    expect(calls[0].url).toBe('https://api.test/v1/partner/me');
    expect(calls[1].url).toBe('https://api.test/v1/partner-api/me');
  });
});

describe('PC-56 PARTNER-1a · SDK partner.dashboard()', () => {
  it('GET /v1/partner/dashboard with the session bearer; the figures come back as the server sent them (strings for money, integers for bps)', async () => {
    const body = { computedAt: '2026-10-18T00:00:00.000Z', applicationsTotal: 3, awaitingDecision: 2,
      decidedThisMonth: { decided: 1, approved: 1, rejected: 0, approvedAmountMinor: '9007199254740993', approvalRateBps: 10000, monthStartsAt: '2026-09-30T18:30:00.000Z', timeZone: 'Asia/Kolkata' },
      portfolio: { outstandingMinor: '0', activeLoans: 0 }, onTime: { windowDays: 90, due: 0, onTime: 0, shareBps: null, basis: 'recorded_instalments' },
      sla: { decisionPromiseHours: null, windowDays: 30, decided: 0, medianSec: null, p90Sec: null, withinPromise: null }, fpos: [], needsYouToday: [] };
    const { fn, calls } = fakeFetch(body);
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const d = await c.partner.dashboard();
    expect(calls[0].url).toBe('https://api.test/v1/partner/dashboard');
    expect(hdr(calls[0], 'authorization')).toBe('Bearer tok');
    expect(d.decidedThisMonth.approvedAmountMinor).toBe('9007199254740993');
    expect(d.onTime.shareBps).toBeNull();
  });
});
