// modules/tenant-api-keys/__tests__/tenant13c-api-keys.spec.ts · PC-56 TENANT-13c — UNIT proof of the tenant key realm (no database).
//   ROUTER   over the REAL AppModule: the routes carrying @ApiScopes are EXACTLY the catalogue's (method + path + controller.handler),
//            every catalogue route carries its own scope, the global ApiKeyAuthGuard is registered, and no controller declares a scope
//            at class level (a scope is per route).
//   MIDDLE   a key-shaped bearer is authenticated by the port and the tenant comes FROM THE KEY — `X-Tenant-Id` / `X-Tenant-Slug` are
//            never read on that branch; a refused key is not anonymous (the refusal rides the context); no port bound → refused.
//   GUARD    a key on a non-catalogue route → 403; exact scope (orders.read cannot write; members.read ≠ members.read.pii; no prefix
//            family); a write without an Idempotency-Key → 400; quota → 429 with Retry-After; refusals map to their named errors;
//            a request with no key is untouched.
//   RULES    key shape, sha256 + constant-time compare, unbiased prefix, review refusals per field, checker detection, short names.
//   SECRETS  the files that may inject SECRET_READER are pinned; the consumers list is empty for every ownable provider.
import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NestFactory, ModulesContainer, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { API_SCOPES_KEY, ApiKeyAuthenticator, looksLikeTenantApiKey, shortName } from '../../../core/auth/api-key.port';
import { TenantContextMiddleware } from '../../../core/tenancy-context/tenant-context.middleware';
import { getRequestContext, runWithContext, type RequestContext } from '../../../core/tenancy-context/request-context';
import { actorRoleFor } from '../../../core/audit/audit.writer';
import { API_SCOPES, SCOPE_CODES, hasScope, isWriteScope, needsChecker, routesUnlocked } from '../domain/api-scopes';
import { RATE_MAX, formatKey, generateKey, hashSecret, parseKey, rateWindowKey, reviewDraft, secondsToWindowEnd, secretMatches } from '../domain/api-key.rules';
import { guardRefusalFor, keyProposalVerdict, keyStatus } from '../domain/api-key.state';
import { ApiKeyAuthGuard, refusalError } from '../guards/api-key-auth.guard';
import { INTEGRATION_CONSUMERS, SECRET_READER_ALLOWED_FILES, credentialHint, credentialRefusals, maskedRef, classifyStatus } from '../../tenant-integrations/domain/provider-rules';
import { verificationHeaders } from '../../tenant-integrations/infra/provider-verifier';
import { kindVerdict, proposalActs } from '../../tenant-integrations/domain/integration-proposal.state';

const METHOD_NAME: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PATCH]: 'PATCH' };
const T1 = '01a0c000-0000-7000-8000-000000000001';
const T2 = '01a0c000-0000-7000-8000-000000000002';
const U1 = '01a0c000-0000-7000-8000-0000000000aa';
const KEY = formatKey('a1b2c3d4', 'A'.repeat(32));

