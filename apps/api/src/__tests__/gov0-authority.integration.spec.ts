// apps/api/src/__tests__/gov0-authority.integration.spec.ts · PC-56 GOV-0 · A GOVERNMENT AUTHORITY IS AN ORGANISATION — LIVE proof (the real
// AppModule over HTTP, real Postgres + RLS: kv_app for the request tier, the kv_gov axis for the authority's reads, kv_admin for the platform's
// appointment, 0239's guard, CHECKs, policies and DEFINER functions). GOV-1 Q2-A/Q3-A/Q4-A/Q5-A, lead-applied 2026-11-10.
//
// survey_gov1.md §7 `gov0-authority`, verbatim: "an authority head appointed in the admin realm; a request by B approved by B → refused, by C
// → active with `expires_at`; an expired membership → 401 on refresh; a `gov` session never refreshes into a tenant and back; an authority
// reads an application to its scheme in FPO X and FPO Y, never one to another authority's scheme (404); each read writes one recorded-read
// row; RLS gate count +N asserted." — plus the brief's §C list:
//   (1) the admin realm appoints the FIRST head (kv_admin) — never a second, never an officer, never an edit; kv_app / kv_relay /
//       kv_readonly / PUBLIC hold NOTHING on authority_memberships (42501); the RLS gate rises by exactly the four named policies;
//   (2) no confirmed TOTP → no gov session (no session row at all) → the enrolment step → phone code + authenticator code → a gov token
//       (aid + realm 'gov', no tid, no pid); no SSO / departmental / hardware-key route exists (404);
//   (3) a gov token on tenant routes (roster, member file, user record, finance) and on a partner route → 401; a tenant token on a gov route
//       → 401 GOV_SESSION_REQUIRED; a gov refresh token never refreshes into a tenant (or a partner) session, nor a tenant one into gov;
//   (4) B requests, B approves → GOV_APPROVER_IS_REQUESTER; the grantee approving → GOV_APPROVER_IS_GRANTEE; C approves → active with
//       expires_at = approval + the term; the CHECKs hold even for the owner; an authority role is never a tenant role;
//   (5) the officer reads applications to the authority's scheme in FPO X and FPO Y, never another authority's (404); masked fields masked,
//       location dropped, no applicant id; each opening writes ONE recorded-read row its organisation sees (and the other does not); a list
//       writes one row per organisation; the kv_gov axis without an authority reads nothing and never the form column;
//   (6) removal by ONE head, at once, recorded → the person's sessions cut (revoked_at), their access token 401, their refresh 401;
//   (7) an expired membership resolves no permission: access 401, refresh 401, sign-in GOV_ACCESS_NONE;
//   (8) `gov_console` OFF → 404 on every gov route (restored in afterAll).
// No hour-of-day literal anywhere; runs under IST and UTC.
import 'reflect-metadata';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { AppConfig } from '../core/config/app-config';
import { totpCodeAt } from '../modules/identity/domain/totp';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const pgCode = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
/** The RLS gate after migrate + seeds (HOTFIX-15 1,989 + GOV-0's four parent policies), before any partition sweep. */
const RLS_POLICIES_AFTER_GOV0 = 1993;
const NEW_POLICIES = ['am_admin_realm_read', 'am_admin_realm_insert', 'gov_own_schemes_scheme_applications', 'al_insert_gov_realm'];

