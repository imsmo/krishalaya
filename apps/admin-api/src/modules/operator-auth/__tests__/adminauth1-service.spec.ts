// PC-56 ADMIN-AUTH-1 · the service with stubbed persistence (the real-database run is adminauth1-flow.integration.spec.ts):
// a suspended operator is refused at the callback; tickets are single use and expire; sign-out revokes the session row;
// the boot-time module wiring puts every sign-in route behind the IP allowlist.
import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpException } from '@nestjs/common';
import { AdminConfig } from '../../../core/config/admin-config';
import { DEFAULT_ACCESS_POLICY } from '../../../core/auth/operator-access';
import { OperatorAuthService } from '../services/operator-auth.service';
import { FakeIdp } from './fixtures/soft-authenticator';
import { OidcClient } from '../services/oidc-client';
import { readCookie } from '../operator-auth.controller';
import { sha256hex } from '../domain/oidc';

const ISSUER = 'https://idp.unit.test';
const CLIENT = 'client-unit';
const CONSOLE = 'https://admin.unit.test';
const config = new AdminConfig({
  NODE_ENV: 'test', ADMIN_JWT_SECRET: 'u'.repeat(40), ADMIN_OIDC_ISSUER: ISSUER, ADMIN_OIDC_CLIENT_ID: CLIENT, ADMIN_OIDC_CLIENT_SECRET: 'x',
  ADMIN_OIDC_REDIRECT_URI: 'https://api.unit.test/v1/auth/sso/callback', ADMIN_OIDC_ALLOWED_DOMAINS: 'unit.test', ADMIN_CONSOLE_URL: CONSOLE,
  ADMIN_WEBAUTHN_RP_ID: 'unit.test', ADMIN_WEBAUTHN_ORIGIN: CONSOLE,
  ADMIN_OPERATOR_BINDINGS: JSON.stringify([{ email: 'op@unit.test', roles: ['platform_auditor'] }]),
});
const meta = { ip: '10.0.0.1', userAgent: 'jest', requestId: 'r1' };
const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

function deps(over: { repo?: Record<string, unknown>; registry?: Record<string, unknown> } = {}) {
  const flows = new Map<string, { bindingSha256: string; nonce: string; codeVerifier: string }>();
  const repo: any = {
    db: { withTx: async (fn: (c: unknown) => unknown) => fn(client) },
    createFlow: jest.fn(async (v) => { flows.set(v.stateSha256, { bindingSha256: v.bindingSha256, nonce: v.nonce, codeVerifier: v.codeVerifier }); }),
    consumeFlow: jest.fn(async (sha: string) => { const f = flows.get(sha) ?? null; flows.delete(sha); return f; }),
    upsertIdentity: jest.fn(async (_c, v) => ({ identity: { adminUserId: '0190a0b0-0000-7000-8000-0000000000aa', ...v }, created: true })),
    createTicket: jest.fn(async () => undefined),
    getTicket: jest.fn(async () => null),
    revokeOwnSession: jest.fn(async () => undefined),
    ...over.repo,
  };
  const registry: any = {
    getOperator: jest.fn(async () => null),
    accessPolicy: jest.fn(async () => ({ policy: DEFAULT_ACCESS_POLICY, fromDatabase: true })),
    autoSuspendDormant: jest.fn(async () => true),
    recordStepUp: jest.fn(async () => undefined),
    ...over.registry,
  };
  const audit: any = { write: jest.fn(async () => undefined), log: jest.fn(async () => undefined) };
  const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
  const svc = new OperatorAuthService(config, repo, audit, registry, new OidcClient(config, idp.fetch as never));
  return { svc, repo, registry, audit, idp };
}

async function callback(d: ReturnType<typeof deps>, email = 'op@unit.test') {
  const { redirectUrl, binding } = await d.svc.startSso(meta);
  const u = new URL(redirectUrl);
  d.idp.codes.set('c', d.idp.idToken({ sub: 's1', email, nonce: u.searchParams.get('nonce') }));
  return d.svc.handleCallback({ code: 'c', state: u.searchParams.get('state')! }, binding, meta);
}
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof HttpException ? (e.getResponse() as { code: string }).code : String(e); } };

describe('ADMIN-AUTH-1 · callback', () => {
  it('a bound, verified operator gets a ticket redirect to /login/key; the ticket is stored hashed', async () => {
    const d = deps();
    const url = await callback(d);
    expect(url).toMatch(new RegExp(`^${CONSOLE}/login/key\\?ticket=[A-Za-z0-9_-]{43}$`));
    const ticket = new URL(url).searchParams.get('ticket')!;
    expect(d.repo.createTicket.mock.calls[0][1].ticketSha256).toBe(sha256hex(ticket));
    expect(d.repo.createTicket.mock.calls[0][1].ttlSec).toBe(300);
    expect(d.audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'admin.auth.sso_verified' }));
  });
  it('a SUSPENDED operator is refused with the generic error, and the refusal is audited with the reason', async () => {
    const d = deps({ registry: { getOperator: jest.fn(async () => ({ adminUserId: 'x', status: 'suspended', suspendKind: 'manual', lastSeenAt: new Date(), firstSeenAt: new Date(), suspendedAt: new Date(), suspendReason: 'r' })) } });
    expect(await callback(d)).toBe(`${CONSOLE}/login?error=signin`);
    expect(d.repo.createTicket).not.toHaveBeenCalled();
    expect(d.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.auth.sso_refused', newValue: expect.objectContaining({ reason: 'operator_suspended' }) }));
  });
  it('an operator past the dormancy line is refused AND auto-suspended', async () => {
    const d = deps({ registry: { getOperator: jest.fn(async () => ({ adminUserId: 'x', status: 'active', suspendKind: null, lastSeenAt: new Date(Date.now() - 50 * 86_400_000), firstSeenAt: new Date(0), suspendedAt: null, suspendReason: null })) } });
    expect(await callback(d)).toBe(`${CONSOLE}/login?error=signin`);
    expect(d.registry.autoSuspendDormant).toHaveBeenCalled();
  });
  it('an unbound email is refused; the audit row carries the domain and a hash, never the address', async () => {
    const d = deps();
    expect(await callback(d, 'intruder@unit.test')).toBe(`${CONSOLE}/login?error=signin`);
    const row = d.audit.log.mock.calls[0][0];
    expect(row.newValue).toMatchObject({ reason: 'no_binding', emailDomain: 'unit.test' });
    expect(JSON.stringify(row)).not.toContain('intruder@');
  });
});

