// modules/partner-console/__tests__/partner-console.spec.ts · PC-56 PARTNER-0 — the PURE pieces of the partner realm (no database):
// the permission matrix, the chooser rule, the token's realm claims, the masks, the invite state, the guards' refusals, the named refusals.
import * as jwt from 'jsonwebtoken';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../../../core/auth/token.service';
import { AppConfig } from '../../../core/config/app-config';
import {
  PARTNER_PERMISSIONS, PARTNER_ROLE_MATRIX, chooseSignIn, clampPartnerLimit, decisionPermission, inviteState, isPartnerRole, maskPhoneTail, maskRegulatorRef,
} from '../domain/partner-console.rules';
import { namedPartnerRefusal, partnerRefused, PARTNER_CODES } from '../domain/partner-console.errors';
import {
  PartnerAnyMember, PartnerConsoleFlagGuard, PartnerPermissions, PartnerPermissionsGuard, PartnerPublic, PartnerSessionGuard,
} from '../guards/partner-session.guard';

const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'access-secret-access-secret', JWT_REFRESH_SECRET: 'refresh-secret-refresh-secret', AUTH_HASH_PEPPER: 'pepper-pepper-pepper-pepper-32!!' });
const tokens = new TokenService(config);
const P1 = '11111111-1111-7111-8111-111111111111';
const P2 = '22222222-2222-7222-8222-222222222222';
const codeOf = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === 'function' ? p() : p); return 'pass'; } catch (e) { return (e as { code?: string }).code ?? String(e); }
};

describe('PC-56 PARTNER-0 · the permission matrix (founder D1)', () => {
  it('admin holds every partner permission; checker reads + decides; maker reads + reviews; viewer reads', () => {
    expect([...PARTNER_ROLE_MATRIX.partner_admin].sort()).toEqual([...PARTNER_PERMISSIONS].sort());
    expect(PARTNER_PERMISSIONS).toHaveLength(10);   // PC-56 PARTNER-3a: + partner.claims.read (0230)
    expect([...PARTNER_ROLE_MATRIX.partner_checker].sort()).toEqual(['partner.applications.decide', 'partner.applications.read', 'partner.claims.read', 'partner.insurance.read', 'partner.keys.read', 'partner.webhooks.read']);
    expect([...PARTNER_ROLE_MATRIX.partner_maker].sort()).toEqual(['partner.applications.read', 'partner.applications.review', 'partner.claims.read', 'partner.insurance.read', 'partner.keys.read', 'partner.webhooks.read']);
    expect([...PARTNER_ROLE_MATRIX.partner_viewer]).toEqual(['partner.applications.read', 'partner.keys.read', 'partner.webhooks.read', 'partner.insurance.read', 'partner.claims.read']);
    // PC-56 PARTNER-3a · 0230: every partner role reads its insurer's claims (claim facts only)
    for (const r of ['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer'] as const) expect(PARTNER_ROLE_MATRIX[r]).toContain('partner.claims.read');
    // PC-56 PARTNER-2a (0228): every role reads its insurer organisation's own book — policy facts only (founder Q6)
    for (const r of ['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer'] as const) expect(PARTNER_ROLE_MATRIX[r]).toContain('partner.insurance.read');
    // PC-56 PARTNER-1b (0227): every role reads keys and webhooks; only the administrator revokes a key
    for (const r of ['partner_checker', 'partner_maker', 'partner_viewer'] as const) expect(PARTNER_ROLE_MATRIX[r]).not.toContain('partner.keys.revoke');
    // the maker never decides, the checker never reviews, nobody but the admin manages the team
    expect(PARTNER_ROLE_MATRIX.partner_maker).not.toContain('partner.applications.decide');
    expect(PARTNER_ROLE_MATRIX.partner_checker).not.toContain('partner.applications.review');
    for (const r of ['partner_checker', 'partner_maker', 'partner_viewer'] as const) expect(PARTNER_ROLE_MATRIX[r]).not.toContain('partner.team.manage');
  });
  it('a decision needs: review → .review (maker), approve / reject → .decide (checker)', () => {
    expect(decisionPermission('review')).toBe('partner.applications.review');
    expect(decisionPermission('approve')).toBe('partner.applications.decide');
    expect(decisionPermission('reject')).toBe('partner.applications.decide');
  });
  it('only the four partner roles are partner roles (a tenant role is not)', () => {
    expect(isPartnerRole('partner_admin')).toBe(true);
    expect(isPartnerRole('tenant_admin')).toBe(false);
    expect(isPartnerRole('banker')).toBe(false);
  });
});

