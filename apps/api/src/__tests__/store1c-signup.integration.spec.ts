// apps/api/src/__tests__/store1c-signup.integration.spec.ts · PC-56 STORE-1c — FOR ORGANISATIONS, LIVE (the real AppModule over HTTP, real
// Postgres + RLS, kv_app; supertest drives the same middleware, guards, pipes and filter production runs).
//
// What it proves (brief §C6):
//   (1) flag ON  → POST /v1/tenant-signup creates a TRIAL tenant, an owner, a trial subscription, and the audit row tenancy.self_serve_signup;
//                  the response names the organisation as it was typed (not its slug) and carries the trial end date;
//   (2) flag OFF → 403 SIGNUP_DISABLED and the one-time code is NOT consumed: after flipping ON, the SAME code creates the organisation;
//   (3) replay   → the same Idempotency-Key + phone returns the SAME tenant (one tenant, one audit row); the same key with ANOTHER phone is
//                  another request (the key is scoped to the phone — never someone else's organisation and tokens);
//   (4) reserved → `for-organisations` (migration 0205) is refused by the database wall; a signup named "For Organisations" never takes it;
//   (5) plans    → GET /v1/storefront/plans?country=IN lists ONLY public + active + status 'active' plans of the country, newest version per
//                  code, money as minor STRINGS with the exponent; draft / archived / private / inactive / other-country plans are absent;
//                  a missing country is 400 COUNTRY_REQUIRED;
//   (6) flags    → GET /v1/storefront/flags with no tenant carries ONLY org_self_signup; with a tenant, exactly group_lots + org_self_signup;
//                  no rules / percentages leak;
//   (7) the new TRIAL tenant 404s anonymously but answers for its owner's bearer (the 1b rule, regression);
//   (8) the named refusals the storefront maps: a wrong code → 401 OTP_INVALID {reason:'wrong', attemptsLeft}; the route's own limit
//       (5 an hour per connection) → 429 {limit: 5, windowSec: 3600};
//   (9) the form's organisation-type registry (`lookups.values('tenant_type')`) answers with no tenant in context.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});