describe('PC-56 TENANT-13c · ROUTER — exactly the catalogue accepts key auth', () => {
  const env = { ...process.env };
  let app: INestApplication | undefined;
  const decorated: { route: string; scope: string }[] = [];
  const classScoped: string[] = [];
  let globalGuard = false;

  beforeAll(async () => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'boot-gate-access-secret-boot-gate-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'boot-gate-hash-pepper-boot-gate-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/boot_gate_never_dialled';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- lazily, after the env is set (the boot gate's shape)
    const { AppModule } = require('../../../app.module') as typeof import('../../../app.module');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    const seen = new Set<unknown>();
    for (const mod of app.get(ModulesContainer).values()) {
      for (const p of mod.providers.values()) if (p.metatype === ApiKeyAuthGuard) globalGuard = true;
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as unknown as { name: string; prototype: Record<string, unknown> };
        if (!cls || seen.has(cls)) continue;
        seen.add(cls);
        if (Reflect.getMetadata(API_SCOPES_KEY, cls)) classScoped.push(cls.name);
        const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          const fn = cls.prototype[name];
          if (name === 'constructor' || typeof fn !== 'function') continue;
          const m = Reflect.getMetadata(METHOD_METADATA, fn);
          if (m === undefined) continue;
          const scope = Reflect.getMetadata(API_SCOPES_KEY, fn);
          if (!scope) continue;
          const sub = Reflect.getMetadata(PATH_METADATA, fn);
          const path = `/v1/${[base, String(Array.isArray(sub) ? sub[0] : sub ?? '')].filter((x) => x && x !== '/').join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
          decorated.push({ route: `${METHOD_NAME[m as number]} ${path} ${cls.name}.${name}`, scope });
        }
      }
    }
  }, 120_000);
  afterAll(async () => { await app?.close(); process.env = env; });

  it('the decorated set EQUALS the catalogue (no catalogue route without @ApiScopes; no other route accepts key auth)', () => {
    const expected = API_SCOPES.flatMap((s) => s.routes.map((r) => ({ route: `${r.method} ${r.path} ${r.controller}.${r.handler}`, scope: s.code })));
    const key = (x: { route: string; scope: string }) => `${x.route} :: ${x.scope}`;
    expect(decorated.map(key).sort()).toEqual(expected.map(key).sort());
    expect(decorated.length).toBe(31);   // 12 scopes, 31 routes
  });
  it('the tenant-context middleware RECEIVED the authenticator (an unbound @Optional port would fail every key closed)', () => {
    const mw = app!.get(TenantContextMiddleware) as unknown as { apiKeys?: { authenticate?: unknown } };
    expect(typeof mw.apiKeys?.authenticate).toBe('function');
  });
  it('no controller declares a scope at class level, and the key guard is global (APP_GUARD)', () => {
    expect(classScoped).toEqual([]);
    expect(globalGuard).toBe(true);
  });
  it('the key console and the integrations controller accept NO key (a key never manages keys or credentials)', () => {
    expect(decorated.filter((d) => /ApiKeysController|IntegrationsController/.test(d.route))).toEqual([]);
  });
});

describe('PC-56 TENANT-13c · MIDDLEWARE — the tenant comes from the key, never a header', () => {
  const shards = { shardFor: () => 0 } as any;
  const resolver = { fromAuthHeader: () => null } as any;
  const slugs = { resolve: jest.fn(async () => T2) } as any;
  const roles = { effectiveAccess: jest.fn() } as any;
  const run = async (mw: TenantContextMiddleware, headers: Record<string, string>) => {
    let seen: RequestContext | undefined;
    await mw.use({ headers, requestId: 'r1' } as any, {} as any, () => { seen = getRequestContext(); });
    return seen!;
  };
  const okAuth: ApiKeyAuthenticator = { authenticate: jest.fn(async () => ({ ok: true as const, principal: {
    keyId: 'k1', keyPrefix: 'kv_live_a1b2c3d4', tenantId: T1, onBehalfOf: U1, roles: ['tenant_admin'], permissions: ['order.manage', 'api.manage'], scopes: ['orders.read'], ratePerHour: 1000 } })) };

  it('X-Tenant-Id and X-Tenant-Slug are IGNORED on key auth: the context tenant is the key row\'s', async () => {
    const mw = new TenantContextMiddleware(resolver, slugs, shards, roles, okAuth);
    const rc = await run(mw, { authorization: `Bearer ${KEY}`, 'x-tenant-id': T2, 'x-tenant-slug': 'other-fpo' });
    expect(rc.tenantId).toBe(T1);
    expect(rc.userId).toBe(U1);
    expect(rc.apiKey).toEqual({ keyId: 'k1', keyPrefix: 'kv_live_a1b2c3d4', scopes: ['orders.read'], ratePerHour: 1000, onBehalfOf: U1 });
    expect(rc.permissions.has('api.manage')).toBe(true);
    expect(slugs.resolve).not.toHaveBeenCalled();
  });
  it('a refused key is NOT anonymous with a header tenant: tenant empty, the refusal recorded', async () => {
    const mw = new TenantContextMiddleware(resolver, slugs, shards, roles, { authenticate: async () => ({ ok: false, refusal: { code: 'KEY_REVOKED', keyPrefix: 'kv_live_a1b2c3d4' } }) });
    const rc = await run(mw, { authorization: `Bearer ${KEY}`, 'x-tenant-id': T2 });
    expect(rc.tenantId).toBe('');
    expect(rc.userId).toBe('');
    expect(rc.apiKeyRefusal).toEqual({ code: 'KEY_REVOKED', keyPrefix: 'kv_live_a1b2c3d4' });
  });
  it('with no authenticator bound, a key-shaped bearer is refused (fail closed), and a malformed kv_ key is still a key', async () => {
    const mw = new TenantContextMiddleware(resolver, slugs, shards, roles);
    expect((await run(mw, { authorization: 'Bearer kv_live_garbage', 'x-tenant-id': T2 })).apiKeyRefusal).toEqual({ code: 'API_KEY_INVALID' });
    expect(looksLikeTenantApiKey('kv_test_abc')).toBe(true);
    expect(looksLikeTenantApiKey('eyJhbGciOi')).toBe(false);
  });
  it('the audit records the synthetic principal on behalf of the creator', () => {
    expect(actorRoleFor({ actorUserId: U1 }, { userId: U1, roles: ['tenant_admin'], apiKey: { keyId: 'k1', keyPrefix: 'p', scopes: [], ratePerHour: 1, onBehalfOf: U1 } }))
      .toBe('api_key:k1 on_behalf_of:tenant_admin');
  });
});

describe('PC-56 TENANT-13c · GUARD — route, exact scope, idempotency, quota', () => {
  const handlerOf = (scope?: string) => { const fn = function h() { /* route */ }; if (scope) Reflect.defineMetadata(API_SCOPES_KEY, scope, fn); return fn; };
  const ctxFor = (handler: () => void, method = 'GET', headers: Record<string, string> = {}) => {
    const res = { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } };
    return { res, ctx: { getType: () => 'http', getHandler: () => handler, getClass: () => class X {}, switchToHttp: () => ({ getRequest: () => ({ method, headers }), getResponse: () => res }) } as any };
  };
  const counter = new Map<string, number>();
  const cache = { incr: async (k: string) => { const n = (counter.get(k) ?? 0) + 1; counter.set(k, n); return n; } } as any;
  const metrics = { inc: () => undefined } as any;
  const repo = { touch: jest.fn(async () => true) } as any;
  const guard = new ApiKeyAuthGuard(new Reflector(), repo, cache, metrics);
  const keyCtx = (scopes: string[], rate = 1000): RequestContext => ({ tenantId: T1, userId: U1, sessionId: '', requestId: 'r', lang: 'en', roles: ['tenant_admin'], permissions: new Set(['*']), shardId: 0,
    apiKey: { keyId: `k-${Math.random()}`, keyPrefix: 'kv_live_a1b2c3d4', scopes, ratePerHour: rate, onBehalfOf: U1 } });
  const code = async (rc: RequestContext, c: any) => runWithContext(rc, () => guard.canActivate(c).then(() => 'ok', (e: { code?: string }) => e.code ?? String(e)));

  it('a request without a key is not this guard\'s business', async () => {
    const human: RequestContext = { tenantId: T1, userId: U1, sessionId: 's', requestId: 'r', lang: 'en', roles: [], permissions: new Set(), shardId: 0 };
    expect(await code(human, ctxFor(handlerOf()).ctx)).toBe('ok');
  });
  it('a key on a route outside the catalogue is refused (403), whatever its scopes', async () => {
    expect(await code(keyCtx(SCOPE_CODES.slice()), ctxFor(handlerOf()).ctx)).toBe('API_KEY_ROUTE_NOT_ACCEPTED');
  });
  it('EXACT scope: orders.read cannot write; members.read is not members.read.pii; no prefix family', async () => {
    expect(await code(keyCtx(['orders.read']), ctxFor(handlerOf('orders.read')).ctx)).toBe('ok');
    expect(await code(keyCtx(['orders.read']), ctxFor(handlerOf('orders.status.write'), 'POST', { 'idempotency-key': 'idem-12345678' }).ctx)).toBe('API_KEY_SCOPE_MISSING');
    expect(await code(keyCtx(['members.read']), ctxFor(handlerOf('members.read.pii'), 'POST').ctx)).toBe('API_KEY_SCOPE_MISSING');
    expect(await code(keyCtx(['listings.write']), ctxFor(handlerOf('members.read')).ctx)).toBe('API_KEY_SCOPE_MISSING');
    expect(await code(keyCtx(['orders']), ctxFor(handlerOf('orders.read')).ctx)).toBe('API_KEY_SCOPE_MISSING');
    expect(hasScope(['members.read'], 'members.read.pii')).toBe(false);
    expect(hasScope(['members.read.pii'], 'members.read')).toBe(false);
  });
  it('a write scope needs an Idempotency-Key (8–64); a read does not; the PII reveal is a read', async () => {
    expect(await code(keyCtx(['orders.status.write']), ctxFor(handlerOf('orders.status.write'), 'POST').ctx)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await code(keyCtx(['orders.status.write']), ctxFor(handlerOf('orders.status.write'), 'POST', { 'idempotency-key': 'x'.repeat(65) }).ctx)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await code(keyCtx(['orders.status.write']), ctxFor(handlerOf('orders.status.write'), 'POST', { 'idempotency-key': 'idem-12345678' }).ctx)).toBe('ok');
    expect(isWriteScope('members.read.pii')).toBe(false);
    expect(await code(keyCtx(['members.read.pii']), ctxFor(handlerOf('members.read.pii'), 'POST').ctx)).toBe('ok');
  });
  it('quota: the (rate+1)th call in the window is 429 with Retry-After = seconds to the window end', async () => {
    const rc = keyCtx(['orders.read'], 2);
    const h = handlerOf('orders.read');
    expect(await code(rc, ctxFor(h).ctx)).toBe('ok');
    expect(await code(rc, ctxFor(h).ctx)).toBe('ok');
    const third = ctxFor(h);
    expect(await code(rc, third.ctx)).toBe('API_KEY_QUOTA_EXCEEDED');
    expect(Number(third.res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(third.res.headers['Retry-After'])).toBeLessThanOrEqual(3600);
    expect(secondsToWindowEnd(3_600_000 * 5 + 1_000)).toBe(3599);
    expect(rateWindowKey('k', 3_600_000 * 5 + 1)).toBe('tk:rl:k:5');
  });
  it('a refused key answers its named error on every route', async () => {
    const refused = (c: string): RequestContext => ({ tenantId: '', userId: '', sessionId: '', requestId: 'r', lang: 'en', roles: [], permissions: new Set(), shardId: 0, apiKeyRefusal: { code: c } });
    expect(await code(refused('KEY_REVOKED'), ctxFor(handlerOf('orders.read')).ctx)).toBe('KEY_REVOKED');
    expect(await code(refused('API_KEY_INVALID'), ctxFor(handlerOf()).ctx)).toBe('API_KEY_INVALID');
    expect(refusalError({ code: 'KEY_REVOKED' }).httpStatus).toBe(401);
    expect((refusalError({ code: 'KEY_REVOKED', keyPrefix: 'kv_live_a1b2c3d4' }).details as any).error).toBe('key_revoked');
    expect(refusalError({ code: 'PLAN_FEATURE_REQUIRED' }).httpStatus).toBe(403);
    expect(refusalError({ code: 'API_KEYS_DISABLED' }).httpStatus).toBe(404);
    expect(refusalError({ code: 'KEY_PENDING_CHECKER' }).code).toBe('KEY_PENDING_CHECKER');
  });
});

describe('PC-56 TENANT-13c · RULES — key material, the review, the lifecycle', () => {
  it('a generated key has the documented shape, parses back, and only its sha256 is comparable', () => {
    const k = generateKey();
    expect(k.key).toMatch(/^kv_live_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$/);
    expect(parseKey(k.key)).toEqual({ prefix: k.prefix, secret: k.secret });
    expect(secretMatches(k.secret, hashSecret(k.secret))).toBe(true);
    expect(secretMatches(`${k.secret.slice(0, -1)}x`, hashSecret(k.secret))).toBe(false);
    expect(secretMatches(k.secret, 'not-a-hash')).toBe(false);
    expect(parseKey('kv_test_a1b2c3d4_' + 'A'.repeat(32))).toBeNull();      // no sandbox mode: only live is issued
    expect(parseKey('kv_live_A1B2C3D4_' + 'A'.repeat(32))).toBeNull();
    expect(parseKey(null)).toBeNull();
  });
  it('the prefix handle is unbiased over [a-z0-9] (rejection sampling at 252)', () => {
    const bytes = Buffer.from([251, 252, 253, 254, 255, 0, 35, 36, 71, 1, 2, 3, 4, 5, 6, 7]);
    const k = generateKey((n) => (n === 16 ? bytes : Buffer.alloc(n, 7)));
    expect(k.handle).toBe('9a9a9bcd');   // alphabet a–z then 0–9: 251 % 36 = 35 → '9'; 252–255 rejected; 0 → a; 35 → 9; 36 → a; 71 → 9; 1, 2, 3 → b, c, d
  });
  it('the review refuses per field; a member-PII scope needs a checker and its reason (20–500)', () => {
    const now = Date.parse('2026-10-03T00:00:00Z');
    const bad = reviewDraft({ name: 'x', scopes: ['orders.read', 'payouts.write'], ratePerHour: RATE_MAX + 1, expiresAt: '2026-10-03T00:10:00Z' }, now);
    expect(bad.refusals.map((r) => `${r.field}:${r.code}`)).toEqual(['name:name_length', 'scopes:scope_unknown', 'ratePerHour:rate_range', 'expiresAt:expiry_too_soon']);
    const pii = reviewDraft({ name: 'Member sync', scopes: ['members.read.pii'], reason: 'short' }, now);
    expect(pii.checker).toBe(true);
    expect(pii.refusals.map((r) => r.code)).toEqual(['reason_checker']);
    const ok = reviewDraft({ name: 'ERP sync', scopes: ['orders.read', 'listings.write'] }, now);
    expect(ok.refusals).toEqual([]);
    expect(ok.checker).toBe(false);
    expect(ok.draft.ratePerHour).toBe(1000);
    expect(needsChecker(['members.read'])).toBe(false);
    expect(routesUnlocked(['dairy.collections.read'])).toEqual([{ method: 'GET', path: '/v1/dairy/collections', controller: 'CollectionsController', handler: 'list' }]);
  });
  it('the lifecycle is derived, and the console\'s verdict never offers the maker a confirm', () => {
    const now = Date.parse('2026-10-03T00:00:00Z');
    expect(keyStatus({ activatedAt: null, revokedAt: null, expiresAt: null }, now)).toBe('waiting_checker');
    expect(keyStatus({ activatedAt: '2026-10-01T00:00:00Z', revokedAt: null, expiresAt: '2026-10-02T00:00:00Z' }, now)).toBe('expired');
    expect(guardRefusalFor({ activatedAt: '2026-10-01T00:00:00Z', revokedAt: '2026-10-02T00:00:00Z', expiresAt: null }, now)).toBe('KEY_REVOKED');
    expect(guardRefusalFor({ activatedAt: '2026-10-01T00:00:00Z', revokedAt: null, expiresAt: null }, now)).toBeNull();
    const p = { status: 'proposed' as const, proposedBy: U1, expiresAt: '2026-10-09T00:00:00Z' };
    expect(keyProposalVerdict(p, 'confirm', U1, now)).toEqual({ ok: false, code: 'CHECKER_IS_MAKER' });
    expect(keyProposalVerdict(p, 'confirm', 'other', now)).toEqual({ ok: true });
  });
  it('short names: a members.read key sees "Ramesh P.", never the surname', () => {
    expect(shortName('Ramesh Patel')).toBe('Ramesh P.');
    expect(shortName('  Asha  ')).toBe('Asha');
    expect(shortName('રમેશ ભાઈ પટેલ')).toBe('રમેશ પ.');
    expect(shortName(null)).toBeNull();
  });
});

describe('PC-56 TENANT-13c · INTEGRATIONS — pure rules and the reader allow-list', () => {
  const fields = [{ name: 'keyId', secret: false, pattern: '^rzp_(live|test)_[A-Za-z0-9]{8,32}$' }, { name: 'keySecret', secret: true, pattern: '^[A-Za-z0-9]{16,64}$' }];
  it('credential fields are judged per provider; values never appear in a refusal; hints and masked refs reveal nothing', () => {
    expect(credentialRefusals(fields, { keyId: 'nope', keySecret: 'x', extra: 'y' })).toEqual([
      { field: 'extra', code: 'field_unknown' }, { field: 'keyId', code: 'field_invalid' }, { field: 'keySecret', code: 'field_invalid' }]);
    expect(credentialRefusals(fields, { keyId: 'rzp_live_ABCDEFGH12', keySecret: 'S'.repeat(24) })).toEqual([]);
    expect(credentialHint(fields, { keyId: 'rzp_live_ABCDEFGH12', keySecret: 'S'.repeat(24) })).toBe('…GH12');
    expect(credentialHint([{ name: 'token', secret: true, pattern: '.' }], { token: 'abcdef1234' })).toBe('••34');
    expect(maskedRef('arn:aws:secretsmanager:ap-south-1:1:secret:krishi/t/razorpay/p-AbC41')).toBe('…••41');
    expect(classifyStatus(200)).toBeNull(); expect(classifyStatus(401)).toBe('auth'); expect(classifyStatus(503)).toBe('network'); expect(classifyStatus(404)).toBe('unknown');
    expect(verificationHeaders({ code: 'razorpay', verifyMethod: 'account_fetch', verifyUrl: 'x' }, { keyId: 'a', keySecret: 'b' })).toEqual({ authorization: `Basic ${Buffer.from('a:b').toString('base64')}` });
    expect(verificationHeaders({ code: 'gupshup', verifyMethod: 'balance_profile', verifyUrl: 'x' }, { apiKey: 'k' })).toEqual({ apikey: 'k' });
  });
  it('kinds follow the connection; the maker is never offered a confirm', () => {
    expect(kindVerdict('connect', null)).toEqual({ ok: true });
    expect(kindVerdict('connect', { status: 'verified' })).toEqual({ ok: false, code: 'ALREADY_CONNECTED' });
    expect(kindVerdict('rotate', { status: 'disconnected' })).toEqual({ ok: false, code: 'NOT_CONNECTED' });
    expect(proposalActs({ status: 'proposed', proposedBy: U1, expiresAt: '2099-01-01T00:00:00Z' }, U1, Date.now())).toEqual({ canConfirm: false, canRefuse: true });
  });
  it('no platform path reads a tenant connection: consumers are empty, and only the pinned files inject SECRET_READER', () => {
    expect(Object.values(INTEGRATION_CONSUMERS).every((c) => c.length === 0)).toBe(true);
    const root = join(__dirname, '..', '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        if (/import[^;]*\bSECRET_READER\b[^;]*from/.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual([...SECRET_READER_ALLOWED_FILES].sort());
  });
});