describe('PC-56 PARTNER-0 · the chooser rule', () => {
  it('none → refused; exactly one → that partner; several → a chooser (sorted, de-duplicated)', () => {
    expect(chooseSignIn([])).toEqual({ kind: 'none' });
    expect(chooseSignIn([P1])).toEqual({ kind: 'one', partnerId: P1 });
    expect(chooseSignIn([P2, P1, P2])).toEqual({ kind: 'choose', partnerIds: [P1, P2] });
  });
  it('the second step names one of the person\'s partners → that one; a partner they are not in → the same answer as none', () => {
    expect(chooseSignIn([P1, P2], P2)).toEqual({ kind: 'one', partnerId: P2 });
    expect(chooseSignIn([P1], P2)).toEqual({ kind: 'none' });
    expect(chooseSignIn([], P1)).toEqual({ kind: 'none' });
  });
});

describe('PC-56 PARTNER-0 · the token carries the realm', () => {
  it('a partner token: pid + realm, NO tid; it verifies as a partner token and NEVER as a tenant token', () => {
    const t = tokens.mintPartnerAccessToken({ sub: 'u1', pid: P1, sid: 's1', roles: ['partner_admin'], perms: ['partner.team.manage'] });
    const raw = jwt.decode(t) as Record<string, unknown>;
    expect(raw.pid).toBe(P1); expect(raw.realm).toBe('partner'); expect(raw).not.toHaveProperty('tid'); expect(raw.typ).toBe('partner_access');
    expect(tokens.verifyPartnerAccessToken(t)).toMatchObject({ sub: 'u1', pid: P1, sid: 's1', realm: 'partner' });
    expect(tokens.verifyAccessToken(t)).toBeNull();
  });
  it('a tenant token never verifies as a partner token', () => {
    const t = tokens.mintAccessToken({ sub: 'u1', tid: 't1', sid: 's1', roles: ['tenant_admin'], perms: ['loan.manage'] });
    expect(tokens.verifyPartnerAccessToken(t)).toBeNull();
    expect(tokens.verifyAccessToken(t)).not.toBeNull();
  });
  it('a partner-typed token WITHOUT `realm`, without `pid`, or WITH a `tid` is refused (each claim is required)', () => {
    const a = config.auth;
    const sign = (claims: Record<string, unknown>) => jwt.sign(claims, a.accessSecret, { subject: 'u1', issuer: a.issuer, audience: a.audience, expiresIn: 60, algorithm: 'HS256' });
    expect(tokens.verifyPartnerAccessToken(sign({ typ: 'partner_access', pid: P1, sid: 's1', roles: [], perms: [] }))).toBeNull();                       // no realm
    expect(tokens.verifyPartnerAccessToken(sign({ typ: 'partner_access', realm: 'partner', sid: 's1', roles: [], perms: [] }))).toBeNull();              // no pid
    expect(tokens.verifyPartnerAccessToken(sign({ typ: 'partner_access', realm: 'partner', pid: P1, tid: 't1', sid: 's1' }))).toBeNull();               // a tid
    expect(tokens.verifyPartnerAccessToken(sign({ typ: 'access', realm: 'partner', pid: P1, sid: 's1' }))).toBeNull();                                   // tenant typ
    expect(tokens.verifyAccessToken(sign({ typ: 'access', tid: 't1', pid: P1, sid: 's1' }))).toBeNull();                                                 // a pid on a tenant token
    expect(tokens.verifyPartnerAccessToken(sign({ typ: 'partner_access', realm: 'partner', pid: P1, sid: 's1', roles: [], perms: [] }))).not.toBeNull();
  });
});

