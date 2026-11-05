// apps/api/src/__tests__/partner5c-sla.integration.spec.ts · PC-56 PARTNER-5c · THE PROMISE THE PLATFORM SETS — LIVE proof (the real AppModule
// over HTTP, real Postgres + RLS; the ADMIN REALM booted from apps/admin-api's own modules on a pool that logs in as kv_admin — the PARTNER-1a
// precedent, so the promise is written by the platform's REAL writer, not by fixture SQL).
//
//   (1) the decision promise: none → `sla.decisionPromiseHours` null; the admin writer sets 24 (a reason ≥ 20 characters) → 24 on the
//       dashboard read and on `/me`; cleared (null) → null; set again for (2).
//   (2) the measured block over consented applications decided at known latencies (10 h — inside the 24 h promise; 30 h — outside):
//       decided 2, withinPromise 1, medianSec 36 000, p90Sec 108 000 exactly; NO field of the block is a rate or a percentage; a second lender
//       whose decided applications carry NO consent row reads every figure as 0 (decided 0, within 0 under its own promise, no durations).
//   (3) no partner route writes or packages the SLA: POST/PATCH /v1/partner/sla, /v1/partner/me/sla, GET /v1/partner/reports,
//       /v1/partner/reports/packs → 404; exactly ONE partner-realm audit row per dashboard read.
//   (4) founder 5c-4 (Q6, LAW 9): a repayment recorded at 00:30 IST (the process clock frozen with jest's modern fake timers, `Date` only —
//       every other timer real) is recorded with the IST calendar day as its `due_date` (not the UTC day before it), and the dashboard counts
//       it on time; and the desk's days-past-due reads (`GET /v1/fintech/servicing/collections`, `/dpd`) agree with the partner's
//       `partner_loan_dpd()` on a loan whose `next_due_date` is yesterday in IST — with the app's kv_app sessions put in a zone whose
//       calendar day DIFFERS from India's at the moment the spec runs (the condition a UTC session is in between 00:00 and 05:30 IST), so a
//       `CURRENT_DATE` regression cannot hide behind a session that happens to be IST.
import 'reflect-metadata';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const ADMIN_SECRET = 'p5c-admin-secret-p5c-admin-secret-p5c-0123';
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function adminToken(sub: string, roles: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const p = b64u({ sub, roles, amr: ['hwk'], auth_time: now, sid: randomUUID(), iss: 'krishalaya-admin', aud: 'krishalaya-admin-api', exp: now + 600 });
  return `${h}.${p}.${createHmac('sha256', ADMIN_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const REASON = 'the signed agreement of this quarter says so';
/** Only `Date` is faked: pg, supertest and Nest keep their real timers (never sleep). */
const DATE_ONLY = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;
/** A session zone whose calendar day differs from India's NOW (UTC−12 is a day behind until 17:30 IST; UTC+14 a day ahead from 15:30 IST). */
function hostileZone(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const min = Number(p.find((x) => x.type === 'hour')?.value) * 60 + Number(p.find((x) => x.type === 'minute')?.value);
  return min < 16 * 60 + 30 ? 'Etc/GMT+12' : 'Etc/GMT-14';
}

run('PC-56 PARTNER-5c · the decision promise, the measured decision time, and the lending day (integration, AppModule + the admin realm)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvAdmin: Pool; let cache: CacheService; let otp: OtpService;
  let adminApp: INestApplication; let adminHttp: any;
  const T = randomUUID(); const PA = randomUUID(); const PB = randomUUID(); const OPS = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const loan: Record<string, string> = {};
  let prodA = ''; let prodB = ''; let dbName = ''; const ZONE = hostileZone();
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp']) for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const dashboard = async (who: 'a' | 'b' = 'a') => {
    const r = await request(http).get('/v1/partner/dashboard').set(bearer(tok[who]));
    expect(r.status).toBe(200);
    return r.body.data;
  };
  const setSla = (partner: string, decisionHours: number | null) => request(adminHttp).post(`/v1/partners/${partner}/sla`)
    .set(bearer(adminToken(OPS, ['platform_partners_ops']))).send({ decisionHours, reason: REASON });
  /** A consented (or not) application on `product`, decided `latencyHours` after it was submitted, one day ago. */
  const decided = (product: string, partner: string | null, latencyHours: number) => admin.query(
    `WITH a AS (INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, status, decision_at, amount_approved_minor, created_at, created_by)
                VALUES ($1, $2, $3, 5000000, 'approved', now() - interval '1 day', 5000000, now() - interval '1 day' - make_interval(hours => $4::int), $2) RETURNING id)
     INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at)
     SELECT $2, $5::uuid, a.id::text, now() + interval '30 days' FROM a WHERE $5::uuid IS NOT NULL`,
    [T, people.applicant.id, product, latencyHours, partner]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    dbName = (await admin.query(`SELECT current_database() AS d`)).rows[0].d;
    for (const k of ['fintech', 'partner_console']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await admin.query(`ALTER ROLE kv_admin WITH LOGIN PASSWORD 'dev'`);
    const asRole = (role: string) => { const u = new URL(APP_URL as string); u.username = role; u.password = 'dev'; return u.toString(); };
    kvAdmin = new Pool({ connectionString: asRole('kv_admin'), max: 2 });

    await makeTenant(admin, T, 'Fixture Promise Collective');
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    for (const [id, code, name] of [[PA, `p5ca_${sfx}`, 'Fixture Promise Lender'], [PB, `p5cb_${sfx}`, 'Fixture Unconsented Lender']]) {
      await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, sla) VALUES ($1, $2, $3, 'bank', '{"note": "kept"}'::jsonb)`, [id, code, name]);
    }
    const product = async (p: string, n: string) => (await admin.query(`INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
      VALUES ($1, $2, $3, 100000, 50000000, 1100, 'harvest_aligned') RETURNING id`, [p, kind, n])).rows[0].id as string;
    prodA = await product(PA, 'Promise crop loan'); prodB = await product(PB, 'Unconsented crop loan');
    for (const [k, n] of [['applicant', 'Promise applicant'], ['aAdmin', 'Promise lender admin'], ['bAdmin', 'Unconsented lender admin'],
      ['borrower', 'Promise borrower'], ['banker', 'Promise desk']] as const) await user(k, n);
    for (const [k, p] of [['aAdmin', PA], ['bAdmin', PB]] as const) {
      await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people[k].id, p]);
    }
    for (const [k, role] of [['borrower', 'farmer'], ['banker', 'banker']] as const) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [people[k].id, T, role]);
    }
    // (2) A: two CONSENTED decisions, 10 h and 30 h; B: two decisions with NO consent row
    await decided(prodA, PA, 10); await decided(prodA, PA, 30);
    await decided(prodB, null, 5); await decided(prodB, null, 50);
    // (4) A's book: L1 active (repaid below), L2 active with next_due_date = yesterday in IST (the DPD agreement)
    const mkLoan = async (key: string, nextDue: 'ist_yesterday' | null) => {
      const appId = (await admin.query(`INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status)
        VALUES ($1, $2, $3, 2000000, 2000000, 'disbursed') RETURNING id`, [T, people.borrower.id, prodA])).rows[0].id;
      loan[key] = (await admin.query(`INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor, next_due_date)
        VALUES ($1, $2, $3, $4, 2000000, 1100, (now() AT TIME ZONE 'Asia/Kolkata')::date - 30, 'active', 2000000,
                CASE WHEN $5::text = 'ist_yesterday' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 END) RETURNING id`, [appId, T, people.borrower.id, PA, nextDue])).rows[0].id;
    };
    await mkLoan('l1', null); await mkLoan('l2', 'ist_yesterday');

    // the app's kv_app sessions in a zone whose calendar day is NOT India's right now (reset in afterAll)
    await admin.query(`ALTER ROLE kv_app IN DATABASE ${dbName} SET timezone TO '${ZONE}'`);
    await setFlag('partner_console', true); await setFlag('fintech', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('fintech')]) await cache.del(k);
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    await uow.run(T, (tx) => wallet.post(tx, { tenantId: T, txnType: 'order_payment', idempotencyKey: `p5c-fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: userMain(people.borrower.id), amountMinor: 5_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -5_000_000n }] }), { userId: 'system' });
    await resetRates();
    for (const [w, k] of [['a', 'aAdmin'], ['b', 'bAdmin']] as const) {
      const { code } = await otp.issue(people[k].phone);
      const s = await request(http).post('/v1/partner/auth/verify').send({ phone: people[k].phone, code });
      expect(s.status).toBe(201); tok[w] = s.body.data.accessToken;
    }
    tok.banker = mintToken(app, { userId: people.banker.id, tenantId: T, roles: ['banker'], perms: ['loan.manage'] });

    const keep = { url: process.env.DATABASE_ADMIN_URL, secret: process.env.ADMIN_JWT_SECRET, reg: process.env.ADMIN_OPERATOR_REGISTRY_ENABLED, hwk: process.env.ADMIN_REQUIRE_HARDWARE_KEY };
    process.env.DATABASE_ADMIN_URL = asRole('kv_admin'); process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.ADMIN_OPERATOR_REGISTRY_ENABLED = 'false'; process.env.ADMIN_REQUIRE_HARDWARE_KEY = 'true';
    try {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { Module } = require('@nestjs/common'); const { NestFactory } = require('@nestjs/core'); const { VersioningType } = require('@nestjs/common');
      const { AdminCoreModule } = require('../../../admin-api/src/core/admin-core.module');
      const { PartnerOpsModule } = require('../../../admin-api/src/modules/partner-ops/partner-ops.module');
      /* eslint-enable @typescript-eslint/no-var-requires */
      class P5cAdminRealm {}
      Module({ imports: [AdminCoreModule, PartnerOpsModule] })(P5cAdminRealm);
      adminApp = await NestFactory.create(P5cAdminRealm, { logger: false });
      adminApp.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await adminApp.init(); adminHttp = adminApp.getHttpServer();
    } finally {
      process.env.DATABASE_ADMIN_URL = keep.url;
      for (const [k, v] of [['ADMIN_JWT_SECRET', keep.secret], ['ADMIN_OPERATOR_REGISTRY_ENABLED', keep.reg], ['ADMIN_REQUIRE_HARDWARE_KEY', keep.hwk]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }, 240_000);

  afterAll(async () => {
    jest.useRealTimers();
    if (dbName) await admin?.query(`ALTER ROLE kv_app IN DATABASE ${dbName} RESET timezone`).catch(() => undefined);
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
      if (cache) for (const x of flagKeys(k)) await cache.del(x).catch(() => undefined);
    }
    await Promise.race([adminApp?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvAdmin?.end(); await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the promise: none → null; the platform\'s writer sets 24 → 24 (dashboard and /me), other keys kept; cleared → null', async () => {
    expect((await dashboard()).sla.decisionPromiseHours).toBeNull();
    const set = await setSla(PA, 24);
    expect(set.status).toBe(201); expect(set.body.data).toMatchObject({ id: PA, slaDecisionHours: 24, previous: null });
    expect((await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla).toEqual({ note: 'kept', decision_hours: 24 });
    expect((await dashboard()).sla.decisionPromiseHours).toBe(24);
    expect((await request(http).get('/v1/partner/me').set(bearer(tok.a))).body.data.organisation.slaDecisionHours).toBe(24);
    const clear = await setSla(PA, null);
    expect(clear.status).toBe(201); expect(clear.body.data).toMatchObject({ slaDecisionHours: null, previous: 24 });
    expect((await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla).toEqual({ note: 'kept' });
    const d = await dashboard();
    expect(d.sla.decisionPromiseHours).toBeNull(); expect(d.sla.withinPromise).toBeNull();
    expect((await request(http).get('/v1/partner/me').set(bearer(tok.a))).body.data.organisation.slaDecisionHours).toBeNull();
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'partners.sla_set' AND entity_id = $1`, [PA])).rows[0].n).toBe(2);
    expect((await setSla(PA, 24)).status).toBe(201);   // for (2)
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) the measured block is exact, carries no rate or percentage, and reads 0 for a lender whose applications carry no consent', async () => {
    const { sla } = await dashboard();
    expect(sla).toEqual({ decisionPromiseHours: 24, windowDays: 30, decided: 2, medianSec: 10 * 3600, p90Sec: 30 * 3600, withinPromise: 1 });
    expect(JSON.stringify(sla)).not.toMatch(/%|percent|rate|ratio|share/i);
    for (const v of Object.values(sla)) expect(v === null || Number.isInteger(v)).toBe(true);
    // B: two decided applications, no consent row — and a promise of its own, so "within" is a 0, not a null
    expect((await setSla(PB, 48)).status).toBe(201);
    const b = (await dashboard('b')).sla;
    expect(b).toEqual({ decisionPromiseHours: 48, windowDays: 30, decided: 0, medianSec: null, p90Sec: null, withinPromise: 0 });
    expect(JSON.stringify(b)).not.toMatch(/%|percent|rate|ratio|share/i);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) no partner route writes or packages the SLA (404); ONE partner-realm audit row per dashboard read', async () => {
    const before = (await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla;
    for (const [name, fire] of [
      ['POST /partner/sla', () => request(http).post('/v1/partner/sla').set(bearer(tok.a)).send({ decisionHours: 1 })],
      ['PATCH /partner/sla', () => request(http).patch('/v1/partner/sla').set(bearer(tok.a)).send({ decisionHours: 1 })],
      ['POST /partner/me/sla', () => request(http).post('/v1/partner/me/sla').set(bearer(tok.a)).send({ decisionHours: 1 })],
      ['PATCH /partner/me/sla', () => request(http).patch('/v1/partner/me/sla').set(bearer(tok.a)).send({ decisionHours: 1 })],
      ['GET /partner/reports', () => request(http).get('/v1/partner/reports').set(bearer(tok.a))],
      ['GET /partner/reports/packs', () => request(http).get('/v1/partner/reports/packs').set(bearer(tok.a))],
    ] as const) expect([name, (await fire()).status]).toEqual([name, 404]);
    expect((await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla).toEqual(before);
    const n = async () => (await admin.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'partner.dashboard.read' AND entity_id = $1`, [PA])).rows[0].n as number;
    const n0 = await n();
    await dashboard();
    expect(await n()).toBe(n0 + 1);
    await dashboard(); await dashboard();
    expect(await n()).toBe(n0 + 3);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) Q6 · a repayment at 00:30 IST is recorded on the IST day and counted on time; the desk\'s and the partner\'s days past due agree', async () => {
    const istYesterday = (await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text AS d`)).rows[0].d as string;
    const at = new Date(`${istYesterday}T00:30:00+05:30`);
    expect(at.toISOString().slice(0, 10)).not.toBe(istYesterday);   // the UTC day is the day BEFORE — the old write
    let status = 0;
    jest.useFakeTimers({ doNotFake: [...DATE_ONLY], now: at });
    try {
      expect(new Date().getTime()).toBe(at.getTime());
      const t = mintToken(app, { userId: people.borrower.id, tenantId: T, roles: ['farmer'], perms: ['loan.borrow'] });
      const r = await request(http).post(`/v1/fintech/loans/${loan.l1}/repay`).set({ ...bearer(t), 'x-tenant-id': T }).set('idempotency-key', randomUUID()).send({ amountMinor: '100000' });
      status = r.status;
      expect([r.status, r.body?.error ?? null]).toEqual([201, null]);
    } finally { jest.useRealTimers(); }
    expect(status).toBe(201);
    const rep = (await admin.query(`SELECT due_date::text AS due, (paid_at AT TIME ZONE 'Asia/Kolkata')::date::text AS paid_ist, (paid_at AT TIME ZONE 'UTC')::date::text AS paid_utc
      FROM loan_repayments WHERE loan_id = $1`, [loan.l1])).rows;
    expect(rep).toHaveLength(1);
    expect(rep[0].due).toBe(istYesterday);
    expect(rep[0].paid_ist).toBe(istYesterday);
    expect(rep[0].paid_utc).not.toBe(istYesterday);
    expect((await admin.query(`SELECT outstanding_minor::text o FROM loans WHERE id = $1`, [loan.l1])).rows[0].o).toBe('1900000');   // the amount, unchanged behaviour
    expect((await dashboard()).onTime).toMatchObject({ due: 1, onTime: 1 });

    // the hostile session zone is in force on a fresh kv_app login, and its calendar day is not India's
    const probe = new Pool({ connectionString: APP_URL, max: 1 });
    try {
      const z = (await probe.query(`SELECT current_setting('TimeZone') AS z, CURRENT_DATE <> (now() AT TIME ZONE 'Asia/Kolkata')::date AS differs`)).rows[0];
      expect(z).toEqual({ z: ZONE, differs: true });
    } finally { await probe.end(); }
    const coll = await request(http).get('/v1/fintech/servicing/collections').set({ ...bearer(tok.banker), 'x-tenant-id': T });
    expect(coll.status).toBe(200);
    const rows = (coll.body.data as Array<{ loanId: string; dpd: number }>);
    expect(rows.map((x) => [x.loanId, x.dpd])).toEqual([[loan.l2, 1]]);
    const dpd = await request(http).get('/v1/fintech/servicing/dpd').set({ ...bearer(tok.banker), 'x-tenant-id': T });
    expect(dpd.status).toBe(200);
    expect(dpd.body.data).toEqual([{ bucket: '1-30', loans: 1, outstandingMinor: '2000000' }]);
    const p = await request(http).get('/v1/partner/loans/dpd').set(bearer(tok.a));
    expect(p.status).toBe(200);
    expect(p.body.data.buckets['1-30']).toEqual({ count: 1, outstandingMinor: '2000000' });
    expect(p.body.data.buckets.no_due_date).toEqual({ count: 1, outstandingMinor: '1900000' });
  }, 120_000);
});