run('PC-56 STORE-1c · for organisations — signup switch, replay, plans, flags (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID();
  let liveSlug = ''; let orgType = '';
  const phone = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const flagKeys = ['flag:org_self_signup', 'flags:all', 'flagstale:org_self_signup'];
  const setSignup = async (on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'org_self_signup'`, [on]);
    for (const k of flagKeys) await cache.del(k);
  };
  // the route's own limit is 5 an hour per connection — the spec makes more than five calls from one address, so it clears its bucket
  const clearSignupLimit = async () => {
    const w = Math.floor(Date.now() / 1000 / 3600);
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) await cache.del(`rl:TenantSignupController.create:ip:${ip}:${w}`);
  };
  const body = (p: string, code: string, orgName = `Bhavnagar Kisan ${randomUUID().slice(0, 6)}`) =>
    ({ phone: p, code, fullName: 'Kavita Ben', orgName, orgTypeId: orgType, lang: 'gu', countryCode: 'IN' });
  const signup = (b: Record<string, unknown>, key: string = randomUUID()) => request(http).post('/v1/tenant-signup').set('idempotency-key', key).send(b);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, 'Anand FPO 1c');
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [LIVE]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    orgType = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' AND tenant_id IS NULL ORDER BY created_at LIMIT 1`)).rows[0].id;
    // the plan catalogue's excluded kinds, beside one plan that must show (a unique code family so the seeded plans never collide)
    const plan = (code: string, o: { country?: string; currency?: string; status?: string; pub?: boolean; active?: boolean; version?: number; monthly?: number } = {}) =>
      admin.query(`INSERT INTO plans (code, version, default_name, country_code, currency_code, monthly_price_minor, annual_price_minor, setup_fee_minor, is_public, is_active, status)
                   VALUES ($1, $2::int, $3, $4, $5, $6::bigint, $6::bigint * 10, 0, $7::boolean, $8::boolean, $9::text)`,
        [code, o.version ?? 1, `Plan ${code}`, o.country ?? 'IN', o.currency ?? 'INR', o.monthly ?? 123400, o.pub ?? true, o.active ?? true, o.status ?? 'active']);
    await plan('s1c_ok', { monthly: 100 });
    await plan('s1c_ok', { version: 2, monthly: 200 });                    // a price change is a new version: the newest wins
    await plan('s1c_draft', { status: 'draft', active: false });
    await plan('s1c_archived', { status: 'archived', active: false });
    await plan('s1c_draft_active', { status: 'draft', active: true });     // status alone must exclude it
    await plan('s1c_private', { pub: false });
    await plan('s1c_inactive', { active: false });
    await plan('s1c_jp', { country: 'JP', currency: 'JPY', monthly: 1500 });
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    await setSignup(true);
  }, 180_000);
  afterAll(async () => {
    await admin?.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'org_self_signup'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);
  beforeEach(async () => { await clearSignupLimit(); });

  it('0205 seeded the switch ON (the named Law 10 exception) and the reserved name', async () => {
    const f = (await admin.query(`SELECT is_enabled, rollout_pct FROM feature_flags WHERE key = 'org_self_signup'`)).rows[0];
    expect(f).toEqual({ is_enabled: true, rollout_pct: 100 });
    expect((await admin.query(`SELECT count(*)::int n FROM reserved_tenant_slugs WHERE slug IN ('for-organisations', 'tenants-signup')`)).rows[0].n).toBe(2);
  });

  it('(1) flag ON → a TRIAL tenant, its owner, a trial subscription, the audit row; the name as typed, the trial end date', async () => {
    const p = phone(); const { code } = await otp.issue(p);
    const r = await signup(body(p, code, 'Bhavnagar Kisan FPC 1c'));
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    const d = r.body.data;
    expect(d).toMatchObject({ displayName: 'Bhavnagar Kisan FPC 1c', resumed: false, onboardingStep: 'profile' });
    expect(d.slug).toMatch(/^bhavnagar-kisan-fpc-1c/);
    expect(d.trialEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.tokens.accessToken).toEqual(expect.any(String));
    const t = (await admin.query(`SELECT status, owner_phone FROM tenants WHERE id = $1`, [d.tenantId])).rows[0];
    expect(t).toEqual({ status: 'trial', owner_phone: p });
    expect((await admin.query(`SELECT count(*)::int n FROM subscriptions WHERE tenant_id = $1`, [d.tenantId])).rows[0].n).toBe(1);
    const audit = (await admin.query(`SELECT action, new_value FROM audit_log WHERE entity_id = $1 ORDER BY id`, [d.tenantId])).rows;
    expect(audit.map((a) => a.action)).toEqual(['tenancy.self_serve_signup']);
    expect(audit[0].new_value).toMatchObject({ status: 'trial', countryCode: 'IN', lang: 'gu' });
  });

  it('(2) flag OFF → 403 SIGNUP_DISABLED and the code is NOT consumed: switched back ON, the SAME code creates the organisation', async () => {
    const p = phone(); const { code } = await otp.issue(p);
    await setSignup(false);
    try {
      const off = await signup(body(p, code));
      expect([off.status, off.body.error?.code]).toEqual([403, 'SIGNUP_DISABLED']);
      expect((await admin.query(`SELECT count(*)::int n FROM users WHERE phone = $1`, [p])).rows[0].n).toBe(0);
      // the storefront's own read says the same thing BEFORE its form
      const f = await request(http).get('/v1/storefront/flags');
      // PC-56 STORE-2a (0207): + storefront_browse, the second platform-scoped switch (seeded ON)
      // PC-56 STORE-2b (0208): + storefront_cart, the third platform-scoped switch (seeded ON)
      // PC-56 STORE-6a (0221): + storefront_pwa, the fourth platform-scoped switch (seeded ON — the named Law 10 exception)
      expect(f.body.data).toEqual({ org_self_signup: false, storefront_browse: true, storefront_cart: true, storefront_pwa: true });
    } finally {
      await setSignup(true);
    }
    const on = await signup(body(p, code));
    expect([on.status, on.body.data?.resumed]).toEqual([201, false]);
  });

  it('(3) replay: the same key + phone returns the SAME tenant (one tenant, one audit row); the same key + another phone is another request', async () => {
    const p = phone(); const { code } = await otp.issue(p);
    const key = randomUUID();
    const b = body(p, code);
    const first = await signup(b, key);
    expect(first.status).toBe(201);
    const again = await signup(b, key);                                     // the code is spent — only a REPLAY can answer this
    expect(again.status).toBe(201);
    expect(again.body.data.tenantId).toBe(first.body.data.tenantId);
    expect((await admin.query(`SELECT count(*)::int n FROM tenants WHERE owner_phone = $1`, [p])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = 'tenancy.self_serve_signup'`, [first.body.data.tenantId])).rows[0].n).toBe(1);
    // the SAME key from another phone is NOT the first organisation (the replay is scoped to the phone)
    const q = phone(); const { code: c2 } = await otp.issue(q);
    const other = await signup(body(q, c2), key);
    expect(other.status).toBe(201);
    expect(other.body.data.tenantId).not.toBe(first.body.data.tenantId);
  });

  it('(4) `for-organisations` is refused by the database wall (0205); a signup named "For Organisations" never takes it', async () => {
    expect(await errCode(admin.query(`UPDATE tenants SET slug = 'for-organisations' WHERE id = $1`, [LIVE]))).toBe('TENANT_SLUG_RESERVED');
    const p = phone(); const { code } = await otp.issue(p);
    const r = await signup(body(p, code, 'For Organisations'));
    expect(r.status).toBe(201);
    expect(r.body.data.slug).not.toBe('for-organisations');
    expect(r.body.data.slug).toMatch(/^for-organisations-/);
  });

  it('(5) GET /v1/storefront/plans?country=IN — public, active, published, this country only, newest version; minor strings + exponent', async () => {
    const r = await request(http).get('/v1/storefront/plans').query({ country: 'in' });
    expect(r.status).toBe(200);
    expect(r.body.data.country).toBe('IN');
    const codes = (r.body.data.plans as Array<{ code: string }>).map((x) => x.code);
    expect(codes).toContain('s1c_ok');
    for (const absent of ['s1c_draft', 's1c_archived', 's1c_draft_active', 's1c_private', 's1c_inactive', 's1c_jp']) expect([absent, codes.includes(absent)]).toEqual([absent, false]);
    for (const quote of ['enterprise', 'government']) expect([quote, codes.includes(quote)]).toEqual([quote, false]);   // seeded is_public = false
    expect(r.body.data.plans.find((x: { code: string }) => x.code === 's1c_ok')).toEqual(
      { code: 's1c_ok', name: 'Plan s1c_ok', monthlyMinor: '200', annualMinor: '2000', setupFeeMinor: '0', currency: 'INR', exponent: 2 });
    const monthly = (r.body.data.plans as Array<{ monthlyMinor: string }>).map((x) => BigInt(x.monthlyMinor));
    expect(monthly).toEqual([...monthly].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));      // cheapest first
    expect(r.body.data.trialDays).toBe(14);                                                  // the seeded signup.trial_days
    const jp = await request(http).get('/v1/storefront/plans').query({ country: 'JP' });
    expect(jp.body.data.plans).toEqual([{ code: 's1c_jp', name: 'Plan s1c_jp', monthlyMinor: '1500', annualMinor: '15000', setupFeeMinor: '0', currency: 'JPY', exponent: 0 }]);
    for (const bad of [undefined, 'IND', '1N']) {
      const e = await request(http).get('/v1/storefront/plans').query(bad === undefined ? {} : { country: bad });
      expect([bad, e.status, e.body.error?.code]).toEqual([bad, 400, 'COUNTRY_REQUIRED']);
    }
  });

  it('(6) GET /v1/storefront/flags: no tenant → ONLY org_self_signup; a tenant → group_lots + org_self_signup; no rules leak', async () => {
    const platform = await request(http).get('/v1/storefront/flags');
    expect(platform.status).toBe(200);
    expect(platform.body.data).toEqual({ org_self_signup: true, storefront_browse: true, storefront_cart: true, storefront_pwa: true });   // PC-56 STORE-2a: + storefront_browse; STORE-2b: + storefront_cart; STORE-6a: + storefront_pwa (platform)
    const store = await request(http).get('/v1/storefront/flags').set('x-tenant-slug', liveSlug);
    expect(store.status).toBe(200);
    // PC-56 HOTFIX-4 · A8: + the five tenant-scoped switches the STORE-2 surfaces read
    // PC-56 STORE-2a: + storefront_browse (the platform's catalogue kill-switch, answered with or without a tenant)
    // PC-56 STORE-2b: + storefront_cart (buying's kill-switch, platform-scoped)
    // PC-56 STORE-3a · B6 (founder D2): + disputes (tenant-scoped, fail-closed — the order page's dispute door)
    // PC-56 STORE-4c · B1 (founder Q12): + communication (tenant-scoped, fail-closed — the headers' Messages link)
    // PC-56 HOTFIX-7 · B25: + `traceability` (tenant-scoped, 12 keys)
    // PC-56 STORE-5b · B5 (founder Q7): + `certificates_public` (tenant-scoped, seeded OFF — 13 keys)
    // PC-56 STORE-6a (0221): + `storefront_pwa` (platform-scoped, ON) + `storefront_offline_reads` (tenant-scoped, seeded OFF) — 15 keys
    // PC-56 STORE-6b (0222): + `storefront_install_prompt` (tenant-scoped, seeded OFF) — 16 keys
    // PC-56 STORE-SWEEP-b (founder D1, B11): + `logistics` (tenant-scoped, seeded OFF, fail-closed) — 17 keys
    expect(Object.keys(store.body.data).sort()).toEqual(['auctions', 'buyer_charges', 'certificates_public', 'communication', 'disputes', 'group_lots', 'logistics', 'offers', 'online_payments', 'org_self_signup', 'reviews', 'storefront_browse', 'storefront_cart', 'storefront_install_prompt', 'storefront_offline_reads', 'storefront_pwa', 'traceability']);
    expect(typeof store.body.data.group_lots).toBe('boolean');
    for (const b of [platform.body, store.body]) expect(JSON.stringify(b)).not.toMatch(/rollout|tenant_ids|rules|pct/);
  });

  it('(7) the new TRIAL tenant 404s anonymously, but answers for its owner\'s bearer (1b rule)', async () => {
    const p = phone(); const { code } = await otp.issue(p);
    const r = await signup(body(p, code));
    const { slug, tenantId, tokens } = r.body.data;
    const anon = await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', slug);
    expect([anon.status, anon.body.error?.code]).toEqual([404, 'TENANT_NOT_FOUND']);
    const owner = await request(http).get('/v1/storefront/tenant').set({ authorization: `Bearer ${tokens.accessToken}`, 'x-tenant-slug': slug });
    expect(owner.status).toBe(200);
    expect(owner.body.data).toMatchObject({ tenantId, slug });
  });

  it('(8) the refusals the storefront names: a wrong code → 401 OTP_INVALID {wrong, attemptsLeft}; the 6th call in an hour → 429 {5, 3600}', async () => {
    const p = phone(); await otp.issue(p);
    const wrong = await signup(body(p, '000000'));
    expect([wrong.status, wrong.body.error?.code, wrong.body.error?.details?.reason]).toEqual([401, 'OTP_INVALID', 'wrong']);
    expect(wrong.body.error.details.attemptsLeft).toEqual(expect.any(Number));
    await clearSignupLimit();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await signup(body(phone(), "000000"))).status);
    expect(statuses.every((s) => s !== 429)).toBe(true);
    const sixth = await signup(body(phone(), '000000'));
    expect([sixth.status, sixth.body.error?.details]).toEqual([429, { limit: 5, windowSec: 3600 }]);
  });

  it('(9) the W307 form\'s registry read answers with NO tenant in context: GET /v1/lookups/values?type=tenant_type lists the platform types', async () => {
    const r = await request(http).get('/v1/lookups/values').query({ type: 'tenant_type' });
    expect(r.status).toBe(200);
    expect((r.body.data as Array<{ id: string; code: string }>).map((x) => x.code)).toContain('fpo');
    expect((r.body.data as Array<{ id: string }>).some((x) => x.id === orgType)).toBe(true);
  });
});