describe('PC-56 PARTNER-0 · masks, the invite state, the page size', () => {
  it('a phone shows its last 3 behind six bullets; a regulator reference its last 4', () => {
    expect(maskPhoneTail('+919812345318')).toBe('••••••318');
    expect(maskPhoneTail('')).toBeNull();
    expect(maskRegulatorRef('LIC-0000-4471')).toBe('••••4471');
    expect(maskRegulatorRef(null)).toBeNull();
    expect(maskRegulatorRef('   ')).toBeNull();
  });
  it('an invite: accepted → used; revoked → revoked; past 7 days or expired → expired; else usable', () => {
    const now = Date.parse('2026-10-17T10:00:00Z');
    const later = '2026-10-20T10:00:00Z'; const earlier = '2026-10-16T10:00:00Z';
    expect(inviteState({ status: 'pending', expiresAt: later }, now)).toBe('usable');
    expect(inviteState({ status: 'accepted', expiresAt: later }, now)).toBe('used');
    expect(inviteState({ status: 'revoked', expiresAt: later }, now)).toBe('revoked');
    expect(inviteState({ status: 'expired', expiresAt: later }, now)).toBe('expired');
    expect(inviteState({ status: 'pending', expiresAt: earlier }, now)).toBe('expired');
  });
  it('the list page: default 25, at most 100', () => {
    expect(clampPartnerLimit(undefined)).toBe(25); expect(clampPartnerLimit(0)).toBe(25); expect(clampPartnerLimit(7.9)).toBe(7); expect(clampPartnerLimit(1000)).toBe(100);
  });
});

