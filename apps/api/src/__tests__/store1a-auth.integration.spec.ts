// apps/api/src/__tests__/store1a-auth.integration.spec.ts · PC-56 STORE-1a — STOREFRONT SIGN-IN, LIVE (the real AppModule over HTTP,
// real Postgres + RLS, kv_app; supertest drives the same guards, middleware, pipes and exception filter production runs).
//
// What it proves (brief §D3):
//   A2  requestOtp answers resendInSec + ttlSec; a second request inside the cooldown is 429 with retryAfterSec;
//       a wrong code counts attemptsLeft down to LOCKED (with the wait); an issued-then-expired code answers `expired`;
//       `ivr` and `whatsapp` are refused by name (409 OTP_CHANNEL_UNAVAILABLE) and NO SMS is sent;
//   A3  verify / refresh take the tenant from X-Tenant-Slug when the body omits it; no tenant at all → 422 TENANT_REQUIRED; a non-live
//       tenant's slug resolves to nothing → 422; GET /v1/storefront/tenant answers the live tenant (404 TENANT_NOT_FOUND otherwise);
//   D4  a fresh buyer is 403 on /v1/cart → POST /v1/onboarding/roles {customer} → refresh → 200; the flag OFF → 404;
//   D5  a person with confirmed TOTP gets TWO_FACTOR_PENDING (challengeToken) and /auth/2fa/verify mints tokens;
//   A1  two buyers behind ONE storefront address (signed headers) get separate OTP-route buckets; a forged header is ignored;
//   B6  logout revokes (refresh → REFRESH_INVALID); the sessions list carries a device family, never an IP; revoke one session.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { clientIpSignature } from '../core/http/client-ip';
import { SMS_SENDER, SmsSender } from '../core/auth/otp.service';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { CacheKeys } from '../core/cache/cache-keys';
import { TwoFactorService } from '../modules/identity/services/two-factor.service';
import { totpCodeAt } from '../modules/identity/domain/totp';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const SECRET = 'store1a-integration-caller-secret-0123456789';

