// packages/sdk-js/src/test/team.spec.ts · PC-56 TENANT-SW-c — the team, `/me/security`, take-next, the 2FA sign-in step, invites.
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ data: body, meta: { nextCursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  return { fn, calls };
}
const base = { baseUrl: 'https://api.test', tenantId: 't1' };
const json = (c: Call) => JSON.parse(String(c.init.body ?? 'null'));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe('PC-56 TENANT-SW-c · SDK', () => {
  it('team.*: overview, staff, invites (keyed), revoke with a reason, add directly (keyed), conflicts, lift', async () => {
    const { fn, calls } = fakeFetch({});
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.team.overview({ limit: 10 });
    expect(calls[0].url).toBe('https://api.test/v1/team?limit=10');
    await c.team.staff('u1'); expect(calls[1].url).toBe('https://api.test/v1/team/staff/u1');
    await c.team.invite({ phone: '+919812345678', roleCode: 'fpo_coordinator', deskIds: ['d1'] }, 'k-inv');
    expect(calls[2].url).toBe('https://api.test/v1/team/invites'); expect(calls[2].init.method).toBe('POST'); expect(hdr(calls[2], 'idempotency-key')).toBe('k-inv');
    await c.team.revokeInvite('i1', 'hired someone else'); expect(calls[3].url).toBe('https://api.test/v1/team/invites/i1/revoke'); expect(json(calls[3])).toEqual({ reason: 'hired someone else' });
    await c.team.addDirectly({ phone: '+919812345678', roleCode: 'auditor', reason: 'statutory auditor for the AGM' }, 'k-add');
    expect(calls[4].url).toBe('https://api.test/v1/team/staff'); expect(hdr(calls[4], 'idempotency-key')).toBe('k-add');
    await c.team.declareConflictFor('u1', { memberUserId: 'm1', relation: 'family', reason: 'his brother-in-law' }, 'k-c');
    expect(calls[5].url).toBe('https://api.test/v1/team/staff/u1/conflicts');
    await c.team.liftConflict('c1', 'member left the household'); expect(calls[6].url).toBe('https://api.test/v1/team/conflicts/c1/lift');
  });

  it('meSecurity.*: 2FA state / enrol / confirm / disable and my conflicts', async () => {
    const { fn, calls } = fakeFetch({});
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.meSecurity.twoFactor(); expect(calls[0].url).toBe('https://api.test/v1/me/2fa');
    await c.meSecurity.enrolTwoFactor(); expect(calls[1].url).toBe('https://api.test/v1/me/2fa/enrol'); expect(calls[1].init.method).toBe('POST');
    await c.meSecurity.confirmTwoFactor('123456'); expect(json(calls[2])).toEqual({ code: '123456' });
    await c.meSecurity.disableTwoFactor({ recoveryCode: 'abcde-fghjk' }); expect(calls[3].url).toBe('https://api.test/v1/me/2fa/disable');
    await c.meSecurity.declareConflict({ memberUserId: 'm1', relation: 'business', reason: 'we run a shop together' }, 'k-me'); expect(calls[4].url).toBe('https://api.test/v1/me/conflicts'); expect(hdr(calls[4], 'idempotency-key')).toBe('k-me');
  });

  it('kyc take next / skip / release; the 2FA sign-in step and the invite accept are anonymous', async () => {
    const { fn, calls } = fakeFetch({});
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.kyc.claimNext('k-claim'); expect(calls[0].url).toBe('https://api.test/v1/kyc/queue/claim'); expect(hdr(calls[0], 'idempotency-key')).toBe('k-claim');
    await c.kyc.skipClaim('cl1', { reasonCode: 'needs_specialist' }, 'k-skip'); expect(calls[1].url).toBe('https://api.test/v1/kyc/queue/claims/cl1/skip');
    await c.kyc.releaseClaim('cl1'); expect(calls[2].url).toBe('https://api.test/v1/kyc/queue/claims/cl1/release');
    await c.auth.verifyTwoFactor({ tenantId: 't1', challengeToken: 'x'.repeat(43), code: '123456' });
    expect(calls[3].url).toBe('https://api.test/v1/auth/2fa/verify'); expect(hdr(calls[3], 'authorization')).toBeUndefined();
    await c.auth.acceptInvite({ tenantId: 't1', token: 't'.repeat(43), phone: '+919812345678', code: '123456' });
    expect(calls[4].url).toBe('https://api.test/v1/auth/invites/accept'); expect(hdr(calls[4], 'authorization')).toBeUndefined();
    await c.rbac.revokeOverride({ userTenantRoleId: 'u', permissionCode: 'report.view', reason: 'no longer on the camp' });
    expect(calls[5].url).toBe('https://api.test/v1/rbac/overrides/revoke');
    await c.rbac.confirmOverrideProposal('p1'); expect(calls[6].url).toBe('https://api.test/v1/rbac/overrides/proposals/p1/confirm');
  });
});
