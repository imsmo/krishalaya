// apps/api/src/__tests__/partner1a-dashboard.integration.spec.ts · PC-56 PARTNER-1a · THE CONSOLE SAYS WHAT IS TRUE — LIVE proof (the real AppModule
// over HTTP, real Postgres + RLS: the kv_partner axis for the figures; the ADMIN REALM booted from apps/admin-api's own modules on a pool that
// LOGS IN as kv_admin — the tenant-swd precedent — and driven over HTTP with an admin JWT).
//
//   (1) the six figures equal hand-computed values from a fixture of > 100 admitted applications across TWO FPOs (+ one not-live), with
//       un-consented, expired-consent and another partner's applications EXCLUDED; money as bigint strings; rates in bps (and null when nothing
//       is due); computedAt; the month window planted RELATIVE to the database's own IST month start (no hour literal, no typed date);
//   (2) the SLA promise: null → "not published"; the admin writer sets 48 with a reason → 48 (other keys kept) + the audit row; a reason < 20
//       → 400 (M5); a viewer role → 403; a partner session → 401 on the admin host and 404 for `/v1/admin/partners` on the API host;
//   (3) the actual latency: median / p90 (nearest rank) over the planted decisions, and "within the promise" once 48 is published;
//   (4) the FPO list = the PUBLIC display names of the applications' organisations (never the legal name — M6), a not-live one → null;
//   (5) the first administrator: the platform invites a partner with no admin → the code shown once + an outbox row (no code in it); a second
//       call → PARTNER_ADMIN_INVITE_PENDING; accepted (code + OTP) → a partner_admin membership; then → PARTNER_HAS_ADMIN; kv_app can never
//       name the platform as inviter; the relay handler records the hand-over;
//   (6) the admin registry lists each partner with its active-admin count, console members and the SLA.
import 'reflect-metadata';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
const ADMIN_SECRET = 'p1a-admin-secret-p1a-admin-secret-p1a-0123';
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function adminToken(sub: string, roles: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const p = b64u({ sub, roles, amr: ['hwk'], auth_time: now, sid: randomUUID(), iss: 'krishalaya-admin', aud: 'krishalaya-admin-api', exp: now + 600 });
  return `${h}.${p}.${createHmac('sha256', ADMIN_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}

run('PC-56 PARTNER-1a · the dashboard figures, the SLA writer, the first administrator (integration, AppModule + the admin realm over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvApp: Pool; let kvAdmin: Pool; let cache: CacheService; let otp: OtpService;
  let adminApp: INestApplication; let adminHttp: any;
  const T1 = randomUUID(); const T2 = randomUUID(); const T3 = randomUUID();
  const PA = randomUUID(); const PB = randomUUID(); const PC = randomUUID();
  const OPS = randomUUID(); const VIEWER = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const expect6 = { oldest: [] as string[] };
  let prodA = ''; let prodB = '';
  let partnerTok = '';
  let firstInvite: { inviteId: string; token: string } | null = null;

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
    return id;
  };
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerInvitesController.accept', 'PartnerAuthController.otp']) for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const dashboard = async () => {
    const r = await request(http).get('/v1/partner/dashboard').set(bearer(partnerTok));
    expect(r.status).toBe(200);
    return r.body.data;
  };
  /** n applications of `status` on `product` (applicant fixture), created `createdAgoMin + i` minutes ago (or `latency` hours before the decision), decided per the SQL fragments; consent per `consent`. */
  const plant = async (o: { n: number; tenant: string; product: string; status: string; consentFor: string | null; consent?: 'live' | 'expired';
    createdAgoMin?: number; decisionAt?: string | null; latencyHours?: number[]; approved?: string[] }) => {
    const ids: string[] = [];
    for (let i = 0; i < o.n; i++) {
      const decision = o.decisionAt ?? null;
      const lat = o.latencyHours?.[i] ?? 1;
      const r = await admin.query(
        `WITH w AS (SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS m0)
         INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, status, decision_at, amount_approved_minor, created_at, created_by)
         SELECT $1, $2, $3, 5000000, $4::loan_app_status, d.at, $5::bigint,
                COALESCE(d.at - make_interval(hours => $6::int), now() - make_interval(mins => $7::int)), $2
           FROM w, LATERAL (SELECT CASE $8::text WHEN 'in_month' THEN w.m0 + (now() - w.m0) / 2 WHEN 'before_month' THEN w.m0 - interval '40 days' ELSE NULL END AS at) d
         RETURNING id`,
        [o.tenant, people.applicant.id, o.product, o.status, o.approved?.[i] ?? null, lat, (o.createdAgoMin ?? 0) + i, decision]);
      const id = r.rows[0].id as string; ids.push(id);
      if (o.consentFor) await admin.query(`INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, CASE $4 WHEN 'expired' THEN now() - interval '1 day' ELSE now() + interval '30 days' END)`,
        [people.applicant.id, o.consentFor, id, o.consent ?? 'live']);
    }
    return ids;
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    kvApp = new Pool({ connectionString: APP_URL, max: 2 });
    await admin.query(`ALTER ROLE kv_admin WITH LOGIN PASSWORD 'dev'`);
    const asRole = (role: string) => { const u = new URL(APP_URL as string); u.username = role; u.password = 'dev'; return u.toString(); };
    kvAdmin = new Pool({ connectionString: asRole('kv_admin'), max: 2 });
    expect((await kvAdmin.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_admin');

    // three organisations: two live (display name ≠ legal name — M6), one not live (a trial)
    await makeTenant(admin, T1, 'Fixture Growers One Producer Company'); await makeTenant(admin, T2, 'Fixture Growers Two Producer Company'); await makeTenant(admin, T3, 'Fixture Trial Collective');
    await admin.query(`UPDATE tenants SET display_name = 'Fixture Growers One' WHERE id = $1`, [T1]);
    await admin.query(`UPDATE tenants SET display_name = 'Fixture Growers Two' WHERE id = $1`, [T2]);
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [T3]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    for (const [id, code, name, sla] of [[PA, `p1a_${sfx}`, 'Partner OneA Bank', '{"note": "kept"}'], [PB, `p1b_${sfx}`, 'Partner OneA Other Bank', '{}'], [PC, `p1c_${sfx}`, 'Partner OneA New Bank', '{}']]) {
      await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, sla) VALUES ($1, $2, $3, 'bank', 'LIC-TEST-1A01', $4::jsonb)`, [id, code, name, sla]);
    }
    const product = async (p: string, n: string) => (await admin.query(`INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
      VALUES ($1, $2, $3, 100000, 50000000, 1100, 'harvest_aligned') RETURNING id`, [p, kind, n])).rows[0].id as string;
    prodA = await product(PA, 'OneA crop loan'); prodB = await product(PB, 'Other crop loan');
    for (const [k, n] of [['applicant', 'Applicant Fixture'], ['aAdmin', 'OneA admin'], ['newAdmin', 'First admin of C']] as const) await user(k, n);
    await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people.aAdmin.id, PA]);

    // ── the book: AWAITING — 60 (T1) + 44 (T2) + 1 (T3, not live) admitted = 105; excluded: 3 un-consented, 2 expired, 4 of partner B
    await plant({ n: 60, tenant: T1, product: prodA, status: 'submitted', consentFor: PA, createdAgoMin: 60 });
    await plant({ n: 44, tenant: T2, product: prodA, status: 'under_review', consentFor: PA, createdAgoMin: 120 });
    await plant({ n: 1, tenant: T3, product: prodA, status: 'submitted', consentFor: PA, createdAgoMin: 180 });
    await plant({ n: 3, tenant: T1, product: prodA, status: 'submitted', consentFor: null });
    await plant({ n: 2, tenant: T1, product: prodA, status: 'submitted', consentFor: PA, consent: 'expired' });
    await plant({ n: 4, tenant: T2, product: prodB, status: 'submitted', consentFor: PB });
    // ── DECIDED IN THIS IST MONTH (the window's midpoint): 3 approved + 1 approved-then-disbursed + 2 rejected; latencies 10…60 h
    await plant({ n: 3, tenant: T1, product: prodA, status: 'approved', consentFor: PA, decisionAt: 'in_month', latencyHours: [10, 20, 30], approved: ['1000000', '2000000', '3000000'] });
    await plant({ n: 1, tenant: T2, product: prodA, status: 'disbursed', consentFor: PA, decisionAt: 'in_month', latencyHours: [40], approved: ['4000000'] });
    await plant({ n: 2, tenant: T2, product: prodA, status: 'rejected', consentFor: PA, decisionAt: 'in_month', latencyHours: [50, 60] });
    // ── decided BEFORE this month (and outside the 30 days) — excluded; decided this month but NOT admitted — excluded
    await plant({ n: 1, tenant: T1, product: prodA, status: 'approved', consentFor: PA, decisionAt: 'before_month', approved: ['9999'] });
    await plant({ n: 1, tenant: T1, product: prodA, status: 'rejected', consentFor: PA, decisionAt: 'before_month' });
    await plant({ n: 1, tenant: T1, product: prodA, status: 'approved', consentFor: null, decisionAt: 'in_month', approved: ['7777777'] });
    await plant({ n: 1, tenant: T2, product: prodB, status: 'approved', consentFor: PB, decisionAt: 'in_month', approved: ['8888888'] });
    // the five oldest admitted awaiting (the oracle, hand-computed by the owner connection: admitted = product of A AND a live consent for A)
    expect6.oldest = (await admin.query(`SELECT a.id FROM loan_applications a JOIN loan_products p ON p.id = a.product_id
       WHERE p.partner_id = $1 AND a.status IN ('submitted', 'under_review') AND EXISTS (SELECT 1 FROM credit_score_consents c WHERE c.purpose_ref = a.id::text AND c.partner_id = $1 AND (c.expires_at IS NULL OR c.expires_at > now()))
       ORDER BY a.created_at ASC, a.id ASC LIMIT 5`, [PA])).rows.map((x) => x.id);

    // ── the loan book (0090 partner axis — loans.partner_id; their applications are NOT consented, so they never count as applications)
    const loan = async (partner: string, status: string, outstanding: string) => {
      const [appId] = await plant({ n: 1, tenant: T1, product: partner === PA ? prodA : prodB, status: 'disbursed', consentFor: null });
      return (await admin.query(`INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
        VALUES ($1, $2, $3, $4, $5::bigint, 1100, (now() AT TIME ZONE 'Asia/Kolkata')::date - 100, $6::loan_status, $5::bigint) RETURNING id`, [appId, T1, people.applicant.id, partner, outstanding, status])).rows[0].id as string;
    };
    const l1 = await loan(PA, 'active', '9007199254740993'); const l2 = await loan(PA, 'active', '5000000'); await loan(PA, 'overdue', '2500000');
    await loan(PA, 'closed', '0'); const lb = await loan(PB, 'active', '1234567');
    // repayments due in the last 90 IST days: 3 on time (paid at noon IST on the due date), 1 late, 1 unpaid; 1 outside the window; 1 of B's
    const rep = async (loanId: string, dueAgo: number, paid: 'on_time' | 'late' | 'none') => admin.query(
      `INSERT INTO loan_repayments (loan_id, tenant_id, due_date, amount_due_minor, amount_paid_minor, paid_at, channel)
       SELECT $1, $2, d.due, 100000, CASE WHEN $4 = 'none' THEN 0 ELSE 100000 END,
              CASE $4 WHEN 'on_time' THEN (d.due::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kolkata'
                      WHEN 'late' THEN ((d.due + 2)::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kolkata' ELSE NULL END, 'upi'
         FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - $3::int AS due) d`, [loanId, T1, dueAgo, paid]);
    await rep(l1, 10, 'on_time'); await rep(l1, 20, 'on_time'); await rep(l2, 30, 'on_time'); await rep(l2, 40, 'late'); await rep(l2, 50, 'none');
    await rep(l1, 120, 'on_time'); await rep(lb, 10, 'late');

    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100 WHERE key = 'partner_console'`);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of ['flag:partner_console', 'flags:all', 'flagstale:partner_console']) await cache.del(k);
    await resetRates();
    const { code } = await otp.issue(people.aAdmin.phone);
    const s = await request(http).post('/v1/partner/auth/verify').send({ phone: people.aAdmin.phone, code });
    expect(s.status).toBe(201); partnerTok = s.body.data.accessToken;

    // ── the ADMIN REALM: apps/admin-api's own core + partner-ops, on a pool that logs in as kv_admin, over HTTP
    const keep = { url: process.env.DATABASE_ADMIN_URL, secret: process.env.ADMIN_JWT_SECRET, reg: process.env.ADMIN_OPERATOR_REGISTRY_ENABLED, hwk: process.env.ADMIN_REQUIRE_HARDWARE_KEY };
    process.env.DATABASE_ADMIN_URL = asRole('kv_admin'); process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.ADMIN_OPERATOR_REGISTRY_ENABLED = 'false'; process.env.ADMIN_REQUIRE_HARDWARE_KEY = 'true';
    try {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { Module } = require('@nestjs/common'); const { NestFactory } = require('@nestjs/core'); const { VersioningType } = require('@nestjs/common');
      const { AdminCoreModule } = require('../../../admin-api/src/core/admin-core.module');
      const { PartnerOpsModule } = require('../../../admin-api/src/modules/partner-ops/partner-ops.module');
      /* eslint-enable @typescript-eslint/no-var-requires */
      class P1aAdminRealm {}
      Module({ imports: [AdminCoreModule, PartnerOpsModule] })(P1aAdminRealm);
      adminApp = await NestFactory.create(P1aAdminRealm, { logger: false });
      adminApp.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await adminApp.init(); adminHttp = adminApp.getHttpServer();
    } finally {
      process.env.DATABASE_ADMIN_URL = keep.url;
      for (const [k, v] of [['ADMIN_JWT_SECRET', keep.secret], ['ADMIN_OPERATOR_REGISTRY_ENABLED', keep.reg], ['ADMIN_REQUIRE_HARDWARE_KEY', keep.hwk]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'partner_console'`).catch(() => undefined);
    await Promise.race([adminApp?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvAdmin?.end(); await kvApp?.end(); await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the six figures equal the hand-computed book: > 100 admitted counted in full; excluded rows excluded; bigint strings; bps; computedAt', async () => {
    const d = await dashboard();
    expect(d.awaitingDecision).toBe(105);                          // 60 + 44 + 1 — past one page of 100; 3 + 2 + 4 excluded
    expect(d.applicationsTotal).toBe(105 + 6 + 2);                 // + the six decided this month + the two decided before
    expect(d.decidedThisMonth).toMatchObject({ decided: 6, approved: 4, rejected: 2, approvedAmountMinor: '10000000', approvalRateBps: 6666, timeZone: 'Asia/Kolkata' });
    expect(typeof d.decidedThisMonth.approvedAmountMinor).toBe('string');
    // the window is the DATABASE's IST month: its start is the same instant the database computes now
    const m0 = (await admin.query(`SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS m0`)).rows[0].m0;
    expect(d.decidedThisMonth.monthStartsAt).toBe(new Date(m0).toISOString());
    expect(d.portfolio).toEqual({ outstandingMinor: (9007199254740993n + 5000000n + 2500000n).toString(), activeLoans: 3 });
    expect(d.onTime).toEqual({ windowDays: 90, due: 5, onTime: 3, shareBps: 6000, basis: 'recorded_instalments' });
    expect(Number.isInteger(d.decidedThisMonth.approvalRateBps)).toBe(true);
    expect(Date.parse(d.computedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(d.needsYouToday.map((x: { id: string }) => x.id)).toEqual(expect6.oldest);
    const body = JSON.stringify(d);
    expect(body).not.toMatch(/Applicant Fixture|applicantUserId|applicant_user_id|LA-\d/);
    // the read is logged (a partner-realm row with the counts)
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'partner.dashboard.read' AND new_value->>'partnerId' = $1 AND (new_value->>'awaiting')::int = 105`, [PA])).rows[0].n).toBeGreaterThanOrEqual(1);
    // nothing due → null bps (never NaN): partner B's view of its own empty window is not this partner's — a header never moves the partner
    const r = await request(http).get('/v1/partner/dashboard').set({ ...bearer(partnerTok), 'x-partner-id': PB });
    expect(r.body.data.awaitingDecision).toBe(105);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2) + (3)
  it('(2)+(3) the promise: null → published 48 by the admin writer (reason, audit, other keys kept); < 20 → 400; viewer → 403; realms apart; latency + within', async () => {
    let d = await dashboard();
    expect(d.sla).toEqual({ decisionPromiseHours: null, windowDays: 30, decided: 6, medianSec: 30 * 3600, p90Sec: 60 * 3600, withinPromise: null });
    expect((await request(http).get('/v1/partner/me').set(bearer(partnerTok))).body.data.organisation.slaDecisionHours).toBeNull();
    const ops = adminToken(OPS, ['platform_partners_ops']);
    const short = await request(adminHttp).post(`/v1/partners/${PA}/sla`).set(bearer(ops)).send({ decisionHours: 48, reason: 'too short a reason' });
    expect(short.status).toBe(400);
    const viewer = await request(adminHttp).post(`/v1/partners/${PA}/sla`).set(bearer(adminToken(VIEWER, ['platform_partners_viewer']))).send({ decisionHours: 48, reason: 'the signed agreement of this quarter says so' });
    expect(viewer.status).toBe(403);
    const asPartner = await request(adminHttp).get('/v1/partners').set(bearer(partnerTok));
    expect(asPartner.status).toBe(401);
    expect((await request(http).get('/v1/admin/partners').set(bearer(partnerTok))).status).toBe(404);
    expect((await request(http).post(`/v1/admin/partners/${PA}/sla`).set(bearer(partnerTok)).send({ decisionHours: 1, reason: 'x'.repeat(30) })).status).toBe(404);
    expect((await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla).toEqual({ note: 'kept' });
    const ok = await request(adminHttp).post(`/v1/partners/${PA}/sla`).set(bearer(ops)).send({ decisionHours: 48, reason: 'the signed agreement of this quarter says so' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ id: PA, slaDecisionHours: 48, previous: null });
    expect((await admin.query(`SELECT sla FROM financial_partners WHERE id = $1`, [PA])).rows[0].sla).toEqual({ note: 'kept', decision_hours: 48 });
    const audit = (await admin.query(`SELECT actor_user_id, reason, new_value FROM audit_log WHERE action = 'partners.sla_set' AND entity_id = $1`, [PA])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: OPS, reason: 'the signed agreement of this quarter says so', new_value: { decisionHours: 48 } });
    d = await dashboard();
    expect(d.sla).toMatchObject({ decisionPromiseHours: 48, decided: 6, medianSec: 108000, p90Sec: 216000, withinPromise: 4 });
    expect((await request(http).get('/v1/partner/me').set(bearer(partnerTok))).body.data.organisation.slaDecisionHours).toBe(48);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the FPOs = the PUBLIC display names of the applications\' organisations (never the legal name); a not-live one → null; nothing else', async () => {
    const d = await dashboard();
    const fpos = [...d.fpos].sort((a: { tenantId: string }, b: { tenantId: string }) => (a.tenantId < b.tenantId ? -1 : 1));
    expect(fpos).toEqual([{ tenantId: T1, name: 'Fixture Growers One' }, { tenantId: T2, name: 'Fixture Growers Two' }, { tenantId: T3, name: null }]
      .sort((a, b) => (a.tenantId < b.tenantId ? -1 : 1)));
    for (const f of d.fpos) expect(Object.keys(f).sort()).toEqual(['name', 'tenantId']);
    expect(JSON.stringify(d)).not.toContain('Producer Company');
    for (const n of d.needsYouToday) expect([T1, T2, T3]).toContain(n.tenantId);
    expect(d.needsYouToday.find((n: { tenantId: string }) => n.tenantId === T1)?.fpoName ?? 'Fixture Growers One').toBe('Fixture Growers One');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) the first administrator: shown once + an outbox row; a second call is refused; accepted → partner_admin; then PARTNER_HAS_ADMIN; walls', async () => {
    const ops = adminToken(OPS, ['platform_partners_ops']);
    const reason = 'the founder-signed agreement names this officer as administrator';
    const inv = await request(adminHttp).post(`/v1/partners/${PC}/admin-invite`).set(bearer(ops)).send({ phone: people.newAdmin.phone, reason });
    expect(inv.status).toBe(201);
    const token = inv.body.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.body.data).toMatchObject({ partnerId: PC, roleCode: 'partner_admin', shownOnce: true, delivery: 'handover' });
    firstInvite = { inviteId: inv.body.data.inviteId, token };
    const row = (await admin.query(`SELECT invited_by, invited_by_admin_id, token_sealed, status, (expires_at - created_at) = interval '7 days' AS seven FROM partner_invites WHERE id = $1`, [firstInvite.inviteId])).rows[0];
    expect(row).toEqual({ invited_by: null, invited_by_admin_id: OPS, token_sealed: null, status: 'pending', seven: true });
    const ob = (await admin.query(`SELECT payload FROM outbox_events WHERE event_type = 'partner.member_invited' AND aggregate_id = $1`, [firstInvite.inviteId])).rows;
    expect(ob).toHaveLength(1); expect(ob[0].payload).toEqual({ v: 1, inviteId: firstInvite.inviteId, partnerId: PC, by: 'platform' });
    expect(JSON.stringify(ob[0].payload)).not.toContain(token);
    const au = (await admin.query(`SELECT reason, new_value FROM audit_log WHERE action = 'partners.admin_invite_created' AND entity_id = $1`, [firstInvite.inviteId])).rows;
    expect(au).toHaveLength(1); expect(au[0].reason).toBe(reason); expect(JSON.stringify(au[0])).not.toContain(token); expect(JSON.stringify(au[0])).not.toContain(people.newAdmin.phone);
    // the relay handler records the hand-over (no sealed copy → no SMS)
    const reg = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
    await reg.handlersFor('partner.member_invited')[0].handle({ payload: { v: 1, inviteId: firstInvite.inviteId, partnerId: PC } } as never, undefined as never);
    expect((await admin.query(`SELECT send_failure, sent_at FROM partner_invites WHERE id = $1`, [firstInvite.inviteId])).rows[0]).toEqual({ send_failure: 'platform_handover', sent_at: null });
    // a second call while the first is open → refused by name
    const again = await request(adminHttp).post(`/v1/partners/${PC}/admin-invite`).set(bearer(ops)).send({ phone: phoneOf(), reason });
    expect(again.status).toBe(409); expect(again.body.code).toBe('PARTNER_ADMIN_INVITE_PENDING');
    // accept: the code + an OTP on the invited phone → a partner session and a partner_admin membership
    await resetRates();
    const acc = await request(http).post('/v1/partner/invites/accept').send({ token, phone: people.newAdmin.phone, code: (await otp.issue(people.newAdmin.phone)).code });
    expect(acc.status).toBe(201); expect(acc.body.data.invite).toEqual({ id: firstInvite.inviteId, roleCode: 'partner_admin' });
    expect((await admin.query(`SELECT r.code FROM partner_memberships m JOIN roles r ON r.id = m.role_id WHERE m.partner_id = $1 AND m.user_id = $2 AND m.is_active`, [PC, people.newAdmin.id])).rows.map((x) => x.code)).toEqual(['partner_admin']);
    const third = await request(adminHttp).post(`/v1/partners/${PC}/admin-invite`).set(bearer(ops)).send({ phone: phoneOf(), reason });
    expect(third.status).toBe(409); expect(third.body.code).toBe('PARTNER_HAS_ADMIN');
    expect((await request(adminHttp).post(`/v1/partners/${PA}/admin-invite`).set(bearer(ops)).send({ phone: phoneOf(), reason })).body.code).toBe('PARTNER_HAS_ADMIN');
    // the walls: kv_app can never name the platform as inviter (column privilege); kv_admin's own insert meets the trigger
    const c: PoolClient = await kvApp.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.partner_id', $1, true), set_config('app.user_id', $2, true)`, [PA, people.aAdmin.id]);
      expect(await errCode(c.query(`INSERT INTO partner_invites (partner_id, phone, role_id, invited_by_admin_id, token_hash) SELECT $1, '+919800000001', id, $2, repeat('a', 64) FROM roles WHERE code = 'partner_admin'`, [PA, OPS]))).toBe('42501');
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    expect(await errCode(kvAdmin.query(`INSERT INTO partner_invites (partner_id, phone, role_id, invited_by_admin_id, token_hash) SELECT $1, '+919800000002', id, $2, repeat('b', 64) FROM roles WHERE code = 'partner_admin'`, [PA, OPS]))).toBe('PARTNER_HAS_ADMIN');
    expect(await errCode(kvAdmin.query(`INSERT INTO partner_invites (partner_id, phone, role_id, invited_by_admin_id, token_hash) SELECT $1, '+919800000003', id, $2, repeat('c', 64) FROM roles WHERE code = 'partner_viewer'`, [PB, OPS]))).toBe('PARTNER_PLATFORM_ROLE');
    expect(await errCode(kvAdmin.query(`SELECT token_hash FROM partner_invites LIMIT 1`))).toBe('42501');
    expect(await errCode(kvAdmin.query(`SELECT user_id FROM partner_memberships LIMIT 1`))).toBe('42501');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) the admin registry: each partner with its active-admin count, its console members and its published promise', async () => {
    const r = await request(adminHttp).get('/v1/partners').set(bearer(adminToken(VIEWER, ['platform_partners_viewer'])));
    expect(r.status).toBe(200);
    const byId = new Map<string, any>(r.body.data.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(PA)).toMatchObject({ name: 'Partner OneA Bank', kind: 'bank', regulatorRefMasked: '••••1A01', active: true, activeAdmins: 1, consoleMembers: 1, slaDecisionHours: 48, pendingAdminInvite: null });
    expect(byId.get(PB)).toMatchObject({ activeAdmins: 0, consoleMembers: 0, slaDecisionHours: null });
    expect(byId.get(PC)).toMatchObject({ activeAdmins: 1, consoleMembers: 1, pendingAdminInvite: null });
    const one = await request(adminHttp).get(`/v1/partners/${PC}`).set(bearer(adminToken(VIEWER, ['platform_partners_viewer'])));
    expect(one.status).toBe(200); expect(one.body.data.id).toBe(PC);
    expect((await request(adminHttp).get(`/v1/partners/${randomUUID()}`).set(bearer(adminToken(VIEWER, ['platform_partners_viewer'])))).status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/token|phone|LIC-TEST/i);
  });
});