const phone = () => '+9197' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));
const randIp = () => `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const signedFor = (ip: string) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return { 'x-kv-client-ip': ip, 'x-kv-client-ts': ts, 'x-kv-client-sig': clientIpSignature(ip, ts, SECRET) };
};
/** Every call carries a fresh signed address unless a case says otherwise — so cases never share a per-IP bucket by accident. */
const signed = () => signedFor(randIp());
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as { tid: string; roles: string[]; perms: string[]; sid: string };

run('PC-56 STORE-1a · storefront sign-in (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;
  let sms: SmsSender; let twoFactor: TwoFactorService;
  const tenantId = randomUUID(); let slug = '';
  const pendingTenant = randomUUID(); let pendingSlug = '';

  const otp = (p: string, headers: Record<string, string> = signed(), extra: Record<string, unknown> = {}) =>
    request(http).post('/v1/auth/otp').set(headers).set('idempotency-key', randomUUID()).send({ phone: p, ...extra });
  const verify = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    request(http).post('/v1/auth/verify').set({ ...signed(), ...headers }).send(body);
  /** request + verify through the slug context; returns the tokens. */
  async function signIn(p: string): Promise<{ accessToken: string; refreshToken: string }> {
    const r = await otp(p); expect(r.status).toBe(201);
    const v = await verify({ phone: p, code: r.body.data.devCode }, { 'x-tenant-slug': slug });
    expect(v.status).toBe(201);
    return v.body.data;
  }

  beforeAll(async () => {
    process.env.STOREFRONT_CALLER_SECRET = SECRET;
    // no background jobs / relay timer in this spec: nothing here needs them, and an in-flight tick held app.close() past the hook timeout
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantId, 'Store1a FPO');
    slug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId])).rows[0].slug;
    await makeTenant(admin, pendingTenant, 'Store1a Pending');
    await admin.query(`UPDATE tenants SET status = 'pending' WHERE id = $1`, [pendingTenant]);
    pendingSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [pendingTenant])).rows[0].slug;
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); sms = app.get<SmsSender>(SMS_SENDER); twoFactor = app.get(TwoFactorService);
  }, 120_000);
  afterAll(async () => {
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  describe('A2 · OTP truth', () => {
    it('request answers resendInSec + ttlSec; a second request inside the cooldown is 429 with retryAfterSec', async () => {
      const p = phone();
      const r = await otp(p);
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ sent: true, resendInSec: 30, ttlSec: 300 });
      const again = await otp(p);
      expect(again.status).toBe(429);
      expect(again.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(again.body.error.details.limit).toBe('resend_cooldown');
      expect(again.body.error.details.retryAfterSec).toBeGreaterThan(0);
      expect(again.body.error.details.retryAfterSec).toBeLessThanOrEqual(30);
    });

    it('wrong code → attemptsLeft 4,3,2,1 → LOCKED with the wait; then even the right code is locked', async () => {
      const p = phone();
      const code = (await otp(p)).body.data.devCode as string;
      const wrong = code === '000000' ? '111111' : '000000';
      for (const left of [4, 3, 2, 1]) {
        const v = await verify({ phone: p, code: wrong, tenantId });
        expect(v.status).toBe(401);
        expect(v.body.error).toMatchObject({ code: 'OTP_INVALID', details: { reason: 'wrong', attemptsLeft: left } });
      }
      const locked = await verify({ phone: p, code: wrong, tenantId });
      expect(locked.body.error.details).toMatchObject({ reason: 'locked', attemptsLeft: 0, retryAfterSec: 300 });
      const right = await verify({ phone: p, code, tenantId });
      expect(right.status).toBe(401);
      expect(right.body.error.details.reason).toBe('locked');
    });

    it('an issued-then-expired code answers `expired` (no tries left), never `wrong`', async () => {
      const p = phone();
      const code = (await otp(p)).body.data.devCode as string;
      await cache.del(CacheKeys.otp(p));                       // the Redis TTL ran out
      const v = await verify({ phone: p, code, tenantId });
      expect(v.status).toBe(401);
      expect(v.body.error.details).toEqual({ reason: 'expired', attemptsLeft: 0 });
    });

    it('channel ivr / whatsapp → 409 OTP_CHANNEL_UNAVAILABLE and NO SMS is sent (before: a silent SMS)', async () => {
      const spy = jest.spyOn(sms, 'sendOtp');
      try {
        for (const channel of ['ivr', 'whatsapp']) {
          const r = await otp(phone(), signed(), { channel });
          expect(r.status).toBe(409);
          expect(r.body.error).toMatchObject({ code: 'OTP_CHANNEL_UNAVAILABLE', details: { channel, available: ['sms'] } });
        }
        expect(spy).not.toHaveBeenCalled();
        const ok = await otp(phone(), signed(), { channel: 'sms' });
        expect(ok.status).toBe(201);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally { spy.mockRestore(); }
    });
  });

  describe('A3 · the tenant comes from the storefront context', () => {
    it('GET /v1/storefront/tenant answers the live tenant by slug; an unknown or non-live slug is 404 TENANT_NOT_FOUND', async () => {
      const r = await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', slug);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({ tenantId, slug, displayName: 'Store1a FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' });
      expect(JSON.stringify(r.body.data)).not.toMatch(/owner|phone"|gstin|pan/i);
      for (const s of [pendingSlug, 'no-such-store-x1']) {
        const n = await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', s);
        expect(n.status).toBe(404);
        expect(n.body.error.code).toBe('TENANT_NOT_FOUND');
      }
      expect((await request(http).get('/v1/storefront/tenant')).status).toBe(404);
    });

    it('verify without a body tenant signs in to the X-Tenant-Slug tenant; no tenant → 422; a non-live tenant slug → 422', async () => {
      const p = phone();
      const code = (await otp(p)).body.data.devCode as string;
      const none = await verify({ phone: p, code });
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe('TENANT_REQUIRED');
      const pending = await verify({ phone: p, code }, { 'x-tenant-slug': pendingSlug });
      expect(pending.status).toBe(422);
      expect(pending.body.error.code).toBe('TENANT_REQUIRED');
      const ok = await verify({ phone: p, code }, { 'x-tenant-slug': slug });
      expect(ok.status).toBe(201);
      expect(claims(ok.body.data.accessToken).tid).toBe(tenantId);
    });

    it('refresh without a body tenant uses the context; no tenant → 422; the old refresh token dies on rotation', async () => {
      const t = await signIn(phone());
      const none = await request(http).post('/v1/auth/refresh').set(signed()).send({ refreshToken: t.refreshToken });
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe('TENANT_REQUIRED');
      const r = await request(http).post('/v1/auth/refresh').set({ ...signed(), 'x-tenant-slug': slug }).send({ refreshToken: t.refreshToken });
      expect(r.status).toBe(201);
      expect(claims(r.body.data.accessToken).tid).toBe(tenantId);
      const stale = await request(http).post('/v1/auth/refresh').set(signed()).send({ refreshToken: t.refreshToken, tenantId });
      expect(stale.status).toBe(401);
      expect(stale.body.error.code).toBe('REFRESH_INVALID');
    });
  });

  describe('D4 · a buyer can buy after sign-in', () => {
    it('fresh buyer: /v1/cart 403 → onboarding/roles {customer} → refresh → order.create → /v1/cart 200', async () => {
      const t = await signIn(phone());
      expect(claims(t.accessToken).perms).not.toContain('order.create');
      const before = await request(http).get('/v1/cart').set({ authorization: `Bearer ${t.accessToken}`, ...signed() });
      expect(before.status).toBe(403);
      const g = await request(http).post('/v1/onboarding/roles').set({ authorization: `Bearer ${t.accessToken}`, 'idempotency-key': randomUUID(), ...signed() }).send({ role: 'customer' });
      expect(g.status).toBe(201);
      expect(g.body.data).toMatchObject({ roleCode: 'customer', alreadyGranted: false });
      const r = await request(http).post('/v1/auth/refresh').set(signed()).send({ refreshToken: t.refreshToken, tenantId });
      expect(r.status).toBe(201);
      expect(claims(r.body.data.accessToken).perms).toContain('order.create');
      const after = await request(http).get('/v1/cart').set({ authorization: `Bearer ${r.body.data.accessToken}`, ...signed() });
      expect(after.status).toBe(200);
    });

    it('selfserve_onboarding OFF → onboarding/roles is 404 (the storefront names this state)', async () => {
      const t = await signIn(phone());
      const flagKeys = ['flag:selfserve_onboarding', 'flags:all', 'flagstale:flag:selfserve_onboarding'];
      await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'selfserve_onboarding'`);
      for (const k of flagKeys) await cache.del(k);
      try {
        const g = await request(http).post('/v1/onboarding/roles').set({ authorization: `Bearer ${t.accessToken}`, 'idempotency-key': randomUUID(), ...signed() }).send({ role: 'customer' });
        expect(g.status).toBe(404);
        expect(g.body.error.code).toBe('NOT_FOUND');
      } finally {
        await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'selfserve_onboarding'`);
        for (const k of flagKeys) await cache.del(k);
      }
    });
  });

  describe('D5 · a person with confirmed TOTP', () => {
    it('verify → 403 TWO_FACTOR_PENDING with a challengeToken; /auth/2fa/verify with a TOTP mints tokens', async () => {
      const p = phone();
      const userId = randomUUID();
      await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, 'Staff Buyer')`, [userId, p]);
      const a = { userId, tenantId, ip: null, requestId: null };
      const { secret } = await twoFactor.enrol(a);
      await twoFactor.confirm(a, totpCodeAt(secret, Date.now()));
      const code = (await otp(p)).body.data.devCode as string;
      const v = await verify({ phone: p, code }, { 'x-tenant-slug': slug });
      expect(v.status).toBe(403);
      expect(v.body.error.code).toBe('TWO_FACTOR_PENDING');
      const challengeToken = v.body.error.details.challengeToken as string;
      expect(challengeToken.length).toBeGreaterThan(20);
      // a fresh 30-s step (the confirm above consumed the current one — the replay guard refuses a reused step)
      const next = totpCodeAt(secret, Date.now() + 30_000);
      let done = await request(http).post('/v1/auth/2fa/verify').set(signed()).send({ tenantId, challengeToken, code: next });
      if (done.status !== 201) done = await request(http).post('/v1/auth/2fa/verify').set(signed()).send({ tenantId, challengeToken, code: totpCodeAt(secret, Date.now() + 60_000) });
      expect(done.status).toBe(201);
      expect(claims(done.body.data.accessToken).tid).toBe(tenantId);
    });
  });

  describe('A1 · the storefront forwards each buyer\'s address, signed', () => {
    /** The guard's window is a fixed minute: start a burst early in a window so it never straddles two. */
    const freshWindow = async () => { const s = new Date().getSeconds(); if (s > 50) await new Promise((r) => setTimeout(r, (61 - s) * 1000)); };

    it('two buyers behind one storefront server get separate buckets on the 5/min OTP route', async () => {
      await freshWindow();
      const a = randIp(); const b = randIp();
      for (let i = 0; i < 5; i++) expect((await otp(phone(), signedFor(a))).status).toBe(201);
      const sixth = await otp(phone(), signedFor(a));
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.details).toMatchObject({ limit: 5, windowSec: 60 });
      expect((await otp(phone(), signedFor(b))).status).toBe(201);   // buyer B is not punished for buyer A
    });

    it('a forged or unsigned header is ignored: every such call shares the server\'s own bucket', async () => {
      await freshWindow();
      const forged = () => ({ 'x-kv-client-ip': randIp(), 'x-kv-client-ts': String(Math.floor(Date.now() / 1000)), 'x-kv-client-sig': 'f'.repeat(64) });
      for (let i = 0; i < 5; i++) expect((await otp(phone(), forged())).status).toBe(201);
      const sixth = await otp(phone(), { 'x-forwarded-for': randIp() });
      expect(sixth.status).toBe(429);
    });

    it('the login trail records the SIGNED address, not a spoofed X-Forwarded-For', async () => {
      const p = phone(); const ip = randIp();
      const code = (await otp(p)).body.data.devCode as string;
      const v = await request(http).post('/v1/auth/verify').set({ ...signedFor(ip), 'x-forwarded-for': '203.0.113.250', 'x-tenant-slug': slug }).send({ phone: p, code });
      expect(v.status).toBe(201);
      const row = (await admin.query(`SELECT host(ip) AS ip FROM login_events WHERE phone = $1 AND succeeded ORDER BY created_at DESC LIMIT 1`, [p])).rows[0];
      expect(row.ip).toBe(ip);
    });
  });

  describe('B6 · sessions and logout', () => {
    it('the sessions list carries a device family and `current`, never an IP; revoke kills that session; logout kills this one', async () => {
      const p = phone();
      const one = await signIn(p);
      await new Promise((r) => setTimeout(r, 31_000));          // the 30-s resend cooldown on this phone
      const two = await signIn(p);
      const list = await request(http).get('/v1/auth/sessions').set({ authorization: `Bearer ${two.accessToken}`, ...signed() });
      expect(list.status).toBe(200);
      const rows = list.body.data as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const s of rows) {
        expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'deviceFamily', 'expiresAt', 'id', 'lastSeenAt', 'revokedAt']);
        expect(JSON.stringify(s)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      }
      const mine = rows.find((s) => s.current === true)!;
      expect(mine.id).toBe(claims(two.accessToken).sid);
      const other = claims(one.accessToken).sid;
      const rv = await request(http).delete(`/v1/auth/sessions/${other}`).set({ authorization: `Bearer ${two.accessToken}`, ...signed() });
      expect(rv.status).toBe(200);
      const deadOne = await request(http).post('/v1/auth/refresh').set(signed()).send({ refreshToken: one.refreshToken, tenantId });
      expect(deadOne.body.error.code).toBe('REFRESH_INVALID');
      const lo = await request(http).post('/v1/auth/logout').set({ authorization: `Bearer ${two.accessToken}`, ...signed() }).send({ allDevices: false });
      expect(lo.status).toBe(201);
      const deadTwo = await request(http).post('/v1/auth/refresh').set(signed()).send({ refreshToken: two.refreshToken, tenantId });
      expect(deadTwo.status).toBe(401);
      expect(deadTwo.body.error.code).toBe('REFRESH_INVALID');
    }, 60_000);
  });
});
