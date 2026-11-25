// PC-56 ADMIN-AUTH-1 · THE WHOLE SIGN-IN, END TO END, against a real migrated Postgres as kv_admin (the role admin-api uses),
// with a fake OpenID Connect provider (local JWKS + signed id_tokens) and a software WebAuthn authenticator:
//
//   sso/start → IdP → callback → ticket → enroll with the BOOTSTRAP code → login → the token passes AdminAuthGuard +
//   HardwareKeyGuard + StepUpReauthGuard → step-up → add a second key → issue a code for a second operator → that operator
//   enrolls with it (bootstrap now inert) → suspended / unbound / replayed / regressed attempts refused → sign-out → refused.
//
// Run: DATABASE_ADMIN_URL=postgres://kv_admin:…@…/<fresh db> npx jest --selectProjects integration -t ADMIN-AUTH-1
// (skipped when DATABASE_ADMIN_URL is unset). It resets operator credentials in that database — never point it at a real one.
import { ForbiddenException, HttpException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { OperatorRegistryRepository } from '../../../core/auth/operator-registry.repository';
import { AdminAuthGuard, AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../../core/auth/step-up-reauth.guard';
import { resolveOwnerPermissions } from '../../../core/rbac/owner-roles';
import { OperatorAuthRepository } from '../repositories/operator-auth.repository';
import { OperatorAuthService } from '../services/operator-auth.service';
import { OidcClient } from '../services/oidc-client';
import { FakeIdp, SoftAuthenticator } from './fixtures/soft-authenticator';

const URL_ = process.env.DATABASE_ADMIN_URL;
const run = URL_ ? describe : describe.skip;

const ISSUER = 'https://idp.adminauth.test';
const CLIENT = 'client-it.apps.adminauth.test';
const CONSOLE = 'https://admin.adminauth.test';
const RP_ID = 'adminauth.test';
const BOOT_CODE = `BOOT-${randomUUID()}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const canonical = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
const RUN = randomUUID().slice(0, 8);
const FOUNDER = `founder-${RUN}@adminauth.test`;
const SECOND = `ops-${RUN}@adminauth.test`;
const STRANGER = `stranger-${RUN}@adminauth.test`;

run('ADMIN-AUTH-1 · end-to-end sign-in against a real database', () => {
  const config = new AdminConfig({
    NODE_ENV: 'test', DATABASE_ADMIN_URL: URL_, ADMIN_JWT_SECRET: 'it-'.padEnd(48, 'x'), ADMIN_REQUIRE_HARDWARE_KEY: 'true',
    ADMIN_OIDC_ISSUER: ISSUER, ADMIN_OIDC_CLIENT_ID: CLIENT, ADMIN_OIDC_CLIENT_SECRET: 'secret-it',
    ADMIN_OIDC_REDIRECT_URI: 'https://api.adminauth.test/v1/auth/sso/callback', ADMIN_OIDC_ALLOWED_DOMAINS: 'adminauth.test',
    ADMIN_CONSOLE_URL: CONSOLE, ADMIN_WEBAUTHN_RP_ID: RP_ID, ADMIN_WEBAUTHN_ORIGIN: CONSOLE,
    ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256: sha(canonical(BOOT_CODE)),
    ADMIN_OPERATOR_BINDINGS: JSON.stringify([
      { email: FOUNDER, roles: ['super_admin'] },
      { email: SECOND, roles: ['platform_recon_viewer'] },
    ]),
  });
  const pool = new AdminPool(config);
  const registry = new OperatorRegistryRepository(pool);
  const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
  const svc = new OperatorAuthService(config, new OperatorAuthRepository(pool), new AdminAuditWriter(pool), registry, new OidcClient(config, idp.fetch as never));
  const meta = { ip: '10.1.2.3', userAgent: 'jest', requestId: `it-${RUN}` };
  const founderKey = new SoftAuthenticator({ rpId: RP_ID, origin: CONSOLE });
  const founderKey2 = new SoftAuthenticator({ rpId: RP_ID, origin: CONSOLE });
  const secondKey = new SoftAuthenticator({ rpId: RP_ID, origin: CONSOLE });
  const sub = { founder: `sub-f-${RUN}`, second: `sub-s-${RUN}`, stranger: `sub-x-${RUN}` };

  const guardCtx = (token: string) => {
    const req: any = { headers: { authorization: `Bearer ${token}`, 'user-agent': 'jest', 'x-request-id': `it-${RUN}` }, ip: '10.1.2.3', method: 'POST', url: '/v1/x', route: { path: '/v1/x' } };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
  };
  const authenticate = async (token: string): Promise<AdminRequestContext> => {
    const { req, ctx } = guardCtx(token);
    await new AdminAuthGuard(config, registry).canActivate(ctx);
    return req.admin;
  };
  const elevated = async (token: string) => {
    const { req, ctx } = guardCtx(token);
    await new AdminAuthGuard(config, registry).canActivate(ctx);
    new HardwareKeyGuard(config, registry).canActivate(ctx);
    new StepUpReauthGuard(config, registry).canActivate(ctx);
    return req.admin as AdminRequestContext;
  };

  /** start → (the browser at the IdP) → callback. Returns the console URL the callback redirected to. */
  async function signInAtIdp(email: string, subject: string, over: Record<string, unknown> = {}, opt: { binding?: string } = {}) {
    const { redirectUrl, binding } = await svc.startSso(meta);
    const u = new URL(redirectUrl);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const code = `code-${randomUUID()}`;
    idp.codes.set(code, idp.idToken({ sub: subject, email, nonce: u.searchParams.get('nonce'), hd: 'adminauth.test', ...over }));
    return svc.handleCallback({ code, state: u.searchParams.get('state')! }, opt.binding ?? binding, meta);
  }
  const ticketOf = (url: string) => {
    expect(url.startsWith(`${CONSOLE}/login/key?ticket=`)).toBe(true);
    return new URL(url).searchParams.get('ticket')!;
  };
  const httpCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof HttpException ? (e.getResponse() as { code?: string }).code ?? e.getStatus() : (e as Error).message; } };

  let founderToken = '';
  let founderId = '';

  beforeAll(async () => {
    // A FRESH QA database only: make "zero active operator credentials platform-wide" true for this run.
    await pool.query(`UPDATE platform_operator_credentials SET revoked_at = now(), revoked_by_admin_id = admin_user_id, revoke_reason = 'integration reset' WHERE revoked_at IS NULL`);
  });
  afterAll(async () => { await pool.onModuleDestroy(); });

  it('1 · unbound email, wrong browser binding and a replayed state are refused with the generic error', async () => {
    expect(await signInAtIdp(STRANGER, sub.stranger)).toBe(`${CONSOLE}/login?error=signin`);
    expect(await signInAtIdp(FOUNDER, sub.founder, {}, { binding: 'not-the-cookie' })).toBe(`${CONSOLE}/login?error=signin`);
    expect(await signInAtIdp(FOUNDER, sub.founder, { email_verified: false })).toBe(`${CONSOLE}/login?error=signin`);
    const { redirectUrl, binding } = await svc.startSso(meta);
    const u = new URL(redirectUrl);
    const code = `code-${randomUUID()}`;
    idp.codes.set(code, idp.idToken({ sub: sub.founder, email: FOUNDER, nonce: u.searchParams.get('nonce') }));
    await svc.handleCallback({ code, state: u.searchParams.get('state')! }, binding, meta);
    expect(await svc.handleCallback({ code, state: u.searchParams.get('state')! }, binding, meta)).toBe(`${CONSOLE}/login?error=signin`);
  });

  it('2 · founder: callback → ticket → enroll with the BOOTSTRAP code → login → a token the guards accept', async () => {
    const ticket = ticketOf(await signInAtIdp(FOUNDER, sub.founder));
    const opts = await svc.keyOptions(ticket, meta);
    expect(opts.mode).toBe('enroll');
    // A wrong code is refused (and counted against the ticket); the spent challenge cannot be reused.
    expect(await httpCode(svc.enroll({ ticket, code: 'WRONG-CODE-0000', label: 'YubiKey A', response: founderKey.register(opts.options as never) }, meta))).toBe('AUTH_ENROLLMENT_REFUSED');
    expect(await httpCode(svc.enroll({ ticket, code: BOOT_CODE, label: 'YubiKey A', response: founderKey.register(opts.options as never) }, meta))).toBe('AUTH_KEY_REJECTED');
    const opts3 = await svc.keyOptions(ticket, meta);
    const enrolled = await svc.enroll({ ticket, code: BOOT_CODE.toLowerCase(), label: 'YubiKey A', response: founderKey.register(opts3.options as never) }, meta);
    expect(enrolled.enrolled).toBe(true);

    const auth = await svc.keyOptions(ticket, meta);
    expect(auth.mode).toBe('authenticate');
    const session = await svc.login({ ticket, response: founderKey.assert(auth.options as never) }, meta);
    founderToken = session.token;
    expect(session.maxAgeSec).toBe(28_800);

    const admin = await elevated(founderToken);
    founderId = admin.userId;
    expect(admin.amr).toEqual(['oidc', 'hwk']);
    expect(admin.roles).toEqual(['super_admin']);
    expect(admin.permissions.has('*')).toBe(true);

    // The ticket is single use.
    expect(await httpCode(svc.login({ ticket, response: founderKey.assert(auth.options as never) }, meta))).toBe('AUTH_TICKET_INVALID');
    // The bootstrap code is now inert, even for the founder's own second ticket.
    const t2 = ticketOf(await signInAtIdp(FOUNDER, sub.founder));
    expect((await svc.keyOptions(t2, meta)).mode).toBe('authenticate');
  });

  it('3 · database state: identity observed, credential stored, bootstrap recorded, session open, audit written', async () => {
    const r = await pool.query(
      `SELECT (SELECT email FROM platform_operator_identities WHERE admin_user_id = $1) AS email,
              (SELECT count(*)::int FROM platform_operator_credentials WHERE admin_user_id = $1 AND revoked_at IS NULL) AS keys,
              (SELECT count(*)::int FROM platform_operator_bootstrap_uses WHERE admin_user_id = $1) AS boot,
              (SELECT count(*)::int FROM platform_operator_sessions WHERE admin_user_id = $1 AND revoked_at IS NULL) AS sessions,
              (SELECT json_object_agg(action, n) FROM (SELECT action, count(*)::int AS n FROM audit_log WHERE actor_user_id = $1
                 AND action LIKE 'admin.auth.%' GROUP BY action) a) AS audits`,
      [founderId]);
    // Three IdP verifications (step 1's replay probe, step 2's sign-in, step 2's second ticket), one enrollment, one login.
    // Refusals are audited too (best-effort, outside any transaction): the wrong code, the spent challenge, the reused ticket.
    expect(r.rows[0]).toEqual({ email: FOUNDER, keys: 1, boot: 1, sessions: 1,
      audits: { 'admin.auth.sso_verified': 3, 'admin.auth.key_enrolled': 1, 'admin.auth.login': 1, 'admin.auth.enroll_refused': 2, 'admin.auth.ticket_refused': 1 } });
  });

  it('4 · step-up: a fresh assertion returns a token with the same sid and exp and a new auth_time; a regressed counter is refused', async () => {
    const before = await authenticate(founderToken);
    await new Promise((r) => setTimeout(r, 1100));
    const o = await svc.stepUpOptions(before);
    const out = await svc.stepUp(before, founderKey.assert(o.options as never), 'POST /v1/auth/step-up');
    const after = await elevated(out.token);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.expSec).toBe(before.expSec);
    expect(after.authTimeSec).toBeGreaterThan(before.authTimeSec);
    founderToken = out.token;

    const o2 = await svc.stepUpOptions(after);
    expect(await httpCode(svc.stepUp(after, founderKey.assert(o2.options as never, { counter: 1 }), 'POST /v1/auth/step-up'))).toBe('AUTH_KEY_REJECTED');
  });

  it('5 · the founder adds a second key (inside the session), and cannot revoke the last one', async () => {
    const admin = await elevated(founderToken);
    const o = await svc.addKeyOptions(admin);
    await svc.addKey(admin, { label: 'YubiKey B', response: founderKey2.register(o.options as never) });
    const keys = await svc.myKeys(admin);
    expect(keys.filter((k) => !k.revokedAt).map((k) => k.label)).toEqual(['YubiKey A', 'YubiKey B']);
    await svc.revokeKey(admin, keys.find((k) => k.label === 'YubiKey B')!.id, 'testing revocation of a spare key');
    expect(await httpCode(svc.revokeKey(admin, keys.find((k) => k.label === 'YubiKey A')!.id, 'would lock myself out'))).toBe('AUTH_KEY_REVOKE_REFUSED');
  });

  it('6 · enrollment codes: never for oneself; a code for a second operator enrolls exactly once; bootstrap stays closed', async () => {
    const admin = await elevated(founderToken);
    expect(await httpCode(svc.issueCode(admin, { email: FOUNDER, reason: 'my own second key please' }))).toBe('AUTH_CODE_ISSUE_REFUSED');
    expect(await httpCode(svc.issueCode(admin, { email: STRANGER, reason: 'not a bound operator' }))).toBe('AUTH_CODE_ISSUE_REFUSED');
    const issued = await svc.issueCode(admin, { email: SECOND, reason: 'onboarding the recon viewer' });
    const stored = await pool.query('SELECT code_sha256 FROM platform_operator_enrollment_codes WHERE id = $1', [issued.id]);
    expect(stored.rows[0].code_sha256).toBe(sha(canonical(issued.code)));   // stored hashed, never in clear

    const ticket = ticketOf(await signInAtIdp(SECOND, sub.second));
    const o = await svc.keyOptions(ticket, meta);
    expect(o.mode).toBe('enroll');
    expect(await httpCode(svc.enroll({ ticket, code: BOOT_CODE, label: 'Key', response: secondKey.register(o.options as never) }, meta))).toBe('AUTH_ENROLLMENT_REFUSED');
    const o2 = await svc.keyOptions(ticket, meta);
    await svc.enroll({ ticket, code: issued.code, label: 'Ops key', response: secondKey.register(o2.options as never) }, meta);
    const o3 = await svc.keyOptions(ticket, meta);
    const s = await svc.login({ ticket, response: secondKey.assert(o3.options as never) }, meta);
    const second = await authenticate(s.token);
    expect(second.roles).toEqual(['platform_recon_viewer']);
    expect([...second.permissions]).toEqual([...resolveOwnerPermissions(['platform_recon_viewer'])]);
    const used = await pool.query('SELECT consumed_at, consumed_by_admin_id FROM platform_operator_enrollment_codes WHERE id = $1', [issued.id]);
    expect(used.rows[0].consumed_by_admin_id).toBe(second.userId);

    // Sign-count regression at login: a fresh ticket, a stale counter.
    const t2 = ticketOf(await signInAtIdp(SECOND, sub.second));
    const o4 = await svc.keyOptions(t2, meta);
    expect(await httpCode(svc.login({ ticket: t2, response: secondKey.assert(o4.options as never, { counter: 1 }) }, meta))).toBe('AUTH_KEY_REJECTED');
  });

  it('7 · a SUSPENDED operator is refused at the IdP callback', async () => {
    const t = ticketOf(await signInAtIdp(SECOND, sub.second));   // still admitted
    const secondId = (await pool.query('SELECT admin_user_id FROM platform_operator_login_tickets WHERE ticket_sha256 = $1', [sha(t)])).rows[0].admin_user_id;
    await pool.withTx((c) => registry.suspend(c, { adminUserId: secondId, byAdminId: founderId, reason: 'integration test suspension' }));
    expect(await signInAtIdp(SECOND, sub.second)).toBe(`${CONSOLE}/login?error=signin`);
    expect(await httpCode(svc.keyOptions(t, meta))).toBe('AUTH_REFUSED');   // an outstanding ticket dies too
    const audit = await pool.query(`SELECT new_value->>'reason' AS reason FROM audit_log WHERE action = 'admin.auth.sso_refused' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [secondId]);
    expect(audit.rows[0].reason).toBe('operator_suspended');
  });

  it('8 · sign-out revokes the session: the same bearer is refused afterwards', async () => {
    const admin = await authenticate(founderToken);
    await svc.signOut(admin);
    const { ctx } = guardCtx(founderToken);
    await expect(new AdminAuthGuard(config, registry).canActivate(ctx)).rejects.toThrow(/revoked/);
    const row = await pool.query('SELECT revoked_at, revoke_reason FROM platform_operator_sessions WHERE session_id = $1', [admin.sessionId]);
    expect(row.rows[0].revoke_reason).toBe('signed out by the operator');
  });

  it('9 · the dev-bypass identity (amr without hwk) is refused by HardwareKeyGuard', () => {
    const { ctx, req } = guardCtx('x');
    req.admin = { userId: 'deadbeef-0000-0000-0000-000000000001', amr: ['dev-bypass'], ip: null, sessionId: '' };
    expect(() => new HardwareKeyGuard(config, { recordStepUp: async () => undefined } as never).canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// THE SAME FLOW OVER HTTP, through the real AdminModule (controllers, guards, middleware, cookie handling): the browser's
// hops (sso/start → IdP → callback, carrying the binding cookie) and web-admin's server hops (webauthn/*), then a guarded
// read with the minted bearer, sign-out, and the bearer refused.
// ---------------------------------------------------------------------------------------------------------------------
run('ADMIN-AUTH-1 · end-to-end over HTTP through the real AdminModule', () => {
  const HTTP_BOOT = `HTTP-${randomUUID()}`;
  const EMAIL = `http-${RUN}@adminauth.test`;
  const saved = { ...process.env };
  let app: any; let base = ''; let idp: FakeIdp;
  const key = new SoftAuthenticator({ rpId: RP_ID, origin: CONSOLE });

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_ADMIN_URL: URL_, ADMIN_JWT_SECRET: 'http-'.padEnd(48, 'y'), ADMIN_REQUIRE_HARDWARE_KEY: 'true', ADMIN_IP_ALLOWLIST: '',
      ADMIN_OIDC_ISSUER: ISSUER, ADMIN_OIDC_CLIENT_ID: CLIENT, ADMIN_OIDC_CLIENT_SECRET: 'secret-it',
      ADMIN_OIDC_REDIRECT_URI: 'https://api.adminauth.test/v1/auth/sso/callback', ADMIN_OIDC_ALLOWED_DOMAINS: 'adminauth.test',
      ADMIN_CONSOLE_URL: CONSOLE, ADMIN_WEBAUTHN_RP_ID: RP_ID, ADMIN_WEBAUTHN_ORIGIN: CONSOLE,
      ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256: sha(canonical(HTTP_BOOT)),
      ADMIN_OPERATOR_BINDINGS: JSON.stringify([{ email: EMAIL, roles: ['platform_staff_auditor'] }]),
    });
    const { NestFactory } = await import('@nestjs/core');
    const { VersioningType } = await import('@nestjs/common');
    const { AdminModule } = await import('../../../admin.module');
    app = await NestFactory.create(AdminModule, { logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
    (app.get(OidcClient) as unknown as { fetchImpl: unknown }).fetchImpl = idp.fetch;
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const pool = app.get(AdminPool) as AdminPool;
    await pool.query(`UPDATE platform_operator_credentials SET revoked_at = now(), revoked_by_admin_id = admin_user_id, revoke_reason = 'integration reset' WHERE revoked_at IS NULL`);
  }, 60_000);   // PC-56 TEST-1: booting the whole AdminModule exceeds jest's default 5 s hook budget on a loaded CI runner
  afterAll(async () => { await app?.close(); process.env = saved; }, 30_000);

  const post = (path: string, body: unknown, bearer?: string) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body),
  });

  it('start → callback (binding cookie) → enroll (bootstrap) → login → guarded read → sign-out → refused', async () => {
    const start = await fetch(`${base}/v1/auth/sso/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${ISSUER}/authorize`);
    const setCookie = start.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^kva_sso_bind=[^;]+; Path=\/v1\/auth\/sso; HttpOnly; SameSite=Lax; Max-Age=600$/);
    const cookie = setCookie.split(';')[0];

    idp.codes.set('http-code', idp.idToken({ sub: `sub-http-${RUN}`, email: EMAIL, nonce: loc.searchParams.get('nonce') }));
    const cb = await fetch(`${base}/v1/auth/sso/callback?code=http-code&state=${encodeURIComponent(loc.searchParams.get('state')!)}`, { redirect: 'manual', headers: { cookie } });
    expect(cb.status).toBe(302);
    const target = new URL(cb.headers.get('location')!);
    expect(target.origin + target.pathname).toBe(`${CONSOLE}/login/key`);
    expect(cb.headers.get('set-cookie')).toMatch(/kva_sso_bind=; .*Max-Age=0/);
    const ticket = target.searchParams.get('ticket')!;

    const o1: any = await (await post('/v1/auth/webauthn/options', { ticket })).json();
    expect(o1.data.mode).toBe('enroll');
    const en = await post('/v1/auth/webauthn/enroll', { ticket, code: HTTP_BOOT, label: 'HTTP key', response: key.register(o1.data.options) });
    expect(en.status).toBe(200);
    const o2: any = await (await post('/v1/auth/webauthn/options', { ticket })).json();
    expect(o2.data.mode).toBe('authenticate');
    const login = await post('/v1/auth/webauthn/login', { ticket, response: key.assert(o2.data.options) });
    expect(login.status).toBe(200);
    const { token, maxAgeSec } = ((await login.json()) as any).data;
    expect(maxAgeSec).toBe(28_800);

    const keys = await fetch(`${base}/v1/auth/keys`, { headers: { authorization: `Bearer ${token}` } });
    expect(keys.status).toBe(200);
    expect(((await keys.json()) as any).data.map((k: { label: string }) => k.label)).toEqual(['HTTP key']);
    // staff.read is held by platform_staff_auditor; staff.enroll is not → the code route is a 403.
    expect((await post('/v1/auth/enrollment-codes', { email: 'x@adminauth.test', reason: 'should be refused' }, token)).status).toBe(403);

    // Malformed bodies are 400, a bad ticket 401 (no oracle beyond "start again").
    expect((await post('/v1/auth/webauthn/login', { ticket: 'nope!' })).status).toBe(400);
    expect((await post('/v1/auth/webauthn/options', { ticket: 'A'.repeat(43) })).status).toBe(401);

    expect((await post('/v1/auth/sign-out', {}, token)).status).toBe(200);
    const after = await fetch(`${base}/v1/auth/keys`, { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(403);
    expect(((await after.json()) as any).code).toBe('ADMIN_ACCESS_REFUSED');
  });
});