describe('PC-56 PARTNER-0 · the guards', () => {
  class Routes {
    @PartnerPermissions('partner.applications.decide') decide() { return 1; }
    @PartnerAnyMember() me() { return 1; }
    @PartnerPublic() otp() { return 1; }
    undeclared() { return 1; }
  }
  const exec = (handler: keyof Routes, req: Record<string, unknown>) => ({
    getType: () => 'http', getHandler: () => Routes.prototype[handler], getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as never;
  const session = (perms: string[]) => ({ partnerSession: { userId: 'u1', partnerId: P1, sessionId: 's1', roles: ['partner_maker'], permissions: new Set(perms), ip: null, requestId: null } });
  const perms = new PartnerPermissionsGuard(new Reflector());

  it('a route that declares nothing is REFUSED (never open by omission)', async () => {
    expect(await codeOf(() => perms.canActivate(exec('undeclared', session(['partner.applications.read']))))).toBe('PARTNER_ROUTE_UNDECLARED');
  });
  it('a missing permission is 403 PARTNER_PERMISSION_MISSING; the maker cannot decide; any-member and public routes pass', async () => {
    expect(await codeOf(() => perms.canActivate(exec('decide', session(['partner.applications.read', 'partner.applications.review']))))).toBe('PARTNER_PERMISSION_MISSING');
    expect(await codeOf(() => perms.canActivate(exec('decide', session(['partner.applications.decide']))))).toBe('pass');
    expect(await codeOf(() => perms.canActivate(exec('me', session([]))))).toBe('pass');
    expect(await codeOf(() => perms.canActivate(exec('otp', {})))).toBe('pass');
    expect(await codeOf(() => perms.canActivate(exec('me', {})))).toBe('PARTNER_SESSION_REQUIRED');
  });
  it('the session guard refuses a TENANT token and no token (401 PARTNER_SESSION_REQUIRED) without touching the database', async () => {
    const uow = { run: jest.fn() };
    const g = new PartnerSessionGuard(new Reflector(), tokens, uow as never, {} as never);
    const tenant = tokens.mintAccessToken({ sub: 'u1', tid: 't1', sid: 's1', roles: ['tenant_admin'], perms: ['loan.manage'] });
    expect(await codeOf(g.canActivate(exec('me', { headers: { authorization: `Bearer ${tenant}` } })))).toBe('PARTNER_SESSION_REQUIRED');
    expect(await codeOf(g.canActivate(exec('me', { headers: {} })))).toBe('PARTNER_SESSION_REQUIRED');
    expect(uow.run).not.toHaveBeenCalled();
    expect(await codeOf(g.canActivate(exec('otp', { headers: {} })))).toBe('pass');
  });
  it('the session guard takes the partner from the TOKEN — never from an X-Partner-Id header — and re-reads the session + roles', async () => {
    const seen: Array<string | null> = [];
    const uow = { run: jest.fn(async (pid: string | null, fn: (tx: unknown) => Promise<unknown>) => { seen.push(pid); return fn({}); }) };
    const repo = { sessionLiveTx: jest.fn(async () => true), accessTx: jest.fn(async () => ({ roles: ['partner_viewer'], permissions: ['partner.applications.read'] })) };
    const g = new PartnerSessionGuard(new Reflector(), tokens, uow as never, repo as never);
    const t = tokens.mintPartnerAccessToken({ sub: 'u1', pid: P1, sid: 's1', roles: ['partner_admin'], perms: ['partner.team.manage'] });
    const req: Record<string, any> = { headers: { authorization: `Bearer ${t}`, 'x-partner-id': P2 } };
    expect(await codeOf(g.canActivate(exec('me', req)))).toBe('pass');
    expect(req.partnerSession.partnerId).toBe(P1);
    expect(seen).toEqual([P1]);
    expect([...req.partnerSession.permissions]).toEqual(['partner.applications.read']);   // the DATABASE's answer, not the token's snapshot
  });
  it('an ended session or a removed member → 401 PARTNER_SESSION_ENDED', async () => {
    const t = tokens.mintPartnerAccessToken({ sub: 'u1', pid: P1, sid: 's1', roles: ['partner_admin'], perms: [] });
    const uow = { run: jest.fn(async (_p: string | null, fn: (tx: unknown) => Promise<unknown>) => fn({})) };
    const dead = new PartnerSessionGuard(new Reflector(), tokens, uow as never, { sessionLiveTx: async () => false, accessTx: async () => ({ roles: ['partner_admin'], permissions: [] }) } as never);
    const removed = new PartnerSessionGuard(new Reflector(), tokens, uow as never, { sessionLiveTx: async () => true, accessTx: async () => ({ roles: [], permissions: [] }) } as never);
    expect(await codeOf(dead.canActivate(exec('me', { headers: { authorization: `Bearer ${t}` } })))).toBe('PARTNER_SESSION_ENDED');
    expect(await codeOf(removed.canActivate(exec('me', { headers: { authorization: `Bearer ${t}` } })))).toBe('PARTNER_SESSION_ENDED');
  });
  it('the flag guard evaluates `partner_console` with NO tenant and NO user; OFF or unreadable → 404', async () => {
    const calls: unknown[] = [];
    const on = new PartnerConsoleFlagGuard({ isEnabled: async (k: string, c: unknown) => { calls.push([k, c]); return true; } } as never);
    const off = new PartnerConsoleFlagGuard({ isEnabled: async () => false } as never);
    const broken = new PartnerConsoleFlagGuard({ isEnabled: async () => { throw new Error('db down'); } } as never);
    expect(await codeOf(on.canActivate())).toBe('pass');
    expect(calls).toEqual([['partner_console', {}]]);
    expect(await codeOf(off.canActivate())).toBe('NOT_FOUND');
    expect(await codeOf(broken.canActivate())).toBe('NOT_FOUND');
  });
});

describe('PC-56 PARTNER-0 · refusals by name', () => {
  it('a 0225 trigger code becomes its named refusal; the two unique-index races are named; anything else passes through', () => {
    expect((namedPartnerRefusal(new Error('[PARTNER_LAST_ADMIN] this is the last administrator')) as { code: string; httpStatus: number })).toMatchObject({ code: 'PARTNER_LAST_ADMIN', httpStatus: 409 });
    expect((namedPartnerRefusal(Object.assign(new Error('duplicate key value violates unique constraint "uq_pi_one_pending"'), { code: '23505' })) as { code: string }).code).toBe('PARTNER_INVITE_PENDING_EXISTS');
    expect((namedPartnerRefusal(Object.assign(new Error('duplicate key value violates unique constraint "uq_pm_user_partner_role"'), { code: '23505' })) as { code: string }).code).toBe('PARTNER_ALREADY_MEMBER');
    const other = new Error('boom');
    expect(namedPartnerRefusal(other)).toBe(other);
  });
  it('disbursal is refused BY NAME (403), and every code has a sentence and a 4xx status', () => {
    expect(partnerRefused('PARTNER_CANNOT_DISBURSE')).toMatchObject({ code: 'PARTNER_CANNOT_DISBURSE', httpStatus: 403 });
    for (const [code, c] of Object.entries(PARTNER_CODES)) { expect(c.status).toBeGreaterThanOrEqual(400); expect(c.status).toBeLessThan(500); expect(c.message.length).toBeGreaterThan(10); expect(code).toMatch(/^PARTNER_/); }
  });
});
