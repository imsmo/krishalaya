// apps/api/src/__tests__/gov1b-overview.integration.spec.ts · PC-56 GOV-1b · GOV1-B5 — THE AUTHORITY'S OVERVIEW, LIVE (the real AppModule over
// HTTP on 127.0.0.1, real Postgres + RLS, the kv_gov axis). GOV-1 Q1-A and Q3-A, lead-applied 2026-11-10 (the founder may reopen).
//
// brief_gov1b.md §C, verbatim: "counts equal a hand count over seeded rows across a page boundary (> 50 applications) and across two
// organisations; another authority's applications never counted; no application id, applicant, form field or organisation member in the
// JSON (walk it); credits a count, never a sum; `gov_console` OFF → 404; a tenant token → 401." Credits: the premise "the axis can count
// dbt_transfers" is FALSE — kv_gov holds no grant on dbt_transfers (asserted here) — so the overview carries NO credit at all (no key).
// Plus: drafts and deleted rows are not counted; each queue's oldest age in whole days since the row last changed; no recorded-read row is
// written (no application is opened); the window is all time. No hour-of-day literal; runs under IST and UTC.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { totpCodeAt } from '../modules/identity/domain/totp';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const CANARY = 'LEAKCANARY_FORM_VALUE';

run('PC-56 GOV-1b · the authority\'s overview (integration, real AppModule over HTTP, the kv_gov axis)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const X = randomUUID(); const Y = randomUUID();
  const AUTH1 = randomUUID(); const AUTH2 = randomUUID();
  const s = { a: '', b: '', z: '' };
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, { accessToken: string; refreshToken: string }> = {};
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
  let flagBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;

  const user = async (k: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[k] = { id, phone };
  };
  /** A live membership written by HAND (a superuser login acting as itself — 0239's repair branch; the CHECKs still hold). */
  const handMembership = async (k: string, authorityId: string, roleCode: string) => admin.query(
    `INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason, approved_at, expires_at)
     SELECT $1, $2, r.id, 'active', 12, $3, 'fixture membership written by hand', now(), now() + interval '12 months' FROM roles r WHERE r.code = $4`,
    [authorityId, people[k].id, randomUUID(), roleCode]);
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['GovAuthController.otp', 'GovAuthController.verify', 'GovAuthController.verifyTwoFactor', 'GovAuthController.enrol', 'GovAuthController.confirm'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const otpVerify = async (k: string) => {
    await resetRates();
    const { code } = await otp.issue(people[k].phone);
    return request(http).post('/v1/gov/auth/verify').send({ phone: people[k].phone, code });
  };
  const enrolAndSignIn = async (k: string) => {
    const r1 = await otpVerify(k);
    expect([r1.status, r1.body.error?.code]).toEqual([403, 'GOV_TWO_FACTOR_REQUIRED']);
    const enrolToken = r1.body.error.details.enrolToken as string;
    const en = await request(http).post('/v1/gov/auth/2fa/enrol').send({ enrolToken });
    expect(en.status).toBe(201);
    const now = Date.now();
    expect((await request(http).post('/v1/gov/auth/2fa/confirm').send({ enrolToken, code: totpCodeAt(en.body.data.secret, now) })).status).toBe(201);
    const r2 = await otpVerify(k);
    expect([r2.status, r2.body.error?.code]).toEqual([403, 'TWO_FACTOR_PENDING']);
    const done = await request(http).post('/v1/gov/auth/2fa/verify').send({ challengeToken: r2.body.error.details.challengeToken, code: totpCodeAt(en.body.data.secret, now + 30_000) });
    expect(done.status).toBe(201);
    tok[k] = done.body.data;
  };
  const as = (k: string) => ({ authorization: `Bearer ${tok[k].accessToken}` });
  /** `n` applications in ONE statement; `ageDays` sets the row's last change that many days (and one hour) ago; `extra` = draft / deleted. */
  const apps = (tenantId: string, schemeId: string, status: string, n: number, ageDays = 0, deleted = false) => admin.query(
    `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, form_data, submitted_at, created_at, updated_at, deleted_at)
     SELECT $1, $2, 1, $3, $4::application_status, $5::jsonb, now() - make_interval(days => $6::int), now() - make_interval(days => $6::int, hours => 1),
            now() - make_interval(days => $6::int, hours => 1), CASE WHEN $8::boolean THEN now() ELSE NULL END
       FROM generate_series(1, $7::int)`,
    [tenantId, schemeId, people.farmer.id, status, JSON.stringify({ secretField: CANARY, mobileNumber: people.farmer.phone }), ageDays, n, deleted]);
  const reads = async () => Number((await admin.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE tenant_id = ANY($1::uuid[])`, [[X, Y]])).rows[0].n);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, X, 'Gov One B FPO X'); await makeTenant(admin, Y, 'Gov One B FPO Y');
    await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1, 'Gov One B Test Authority One', 'state'), ($2, 'Gov One B Test Authority Two', 'district')`, [AUTH1, AUTH2]);
    const category = (await admin.query(`SELECT category_id FROM schemes ORDER BY code LIMIT 1`)).rows[0].category_id;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const scheme = async (authorityId: string, code: string, name: string) => (await admin.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules) VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
      [code, name, authorityId, category])).rows[0].id as string;
    s.a = await scheme(AUTH1, `gov1ba_${suffix}`, 'Gov One B Scheme A'); s.b = await scheme(AUTH1, `gov1bb_${suffix}`, 'Gov One B Scheme B');
    s.z = await scheme(AUTH2, `gov1bz_${suffix}`, 'Gov One B Scheme Z');
    for (const [k, n] of [['O', 'Officer O'], ['Z', 'Officer Z'], ['farmer', 'Applicant Farmer'], ['fpoAdmin', 'FPO admin X']] as const) await user(k, n);
    await handMembership('O', AUTH1, 'authority_officer'); await handMembership('Z', AUTH2, 'authority_officer');
    // THE SEEDED ROWS (the hand count below): AUTH1 — 64 counted across two organisations and two schemes; plus drafts and deleted rows
    await apps(X, s.a, 'submitted', 30, 1); await apps(X, s.a, 'clarification_needed', 4, 2); await apps(X, s.a, 'clarification_needed', 1, 9);
    await apps(X, s.a, 'appealed', 2, 3); await apps(X, s.a, 'appealed', 1, 20);
    await apps(Y, s.a, 'approved', 15, 5); await apps(Y, s.a, 'rejected', 2, 6);
    await apps(Y, s.b, 'submitted', 6, 0); await apps(Y, s.b, 'clarification_needed', 2, 4); await apps(Y, s.b, 'disbursed', 1, 7);
    await apps(X, s.b, 'draft', 3, 30); await apps(X, s.b, 'submitted', 2, 40, true);                       // never counted
    // AUTH2 — never counted for AUTH1 (older queue rows too, so a leak would also move the oldest age)
    await apps(X, s.z, 'submitted', 20, 1); await apps(Y, s.z, 'clarification_needed', 4, 50);
    flagBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'gov_console'`)).rows[0] ?? null;
    expect(flagBackup?.is_enabled).toBe(false);
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100 WHERE key = 'gov_console'`);
    app = await bootstrapE2EApp(); await app.listen(0, '127.0.0.1'); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of flagKeys('gov_console')) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    if (flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'gov_console'`, [flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_applications SET deleted_at = now() WHERE scheme_id = ANY($1::uuid[]) AND deleted_at IS NULL`, [[s.a, s.b, s.z].filter(Boolean)]).catch(() => undefined);
    await admin?.query(`UPDATE schemes SET is_active = false, deleted_at = now() WHERE id = ANY($1::uuid[])`, [[s.a, s.b, s.z].filter(Boolean)]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_authorities SET deleted_at = now() WHERE id = ANY($1::uuid[])`, [[AUTH1, AUTH2]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  it('(1) counts equal the hand count over the WHOLE set (64 > a 50-row page), across two organisations; drafts, deleted rows and AUTH2 never counted', async () => {
    await enrolAndSignIn('O');
    const before = await reads();
    const r = await request(http).get('/v1/gov/overview').set(as('O'));
    expect(r.status).toBe(200);
    const o = r.body.data;
    expect(o.window).toEqual({ kind: 'all_time', draftsCounted: false });
    expect(Math.abs(Date.now() - new Date(o.computedAt).getTime())).toBeLessThan(60_000);
    expect(o.schemes).toEqual({ count: 2 });
    const zero = { submitted: 0, under_verification: 0, clarification_needed: 0, approved: 0, rejected: 0, disbursed: 0, closed: 0, appealed: 0 };
    const byCode = Object.fromEntries(o.byScheme.map((x: { scheme: { code: string }; total: number; byStatus: unknown }) => [x.scheme.code.slice(0, 6), { total: x.total, byStatus: x.byStatus }]));
    expect(byCode).toEqual({
      gov1ba: { total: 55, byStatus: { ...zero, submitted: 30, clarification_needed: 5, appealed: 3, approved: 15, rejected: 2 } },
      gov1bb: { total: 9, byStatus: { ...zero, submitted: 6, clarification_needed: 2, disbursed: 1 } },
    });
    expect(o.totals).toEqual({ total: 64, byStatus: { ...zero, submitted: 36, clarification_needed: 7, appealed: 3, approved: 15, rejected: 2, disbursed: 1 } });
    // each queue: the count and the oldest row's whole days since its last change (9 and 20 — never AUTH2's 50)
    expect(o.queues).toEqual([{ status: 'clarification_needed', count: 7, oldestDays: 9 }, { status: 'appealed', count: 3, oldestDays: 20 }]);
    // the hand count, re-done by the database owner over the same rows
    const hand = (await admin.query(`SELECT count(*)::int AS n FROM scheme_applications a JOIN schemes sc ON sc.id = a.scheme_id
      WHERE sc.authority_id = $1 AND a.deleted_at IS NULL AND a.status <> 'draft'`, [AUTH1])).rows[0].n;
    expect(hand).toBe(o.totals.total);
    // the organisations: both contributed (the overview names neither)
    expect((await admin.query(`SELECT count(DISTINCT a.tenant_id)::int AS n FROM scheme_applications a JOIN schemes sc ON sc.id = a.scheme_id WHERE sc.authority_id = $1`, [AUTH1])).rows[0].n).toBe(2);
    // an aggregate opens no application: no recorded-read row is written
    expect(await reads()).toBe(before);
    // the page boundary: GOV-0's list stops at 50 with a next page; the overview counted all 64
    const page = await request(http).get('/v1/gov/applications?limit=50').set(as('O'));
    expect([page.status, page.body.data.length, typeof page.body.meta.nextCursor]).toEqual([200, 50, 'string']);
  });

  it('(2) no application id, applicant, form field, organisation or member in the JSON (walked); no credit and no sum — the axis cannot read credits', async () => {
    const r = await request(http).get('/v1/gov/overview').set(as('O'));
    const body = JSON.stringify(r.body);
    const appIds = (await admin.query(`SELECT id::text FROM scheme_applications WHERE scheme_id = ANY($1::uuid[])`, [[s.a, s.b, s.z]])).rows.map((x) => x.id as string);
    expect(appIds.length).toBe(93);
    for (const id of appIds) expect([id, body.includes(id)]).toEqual([id, false]);
    for (const leak of [X, Y, people.farmer.id, people.farmer.phone, people.O.id, people.O.phone, CANARY, 'secretField', 'mobileNumber', 'Gov One B FPO', 'Applicant Farmer', 'Officer O'])
      expect([leak, body.includes(leak)]).toEqual([leak, false]);
    const keys: string[] = []; const values: unknown[] = [];
    const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } else values.push(v); };
    walk(r.body.data);
    expect(keys.filter((k) => /application|applicant|organi[sz]ation|tenant|user|member|phone|form|district|percent|rate|target|amount|minor|sum|credit|dbt|rupee|inr|currency/i.test(k))).toEqual([]);
    expect(values.filter((v) => typeof v === 'string' && /%|₹/.test(v))).toEqual([]);
    // THE PREMISE, checked: kv_gov holds no grant on dbt_transfers (0239) — so no credit count is possible without a migration
    expect((await admin.query(`SELECT has_table_privilege('kv_gov', 'dbt_transfers', 'SELECT') AS p`)).rows[0].p).toBe(false);
  });

  it('(3) another authority sees only its own: AUTH2\'s officer counts 24 on one scheme, and its oldest clarification is 50 days', async () => {
    await enrolAndSignIn('Z');
    const o = (await request(http).get('/v1/gov/overview').set(as('Z'))).body.data;
    expect([o.schemes.count, o.totals.total, o.byScheme.map((x: { scheme: { id: string } }) => x.scheme.id)]).toEqual([1, 24, [s.z]]);
    expect(o.queues).toEqual([{ status: 'clarification_needed', count: 4, oldestDays: 50 }, { status: 'appealed', count: 0, oldestDays: null }]);
  });

  it('(4) a tenant token → 401 GOV_SESSION_REQUIRED; no token → 401', async () => {
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: X, roles: ['tenant_admin'], perms: ['scheme.process', 'report.view'] });
    const r = await request(http).get('/v1/gov/overview').set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': X });
    expect([r.status, r.body.error.code]).toEqual([401, 'GOV_SESSION_REQUIRED']);
    expect((await request(http).get('/v1/gov/overview')).status).toBe(401);
  });

  it('(5) LAST — gov_console OFF → 404', async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'gov_console'`);
    for (const k of flagKeys('gov_console')) await cache.del(k);
    expect((await request(http).get('/v1/gov/overview').set(as('O'))).status).toBe(404);
  });
});