describe('ADMIN-AUTH-1 · tickets', () => {
  const t = (over = {}) => ({ adminUserId: 'u1', email: 'op@unit.test', expiresAt: new Date(Date.now() + 60_000), consumedAt: null, failedAttempts: 0, ...over });
  it('unknown, consumed and expired tickets are AUTH_TICKET_INVALID', async () => {
    for (const row of [null, t({ consumedAt: new Date() }), t({ expiresAt: new Date(Date.now() - 1) }), t({ failedAttempts: 5 })]) {
      const d = deps({ repo: { getTicket: jest.fn(async () => row) } });
      expect(await codeOf(d.svc.keyOptions('a'.repeat(43), meta))).toBe('AUTH_TICKET_INVALID');
    }
  });
});

describe('ADMIN-AUTH-1 · sign-out', () => {
  it('revokes the session row (by sid, for this operator) and audits it in the same transaction', async () => {
    const d = deps();
    const admin: any = { userId: 'u1', sessionId: 'sid-1', ip: '10.0.0.1', requestId: 'r', roles: [], amr: [], permissions: new Set() };
    await expect(d.svc.signOut(admin)).resolves.toEqual({ signedOut: true });
    expect(d.repo.revokeOwnSession).toHaveBeenCalledWith(client, { sessionId: 'sid-1', adminUserId: 'u1' });
    expect(d.audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'admin.auth.signed_out' }));
  });
});

describe('ADMIN-AUTH-1 · cookie reader', () => {
  it('reads one cookie', () => {
    expect(readCookie('a=1; kva_sso_bind=xyz%3D; b=2', 'kva_sso_bind')).toBe('xyz=');
    expect(readCookie(undefined, 'kva_sso_bind')).toBeNull();
    expect(readCookie('kva_sso_bindx=1', 'kva_sso_bind')).toBeNull();
  });
});

describe('ADMIN-AUTH-1 · every sign-in route is behind the IP allowlist (real AdminModule)', () => {
  it('a request from an IP not on ADMIN_IP_ALLOWLIST is refused before the controller runs', async () => {
    const saved = { ...process.env };
    process.env.ADMIN_IP_ALLOWLIST = '203.0.113.250';
    process.env.NODE_ENV = 'test';
    const { AdminModule } = await import('../../../admin.module');
    const app = await NestFactory.create<NestExpressApplication>(AdminModule, { logger: false });
    try {
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as { port: number }).port;
      for (const [method, path] of [['GET', '/v1/auth/sso/start'], ['GET', '/v1/auth/sso/callback?code=a&state=b'], ['POST', '/v1/auth/webauthn/options'], ['POST', '/v1/auth/webauthn/login'], ['POST', '/v1/auth/webauthn/enroll'], ['POST', '/v1/auth/step-up'], ['POST', '/v1/auth/sign-out'], ['POST', '/v1/auth/enrollment-codes']]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        expect([path, res.status]).toEqual([path, 403]);
        expect(await res.text()).toMatch(/source IP not allowed/);
      }
    } finally {
      await app.close();
      process.env = saved;
    }
  }, 30_000);
});

describe('ADMIN-AUTH-1 · rate limits on the sign-in surface', () => {
  it('sso/start allows 20 per minute per IP, then 429s; another IP is unaffected; the WebAuthn routes are limited too', async () => {
    const { AuthRateLimitGuard, AUTH_RATE_LIMIT } = await import('../operator-auth.rate-limit');
    const { OperatorAuthController } = await import('../operator-auth.controller');
    const { Reflector } = await import('@nestjs/core');
    const reflector = new Reflector();
    const guard = new AuthRateLimitGuard(reflector);
    const handler = OperatorAuthController.prototype.ssoStart;
    const ctx = (ip: string) => ({ getHandler: () => handler, getClass: () => OperatorAuthController, switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as any;
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < 20; i++) expect(guard.canActivate(ctx(ip))).toBe(true);
    expect(() => guard.canActivate(ctx(ip))).toThrow(expect.objectContaining({ status: 429 }));
    expect(guard.canActivate(ctx('192.0.2.1'))).toBe(true);
    for (const m of ['ssoCallback', 'keyOptions', 'enroll', 'login', 'stepUp', 'stepUpOptions', 'addKey', 'addKeyOptions'] as const) {
      expect([m, Reflect.getMetadata(AUTH_RATE_LIMIT, (OperatorAuthController.prototype as any)[m])]).toEqual([m, expect.objectContaining({ perMinute: expect.any(Number) })]);
    }
  });
});