run('PC-56 GOV-0 · a government authority is an organisation (integration, real AppModule over HTTP, kv_app + kv_gov + kv_admin)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvApp: Pool; let cache: CacheService; let otp: OtpService; let config: AppConfig;
  const X = randomUUID(); const Y = randomUUID();
  const AUTH1 = randomUUID(); const AUTH2 = randomUUID();
  const ids = { s1: '', s2: '', appX1: '', appY1: '', appX2: '', reqD: '', reqCOfficer: '' };
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, { accessToken: string; refreshToken: string }> = {};
  const secrets: Record<string, string> = {}; const recovery: Record<string, string[]> = {};
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
  let flagBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;
  const key = () => randomUUID();

  const user = async (k: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[k] = { id, phone };
  };
  /** A live membership written by HAND (a superuser login acting as itself — 0239's repair branch; the CHECKs still hold). */
  const handMembership = async (k: string, authorityId: string, roleCode: string) => (await admin.query(
    `INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason, approved_at, expires_at)
     SELECT $1, $2, r.id, 'active', 12, $3, 'fixture membership written by hand', now(), now() + interval '12 months' FROM roles r WHERE r.code = $4 RETURNING id`,
    [authorityId, people[k].id, randomUUID(), roleCode])).rows[0].id as string;
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    const routes = ['GovAuthController.otp', 'GovAuthController.verify', 'GovAuthController.verifyTwoFactor', 'GovAuthController.enrol', 'GovAuthController.confirm',
      'GovAuthController.refresh', 'GovMembersController.request', 'AuthController.verifyTwoFactor', 'AuthController.refresh', 'AuthController.verify', 'PartnerAuthController.refresh'];
    for (const r of routes) for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const otpVerify = async (k: string, extra: Record<string, unknown> = {}) => {
    await resetRates();
    const { code } = await otp.issue(people[k].phone);
    return request(http).post('/v1/gov/auth/verify').send({ phone: people[k].phone, code, ...extra });
  };
  /** First sign-in of a person: GOV_TWO_FACTOR_REQUIRED → enrol → confirm → phone code again → TWO_FACTOR_PENDING → the authenticator code. */
  const enrolAndSignIn = async (k: string) => {
    const r1 = await otpVerify(k);
    expect([r1.status, r1.body.error?.code]).toEqual([403, 'GOV_TWO_FACTOR_REQUIRED']);
    const enrolToken = r1.body.error.details.enrolToken as string;
    const en = await request(http).post('/v1/gov/auth/2fa/enrol').send({ enrolToken });
    expect(en.status).toBe(201);
    secrets[k] = en.body.data.secret;
    const now = Date.now();
    const cf = await request(http).post('/v1/gov/auth/2fa/confirm').send({ enrolToken, code: totpCodeAt(secrets[k], now) });
    expect(cf.status).toBe(201); recovery[k] = [...cf.body.data.recoveryCodes];
    const r2 = await otpVerify(k);
    expect([r2.status, r2.body.error?.code]).toEqual([403, 'TWO_FACTOR_PENDING']);
    const done = await request(http).post('/v1/gov/auth/2fa/verify').send({ challengeToken: r2.body.error.details.challengeToken, code: totpCodeAt(secrets[k], now + 30_000) });
    expect(done.status).toBe(201);
    tok[k] = done.body.data;
    return done.body.data as { accessToken: string; refreshToken: string };
  };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const claimsOf = (t: string) => jwt.decode(t) as Record<string, unknown>;
  const as = (k: string) => bearer(tok[k].accessToken);
  async function asRole<T>(role: 'kv_admin' | 'kv_gov' | 'kv_relay' | 'kv_readonly', gucs: Record<string, string>, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(gucs)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
      await c.query(`SET LOCAL ROLE ${role}`);
      const out = await fn(c); await c.query(commit ? 'COMMIT' : 'ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { await c.query('RESET ROLE').catch(() => undefined); c.release(); }
  }
  async function asKvApp<T>(gucs: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await kvApp.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(gucs)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const recorded = async (tenantId: string, purpose: string, applicationId?: string) => Number((await admin.query(
    `SELECT count(*)::int AS n FROM audit_read_log WHERE tenant_id = $1 AND purpose = $2 AND ($3::text IS NULL OR span_first = $3)`,
    [tenantId, purpose, applicationId ?? null])).rows[0].n);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    kvApp = new Pool({ connectionString: APP_URL, max: 3 });
    await makeTenant(admin, X, 'Gov Zero FPO X'); await makeTenant(admin, Y, 'Gov Zero FPO Y');
    // two authorities and one scheme each (shared tables: retired in afterAll — a membership row is never deleted, so the rows are kept inert)
    await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1, 'Gov Zero Test Authority One', 'state'), ($2, 'Gov Zero Test Authority Two', 'district')`, [AUTH1, AUTH2]);
    const category = (await admin.query(`SELECT category_id FROM schemes ORDER BY code LIMIT 1`)).rows[0].category_id;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const scheme = async (authorityId: string, code: string, name: string) => (await admin.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules) VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
      [code, name, authorityId, category])).rows[0].id as string;
    ids.s1 = await scheme(AUTH1, `gov0a_${suffix}`, 'Gov Zero Scheme One'); ids.s2 = await scheme(AUTH2, `gov0b_${suffix}`, 'Gov Zero Scheme Two');
    for (const [k, n] of [['B', 'Head B'], ['C', 'Head C'], ['D', 'Officer D'], ['E', 'Officer E'], ['F', 'Officer F'], ['farmerX', 'Applicant X'], ['farmerY', 'Applicant Y'], ['fpoAdmin', 'FPO admin X']] as const) await user(k, n);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, X]);
    const form = (farmer: string) => JSON.stringify({ landholdingAcres: 2.5, crop: 'groundnut', mobileNumber: people[farmer].phone, aadhaar: '123412341234',
      bankAccount: { accountNumber: '001122334455', ifsc: 'SBIN0001234', bankName: 'State Bank' }, farmLocation: { lat: 22.3, lng: 73.1 }, gpsLat: 22.31, village: 'Test village' });
    const application = async (tenantId: string, schemeId: string, farmer: string) => (await admin.query(
      `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, form_data, rejection_reason, submitted_at)
       VALUES ($1, $2, 1, $3, 'submitted', $4::jsonb, 'free text that names a person', now()) RETURNING id`, [tenantId, schemeId, people[farmer].id, form(farmer)])).rows[0].id as string;
    ids.appX1 = await application(X, ids.s1, 'farmerX'); ids.appY1 = await application(Y, ids.s1, 'farmerY'); ids.appX2 = await application(X, ids.s2, 'farmerX');
    flagBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'gov_console'`)).rows[0] ?? null;
    expect(flagBackup?.is_enabled).toBe(false);   // 0239 / seed 0009: OFF by default (Law 10)
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100 WHERE key = 'gov_console'`);
    // [lead QA] pinned to 127.0.0.1 (the HF-5 / hotfix14 precedent): unbound, supertest listens on every interface and an IPv4 ephemeral
    // port answered by another process gave one IST run a body-less 404 and a socket hang-up (2/8) on unchanged code.
    app = await bootstrapE2EApp(); await app.listen(0, '127.0.0.1'); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE); config = app.get(AppConfig);
    for (const k of flagKeys('gov_console')) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    if (flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'gov_console'`, [flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]).catch(() => undefined);
    await admin?.query(`UPDATE schemes SET is_active = false, deleted_at = now() WHERE id = ANY($1::uuid[])`, [[ids.s1, ids.s2].filter(Boolean)]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_authorities SET deleted_at = now() WHERE id = ANY($1::uuid[])`, [[AUTH1, AUTH2]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvApp?.end(); await admin?.end();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the admin realm appoints the FIRST head only; nobody else holds anything on the table; the RLS gate rises by the four named policies', async () => {
    const appoint = (userKey: string, roleCode: string, authorityId = AUTH1) => asRole('kv_admin', {}, (c) => c.query(
      `INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason)
       SELECT $1, $2, r.id, 'active', 12, $3, 'first head named by the department order' FROM roles r WHERE r.code = $4 RETURNING id, approved_at, expires_at`,
      [authorityId, people[userKey].id, randomUUID(), roleCode]).then((r) => r.rows[0]), true);
    const b = await appoint('B', 'authority_head');
    expect(new Date(b.expires_at).getTime()).toBeGreaterThan(Date.now());
    // the end date is the DATABASE's: exactly 12 months after the approval
    expect((await admin.query(`SELECT expires_at = approved_at + interval '12 months' AS ok, status FROM authority_memberships WHERE id = $1`, [b.id])).rows[0]).toEqual({ ok: true, status: 'active' });
    expect(await pgCode(appoint('C', 'authority_head'))).toBe('GOV_AUTHORITY_HAS_HEAD');                 // never a second head while one is current
    expect(await pgCode(appoint('D', 'authority_officer', AUTH2))).toBe('GOV_PLATFORM_APPOINTS_FIRST_HEAD_ONLY');   // never an officer
    expect(await pgCode(asRole('kv_admin', {}, (c) => c.query(`UPDATE authority_memberships SET status = 'removed' WHERE id = $1`, [b.id])))).toBe('42501');
    // kv_app / kv_relay / kv_readonly hold NOTHING on the table (42501) — the API reaches it only through 0239's DEFINER functions
    for (const sql of [`SELECT id FROM authority_memberships LIMIT 1`, `UPDATE authority_memberships SET status = 'removed' WHERE false`, `DELETE FROM authority_memberships WHERE false`,
      `INSERT INTO authority_memberships (authority_id, user_id, role_id, term_months, requested_by, request_reason) VALUES ('${AUTH1}', '${people.D.id}', '${randomUUID()}', 1, '${people.B.id}', 'a direct write by the app role')`]) {
      expect([sql.slice(0, 6), await pgCode(asKvApp({ 'app.authority_id': AUTH1, 'app.user_id': people.B.id }, (c) => c.query(sql)))]).toEqual([sql.slice(0, 6), '42501']);
    }
    for (const role of ['kv_relay', 'kv_readonly'] as const) expect(await pgCode(asRole(role, {}, (c) => c.query(`SELECT id FROM authority_memberships LIMIT 1`)))).toBe('42501');
    const grants = (await admin.query(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'authority_memberships' AND grantee IN ('kv_app', 'kv_relay', 'kv_readonly', 'PUBLIC')`)).rows;
    expect(grants).toEqual([]);
    expect((await admin.query(`SELECT relrowsecurity AND relforcerowsecurity AS forced FROM pg_class WHERE relname = 'authority_memberships'`)).rows[0].forced).toBe(true);
    // the RLS gate: exactly the four named policies are new, and the count is asserted
    expect((await admin.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1) ORDER BY 1`, [NEW_POLICIES])).rows.map((r) => r.policyname)).toEqual([...NEW_POLICIES].sort());
    expect(Number((await admin.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).rows[0].n)).toBe(RLS_POLICIES_AFTER_GOV0);
    // an authority role is never a tenant role
    expect(await pgCode(admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, false FROM roles WHERE code = 'authority_head'`, [people.C.id, X]))).toBe('GOV_ROLE_NOT_TENANT');
    // the second head and two officers are written BY HAND (the founder question: a lone head has no second person — see the report)
    await handMembership('C', AUTH1, 'authority_head');
    await handMembership('E', AUTH1, 'authority_officer');
    await handMembership('F', AUTH1, 'authority_officer');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) no confirmed authenticator → NO gov session (no row); enrol → phone code + authenticator code → a gov token (aid, realm, no tid/pid); no SSO route', async () => {
    const before = Number((await admin.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [people.F.id])).rows[0].n);
    const r1 = await otpVerify('F');
    expect([r1.status, r1.body.error.code]).toEqual([403, 'GOV_TWO_FACTOR_REQUIRED']);
    expect(r1.body.error.details).toEqual({ enrolToken: expect.any(String), expiresInSec: 600 });
    expect(Number((await admin.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [people.F.id])).rows[0].n)).toBe(before);   // no session row at all
    expect((await request(http).post('/v1/gov/auth/2fa/enrol').send({ enrolToken: 'x'.repeat(43) })).body.error.code).toBe('GOV_ENROL_TOKEN_INVALID');
    const enrolToken = r1.body.error.details.enrolToken;
    const en = await request(http).post('/v1/gov/auth/2fa/enrol').send({ enrolToken });
    expect(en.status).toBe(201); secrets.F = en.body.data.secret;
    const now = Date.now();
    const cf = await request(http).post('/v1/gov/auth/2fa/confirm').send({ enrolToken, code: totpCodeAt(secrets.F, now) });
    expect(cf.status).toBe(201); expect(cf.body.data).toMatchObject({ confirmed: true, next: 'sign_in_again' }); recovery.F = [...cf.body.data.recoveryCodes];
    // the enrolment's audit row is a GOV-realm row: no tenant, the authority named
    const trail = (await admin.query(`SELECT tenant_id, new_value FROM audit_log WHERE action = 'two_factor.enabled' AND actor_user_id = $1`, [people.F.id])).rows;
    expect(trail).toHaveLength(1); expect(trail[0]).toMatchObject({ tenant_id: null, new_value: { authorityId: AUTH1 } });
    const r2 = await otpVerify('F');
    expect([r2.status, r2.body.error.code]).toEqual([403, 'TWO_FACTOR_PENDING']);
    const challenge = r2.body.error.details.challengeToken;
    // a pending GOV session cannot be finished through the TENANT 2FA route (realms never cross)
    await resetRates();
    expect((await request(http).post('/v1/auth/2fa/verify').send({ tenantId: X, challengeToken: challenge, code: totpCodeAt(secrets.F, now + 30_000) })).status).toBe(401);
    const done = await request(http).post('/v1/gov/auth/2fa/verify').send({ challengeToken: challenge, code: totpCodeAt(secrets.F, now + 30_000) });
    expect(done.status).toBe(201);
    tok.F = done.body.data;
    const c = claimsOf(tok.F.accessToken);
    expect(c).toMatchObject({ sub: people.F.id, aid: AUTH1, realm: 'gov', typ: 'gov_access' });
    expect(c).not.toHaveProperty('tid'); expect(c).not.toHaveProperty('pid');
    expect(c.perms).toEqual(['authority.applications.read', 'authority.members.read', 'authority.members.request']);
    expect((await admin.query(`SELECT realm, authority_id, partner_id FROM sessions WHERE id = $1`, [c.sid])).rows[0]).toEqual({ realm: 'gov', authority_id: AUTH1, partner_id: null });
    const me = await request(http).get('/v1/gov/me').set(as('F'));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ realm: 'gov', authority: { id: AUTH1, name: 'Gov Zero Test Authority One', level: 'state' },
      person: { userId: people.F.id, roles: ['authority_officer'], phoneMasked: `••••••${people.F.phone.slice(-3)}`, accessEndsAt: expect.any(String) } });
    expect(JSON.stringify(me.body)).not.toContain(people.F.phone);
    // no SSO / departmental / hardware-key route exists (Q5-A)
    for (const p of ['/v1/gov/auth/sso', '/v1/gov/auth/departmental', '/v1/gov/auth/hardware-key', '/v1/gov/auth/webauthn']) expect((await request(http).post(p).send({})).status).toBe(404);
    // a phone with no live authority membership, and an unknown phone, answer the same
    await user('stranger', 'No authority');
    expect((await otpVerify('stranger')).body.error.code).toBe('GOV_ACCESS_NONE');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) a gov token on tenant and partner routes → 401; a tenant token on a gov route → 401; a gov refresh token never refreshes into a tenant (and back)', async () => {
    for (const p of ['auth/sessions', 'members/roster', `members/roster/${people.farmerX.id}`, `users/${people.farmerX.id}`, 'rbac/assignments', 'tenancy/console/dashboard', 'schemes/applications']) {
      const r = await request(http).get(`/v1/${p}`).set({ ...as('F'), 'x-tenant-id': X });
      expect([p, r.status]).toEqual([p, 401]);
    }
    expect((await request(http).post('/v1/invoices/gstr1').set({ ...as('F'), 'x-tenant-id': X, 'idempotency-key': key() }).send({ period: '2026-10' })).status).toBe(401);
    expect((await request(http).get('/v1/partner/me').set(as('F'))).status).toBe(404);   // partner_console OFF: invisible; ON it answers 401 (pinned by partner0)
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: X, roles: ['tenant_admin'], perms: ['scheme.process', 'report.view'] });
    const refused = await request(http).get('/v1/gov/applications').set(bearer(tenantTok));
    expect([refused.status, refused.body.error.code]).toEqual([401, 'GOV_SESSION_REQUIRED']);
    // a gov-typed token signed with the real secret but WITHOUT `realm` is refused
    const a = config.auth; const c = claimsOf(tok.F.accessToken);
    const noRealm = jwt.sign({ aid: AUTH1, sid: c.sid, roles: c.roles, perms: c.perms, typ: 'gov_access' }, a.accessSecret, { subject: people.F.id, issuer: a.issuer, audience: a.audience, expiresIn: 300, algorithm: 'HS256' });
    expect((await request(http).get('/v1/gov/me').set(bearer(noRealm))).body.error.code).toBe('GOV_SESSION_REQUIRED');
    // refresh: gov → gov works; a gov refresh token is no tenant (or partner) refresh token; a tenant one is no gov one
    await resetRates();
    const ref = await request(http).post('/v1/gov/auth/refresh').send({ refreshToken: tok.F.refreshToken });
    expect(ref.status).toBe(201); expect(claimsOf(ref.body.data.accessToken)).toMatchObject({ aid: AUTH1, realm: 'gov' });
    tok.F = ref.body.data;
    expect((await request(http).post('/v1/auth/refresh').send({ refreshToken: tok.F.refreshToken, tenantId: X })).status).toBe(401);
    // …and back: a real TENANT session's refresh token is no gov refresh token (and is not consumed by the attempt)
    await resetRates();
    const { code } = await otp.issue(people.fpoAdmin.phone);
    const tl = await request(http).post('/v1/auth/verify').send({ phone: people.fpoAdmin.phone, code, tenantId: X });
    expect(tl.status).toBe(201);
    expect((await request(http).post('/v1/gov/auth/refresh').send({ refreshToken: tl.body.data.refreshToken })).status).toBe(401);
    await resetRates();
    expect((await request(http).post('/v1/auth/refresh').send({ refreshToken: tl.body.data.refreshToken, tenantId: X })).status).toBe(201);
    // and the gov refresh token still works afterwards (the tenant attempt did not consume or move it)
    await resetRates();
    const again = await request(http).post('/v1/gov/auth/refresh').send({ refreshToken: tok.F.refreshToken });
    expect(again.status).toBe(201); tok.F = again.body.data;
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) B requests, B approves → refused; the grantee approving → refused; C approves → active with expires_at; the CHECKs hold for the owner', async () => {
    await enrolAndSignIn('B'); await enrolAndSignIn('C');
    expect(claimsOf(tok.B.accessToken).perms).toEqual(['authority.applications.read', 'authority.members.approve', 'authority.members.read', 'authority.members.remove', 'authority.members.request']);
    // B asks for D as an officer for 6 months
    const rq = await request(http).post('/v1/gov/members/requests').set({ ...as('B'), 'idempotency-key': key() })
      .send({ phone: people.D.phone, roleCode: 'authority_officer', termMonths: 6, reason: 'district scheme officer for the kharif desk' });
    expect(rq.status).toBe(201); expect(rq.body.data).toMatchObject({ status: 'requested', roleCode: 'authority_officer', termMonths: 6 });
    ids.reqD = rq.body.data.id;
    // B approves B's own request → refused by name, nothing moved
    const self = await request(http).post(`/v1/gov/members/${ids.reqD}/approve`).set({ ...as('B'), 'idempotency-key': key() });
    expect([self.status, self.body.error.code]).toEqual([403, 'GOV_APPROVER_IS_REQUESTER']);
    expect((await admin.query(`SELECT status, approved_by FROM authority_memberships WHERE id = $1`, [ids.reqD])).rows[0]).toEqual({ status: 'requested', approved_by: null });
    // the grantee approving: B asks for C (already a head) as an officer; C approves → refused by name
    const rq2 = await request(http).post('/v1/gov/members/requests').set({ ...as('B'), 'idempotency-key': key() })
      .send({ phone: people.C.phone, roleCode: 'authority_officer', termMonths: 3, reason: 'cover for the officer on leave' });
    expect(rq2.status).toBe(201); ids.reqCOfficer = rq2.body.data.id;
    const grantee = await request(http).post(`/v1/gov/members/${ids.reqCOfficer}/approve`).set({ ...as('C'), 'idempotency-key': key() });
    expect([grantee.status, grantee.body.error.code]).toEqual([403, 'GOV_APPROVER_IS_GRANTEE']);
    // an officer (F) cannot approve at all (the permission guard), nor remove
    expect((await request(http).post(`/v1/gov/members/${ids.reqD}/approve`).set({ ...as('F'), 'idempotency-key': key() })).body.error.code).toBe('GOV_PERMISSION_MISSING');
    // no key → named, before anything
    expect((await request(http).post(`/v1/gov/members/${ids.reqD}/approve`).set(as('C'))).body.error.code).toBe('GOV_IDEMPOTENCY_KEY_REQUIRED');
    // C — the second person — approves D → active, with the end date the DATABASE wrote: approval + 6 months
    const ok = await request(http).post(`/v1/gov/members/${ids.reqD}/approve`).set({ ...as('C'), 'idempotency-key': key() });
    expect(ok.status).toBe(201); expect(ok.body.data).toMatchObject({ id: ids.reqD, status: 'active', expiresAt: expect.any(String) });
    const row = (await admin.query(`SELECT status, approved_by, requested_by, expires_at = approved_at + interval '6 months' AS six FROM authority_memberships WHERE id = $1`, [ids.reqD])).rows[0];
    expect(row).toEqual({ status: 'active', approved_by: people.C.id, requested_by: people.B.id, six: true });
    // approving twice → not pending
    expect((await request(http).post(`/v1/gov/members/${ids.reqD}/approve`).set({ ...as('C'), 'idempotency-key': key() })).body.error.code).toBe('GOV_REQUEST_NOT_PENDING');
    // the audit rows: gov-realm, no tenant, the authority named
    const trail = (await admin.query(`SELECT action, tenant_id, new_value->>'authorityId' AS a FROM audit_log WHERE entity_id = $1 ORDER BY created_at`, [ids.reqD])).rows;
    expect(trail).toEqual([{ action: 'gov.membership.requested', tenant_id: null, a: AUTH1 }, { action: 'gov.membership.approved', tenant_id: null, a: AUTH1 }]);
    // THE CHECKS hold for every role, the owner included: the requester or the grantee as approver; an end beyond 12 months
    expect(await pgCode(admin.query(`UPDATE authority_memberships SET status = 'active', approved_by = requested_by, approved_at = now(), expires_at = now() + interval '1 month' WHERE id = $1`, [ids.reqCOfficer]))).toBe('23514');
    expect(await pgCode(admin.query(`UPDATE authority_memberships SET status = 'active', approved_by = user_id, approved_at = now(), expires_at = now() + interval '1 month' WHERE id = $1`, [ids.reqCOfficer]))).toBe('23514');
    expect(await pgCode(admin.query(`UPDATE authority_memberships SET expires_at = approved_at + interval '13 months' WHERE id = $1`, [ids.reqD]))).toBe('23514');
    // the guard: kv_app's DEFINER act as the requester → refused in the DATABASE too (the service is not the only wall)
    expect(await pgCode(asKvApp({ 'app.authority_id': AUTH1, 'app.user_id': people.B.id, 'app.tenant_id': '' }, (c) => c.query(`SELECT gov_membership_approve($1)`, [ids.reqCOfficer])))).toBe('GOV_APPROVER_IS_REQUESTER');
    expect(await pgCode(asKvApp({ 'app.authority_id': AUTH1, 'app.user_id': people.C.id, 'app.tenant_id': '' }, (c) => c.query(`SELECT gov_membership_approve($1)`, [ids.reqCOfficer])))).toBe('GOV_APPROVER_IS_GRANTEE');
    // the people read: names to the authority's own members, phones by their last 3
    const list = await request(http).get('/v1/gov/members').set(as('F'));
    expect(list.status).toBe(200);
    expect(list.body.data.find((m: { membershipId: string }) => m.membershipId === ids.reqD)).toMatchObject({ status: 'active', live: true, roleCode: 'authority_officer', requestedBy: people.B.id, approvedBy: people.C.id, phoneMasked: `••••••${people.D.phone.slice(-3)}` });
    expect(JSON.stringify(list.body)).not.toContain(people.D.phone);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) the officer reads applications to the authority\'s scheme in FPO X and FPO Y, never another authority\'s (404); masked; every opening recorded', async () => {
    await enrolAndSignIn('D');
    const listedX0 = await recorded(X, 'gov_application_list'); const listedY0 = await recorded(Y, 'gov_application_list');
    const list = await request(http).get('/v1/gov/applications').set(as('D'));
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id).sort()).toEqual([ids.appX1, ids.appY1].sort());
    expect(list.body.data.map((x: { organisationId: string }) => x.organisationId).sort()).toEqual([X, Y].sort());
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(`${people.farmerX.id}|${people.farmerY.id}|form|applicant`));
    expect([await recorded(X, 'gov_application_list') - listedX0, await recorded(Y, 'gov_application_list') - listedY0]).toEqual([1, 1]);
    // another authority's scheme, an unknown id and a malformed id: the same 404, and nothing recorded for them
    for (const id of [ids.appX2, randomUUID(), 'not-an-id']) {
      const r = await request(http).get(`/v1/gov/applications/${id}`).set(as('D'));
      expect([id, r.status, r.body.error.code]).toEqual([id, 404, 'GOV_APPLICATION_NOT_FOUND']);
    }
    expect(await recorded(X, 'gov_application_open', ids.appX2)).toBe(0);
    // opening X1: the masked form — phone / Aadhaar / bank masked, every location key dropped, no applicant id, no free text
    const o = await request(http).get(`/v1/gov/applications/${ids.appX1}`).set(as('D'));
    expect(o.status).toBe(200);
    expect(o.body.data).toMatchObject({ id: ids.appX1, organisationId: X, scheme: { id: ids.s1, name: 'Gov Zero Scheme One' }, status: 'submitted', recorded: true });
    // (the bank block is one PII key: its whole value is masked to the last 3 characters of its text — jsonb orders the keys, so '455')
    expect(o.body.data.form).toEqual({ landholdingAcres: 2.5, crop: 'groundnut', mobileNumber: `••••••${people.farmerX.phone.slice(-3)}`, aadhaar: '••••••234',
      bankAccount: '••••••455', village: 'Test village' });
    const text = JSON.stringify(o.body);
    for (const leak of [people.farmerX.phone, people.farmerX.id, '123412341234', '001122334455', 'SBIN0001234', 'farmLocation', 'gpsLat', 'free text that names']) expect([leak, text.includes(leak)]).toEqual([leak, false]);
    // ONE recorded-read row per opening, a TENANT row of the application's organisation — X sees it, Y does not
    expect(await recorded(X, 'gov_application_open', ids.appX1)).toBe(1);
    await request(http).get(`/v1/gov/applications/${ids.appX1}`).set(as('D'));
    expect(await recorded(X, 'gov_application_open', ids.appX1)).toBe(2);
    const rowX = (await admin.query(`SELECT actor_user_id, actor_role, surface, filter, row_count FROM audit_read_log WHERE tenant_id = $1 AND purpose = 'gov_application_open' AND span_first = $2 LIMIT 1`, [X, ids.appX1])).rows[0];
    expect(rowX).toEqual({ actor_user_id: people.D.id, actor_role: `gov:${AUTH1}:authority_officer`, surface: 'gov.application', filter: { authorityId: AUTH1, applicationId: ids.appX1 }, row_count: 1 });
    expect(await asKvApp({ 'app.tenant_id': X }, (c) => c.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE purpose = 'gov_application_open' AND span_first = $1`, [ids.appX1]).then((r) => r.rows[0].n))).toBe(2);
    expect(await asKvApp({ 'app.tenant_id': Y }, (c) => c.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE purpose = 'gov_application_open' AND span_first = $1`, [ids.appX1]).then((r) => r.rows[0].n))).toBe(0);
    const y = await request(http).get(`/v1/gov/applications/${ids.appY1}`).set(as('D'));
    expect([y.status, y.body.data.organisationId]).toEqual([200, Y]);
    expect(await recorded(Y, 'gov_application_open', ids.appY1)).toBe(1);
    // the axis itself: kv_gov with no authority reads nothing; never the form, the applicant or the free text; AUTH2's axis never sees S1's
    expect(await asRole('kv_gov', {}, (c) => c.query(`SELECT count(*)::int AS n FROM scheme_applications`).then((r) => r.rows[0].n))).toBe(0);
    expect(await asRole('kv_gov', { 'app.authority_id': AUTH2 }, (c) => c.query(`SELECT id FROM scheme_applications`).then((r) => r.rows.map((x) => x.id)))).toEqual([ids.appX2]);
    // [lead QA, GOV-0] all EIGHT never-columns of 0239's grant comment — a lead mutant granting `eligibility_check` (it may carry income or
    // category) passed this spec 8/8 while it probed only four.
    for (const col of ['form_data', 'applicant_user_id', 'rejection_reason', 'assisted_by', 'govt_app_ref', 'eligibility_check', 'created_by', 'updated_by']) {
      expect([col, await pgCode(asRole('kv_gov', { 'app.authority_id': AUTH1 }, (c) => c.query(`SELECT ${col} FROM scheme_applications LIMIT 1`)))]).toEqual([col, '42501']);
    }
    expect(await asRole('kv_gov', { 'app.authority_id': AUTH2 }, (c) => c.query(`SELECT gov_application_form($1) AS f`, [ids.appX1]).then((r) => r.rows[0].f))).toBeNull();
    // no write exists on an application in this realm
    expect((await request(http).post(`/v1/gov/applications/${ids.appX1}/approve`).set({ ...as('D'), 'idempotency-key': key() })).status).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) removal by ONE head, at once, recorded: D\'s sessions are cut, the access token and the refresh token answer 401', async () => {
    const dSid = claimsOf(tok.D.accessToken).sid as string;
    expect((await request(http).post(`/v1/gov/members/${ids.reqD}/remove`).set({ ...as('B'), 'idempotency-key': key() }).send({ reason: 'short' })).body.error.code).toBe('GOV_REASON_REQUIRED');
    const bRow = (await request(http).get('/v1/gov/members').set(as('B'))).body.data.find((m: { userId: string; roleCode: string }) => m.userId === people.B.id && m.roleCode === 'authority_head');
    expect((await request(http).post(`/v1/gov/members/${bRow.membershipId}/remove`).set({ ...as('B'), 'idempotency-key': key() }).send({ reason: 'stepping down from the post' })).body.error.code).toBe('GOV_REMOVE_SELF');
    const r = await request(http).post(`/v1/gov/members/${ids.reqD}/remove`).set({ ...as('B'), 'idempotency-key': key() }).send({ reason: 'transferred to another department' });
    expect(r.status).toBe(201); expect(r.body.data).toEqual({ id: ids.reqD, status: 'removed', sessionsEnded: 1 });
    expect((await admin.query(`SELECT revoked_at IS NOT NULL AS cut FROM sessions WHERE id = $1`, [dSid])).rows[0].cut).toBe(true);
    expect((await admin.query(`SELECT status, removed_by, removed_reason FROM authority_memberships WHERE id = $1`, [ids.reqD])).rows[0]).toEqual({ status: 'removed', removed_by: people.B.id, removed_reason: 'transferred to another department' });
    const me = await request(http).get('/v1/gov/me').set(as('D'));
    expect([me.status, me.body.error.code]).toEqual([401, 'GOV_SESSION_ENDED']);
    await resetRates();
    expect((await request(http).post('/v1/gov/auth/refresh').send({ refreshToken: tok.D.refreshToken })).status).toBe(401);
    expect((await admin.query(`SELECT tenant_id, new_value->>'sessionsEnded' AS n, reason FROM audit_log WHERE action = 'gov.membership.removed' AND entity_id = $1`, [ids.reqD])).rows).toEqual([{ tenant_id: null, n: '1', reason: 'transferred to another department' }]);
    // removed is final: no approval, no second removal
    expect((await request(http).post(`/v1/gov/members/${ids.reqD}/remove`).set({ ...as('B'), 'idempotency-key': key() }).send({ reason: 'transferred to another department' })).body.error.code).toBe('GOV_MEMBERSHIP_NOT_FOUND');
    expect((await otpVerify('D')).body.error.code).toBe('GOV_ACCESS_NONE');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) an expired membership resolves no permission: its access token and its refresh answer 401, its sign-in GOV_ACCESS_NONE', async () => {
    await enrolAndSignIn('E');
    expect((await request(http).get('/v1/gov/applications').set(as('E'))).status).toBe(200);
    // the end passes (by hand: approved 13 months ago, ended a month ago — the CHECK still holds)
    await admin.query(`UPDATE authority_memberships SET approved_at = now() - interval '13 months', expires_at = now() - interval '1 month'
                        WHERE user_id = $1 AND authority_id = $2`, [people.E.id, AUTH1]);
    const r = await request(http).get('/v1/gov/applications').set(as('E'));
    expect([r.status, r.body.error.code]).toEqual([401, 'GOV_SESSION_ENDED']);
    await resetRates();
    expect((await request(http).post('/v1/gov/auth/refresh').send({ refreshToken: tok.E.refreshToken })).status).toBe(401);
    expect((await otpVerify('E')).body.error.code).toBe('GOV_ACCESS_NONE');
    expect(await asKvApp({ 'app.tenant_id': '' }, (c) => c.query(`SELECT count(*)::int AS n FROM gov_access($1, $2)`, [people.E.id, AUTH1]).then((x) => x.rows[0].n))).toBe(0);
    // the people read says so: not live
    expect((await request(http).get('/v1/gov/members').set(as('B'))).body.data.find((m: { userId: string }) => m.userId === people.E.id)).toMatchObject({ status: 'active', live: false });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (8) LAST: switches the realm off
  it('(8) gov_console OFF → 404 on every gov route; GET /v1/config/flags carries the key', async () => {
    const flags = await request(http).get('/v1/config/flags');
    expect(flags.status).toBe(200); expect(JSON.stringify(flags.body)).toContain('gov_console');
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'gov_console'`);
    for (const k of flagKeys('gov_console')) await cache.del(k);
    await resetRates();
    for (const [m, p] of [['post', '/v1/gov/auth/otp'], ['post', '/v1/gov/auth/verify'], ['post', '/v1/gov/auth/refresh'], ['post', '/v1/gov/auth/2fa/enrol'], ['get', '/v1/gov/me'],
      ['get', '/v1/gov/members'], ['post', '/v1/gov/members/requests'], ['get', '/v1/gov/applications'], ['get', `/v1/gov/applications/${ids.appX1}`]] as const) {
      const r = await (request(http) as any)[m](p).set(as('B')).send({});
      expect([p, r.status]).toEqual([p, 404]);
    }
  });
});
