// apps/api/src/__tests__/partner0-identity.integration.spec.ts · PC-56 PARTNER-0 · A PARTNER IS AN ORGANISATION — LIVE proof (the real AppModule
// over HTTP, real Postgres + RLS: kv_app for the request tier, the kv_partner axis for the partner's reads, 0225's triggers and policies).
//
//   (1) a partner member signs in TO THE PARTNER: the token carries `pid` + `realm`, no `tid`; a TENANT route answers that token 401
//       (anonymous to the tenant resolver); a partner route answers a TENANT token 401 PARTNER_SESSION_REQUIRED; a partner-typed token with
//       no `realm` is refused (M4);
//   (2) partner A lists ONLY applications on A's products WITH a live consent (fixture: two partners, a live / an expired / an absent
//       consent, and B's own) — the expired and the absent show nothing; a non-admitted id → 404 (never 403);
//   (3) A's checker cannot review / approve / reject B's application, nor read it (404); A's maker reviews but cannot approve (403);
//   (4) an FPO tenant_admin holding `loan.manage` gets NOTHING on the partner routes;
//   (5) `app.partner_id` unset inside a kv_partner block → zero rows (the 0090 NULL guard on the new policy); kv_partner cannot read the
//       applicant column; an X-Partner-Id header can never move the partner;
//   (6) the invite: the token shown ONCE (a replayed key → null), sha256 kept, 7 days, phone-bound, single use (the service AND 0225's trigger),
//       expired refused; accept opens a partner session; a removed member's refresh AND access token are refused; the last admin is kept;
//   (7) `partner_console` OFF → 404 on every partner route; `GET /v1/config/flags` carries the key;
//   (8) a partner's disburse → 403 PARTNER_CANNOT_DISBURSE; the TENANT-side product-owner rule (D3) — the FPO's tenant_admin cannot approve a
//       product whose partner runs its console (403 LOAN_DECIDED_BY_PARTNER) and still approves one whose partner has none;
//   (9) the audit rows: a detail read (a TENANT row of the application's organisation) and a list read (a partner-realm row with the count);
//  (10) the chooser: a person in two partners → PARTNER_CHOICE_REQUIRED (ids + names), then a session for the chosen one; the choice is single use;
//  (11) the masked phone and the applicant's words: absent before approval, present (masked) after.
//   + TOTP for a partner person through the per-person service (partner-realm audit row), and the sign-in PENDING until the code — the tenant flow.
// No hour-of-day literal and no notification-template assertion anywhere (the night-time rule); the invite SMS is proven by its outbox row here
// and by the relay gate (relay-handlers-as-kv-relay) as kv_relay.
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
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});

run('PC-56 PARTNER-0 · a partner is an organisation (integration, real AppModule over HTTP, kv_app + kv_partner)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvApp: Pool; let cache: CacheService; let otp: OtpService; let config: AppConfig;
  const T1 = randomUUID(); const T2 = randomUUID();
  const PA = randomUUID(); const PB = randomUUID(); const PC = randomUUID();
  const ids = { prodA: '', prodB: '', prodC: '', app1: '', app2: '', app3: '', app4: '', app5: '', app6: '' };
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, { accessToken: string; refreshToken: string }> = {};
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
  let fintechBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
    return id;
  };
  const membership = async (userKey: string, partnerId: string, roleCode: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3 RETURNING id`,
    [people[userKey].id, partnerId, roleCode]).then((r) => r.rows[0].id as string);
  const application = async (tenantId: string, productId: string, applicantKey: string, status: string) => admin.query(
    `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, purpose_text, status, created_by)
     VALUES ($1, $2, $3, 5000000, 'seed and fertiliser for the season', $4::loan_app_status, $2) RETURNING id`,
    [tenantId, people[applicantKey].id, productId, status]).then((r) => r.rows[0].id as string);
  const consent = async (applicantKey: string, partnerId: string, appId: string, expires: 'live' | 'expired' | 'open') => admin.query(
    `INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, CASE $4 WHEN 'live' THEN now() + interval '30 days' WHEN 'expired' THEN now() - interval '1 day' ELSE NULL END)`,
    [people[applicantKey].id, partnerId, appId, expires]);
  /** The per-IP limits of the public partner routes (5–20 a minute) would trip on a spec's own sign-ins: their buckets are emptied between
   *  acts, the store1c precedent (`rl:<Controller.handler>:ip:<subject>:<window>`). The limit itself is not this spec's subject. */
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    const routes = ['PartnerAuthController.otp', 'PartnerAuthController.verify', 'PartnerAuthController.verifyTwoFactor', 'PartnerAuthController.refresh',
      'PartnerInvitesController.accept', 'PartnerInvitesController.lookup', 'PartnerTeamController.invite', 'PartnerMeController.enrol', 'PartnerMeController.confirm', 'AuthController.verifyTwoFactor', 'AuthController.refresh'];
    for (const r of routes) for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  /** Sign in TO THE PARTNER over HTTP (the OTP issued through the platform OtpService — the same store `POST /partner/auth/otp` writes). */
  const signIn = async (key: string, extra: Record<string, unknown> = {}) => {
    await resetRates();
    const { code } = await otp.issue(people[key].phone);
    return request(http).post('/v1/partner/auth/verify').send({ phone: people[key].phone, code, ...extra });
  };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const claimsOf = (t: string) => jwt.decode(t) as Record<string, unknown>;
  async function asPartnerAxis<T>(partnerId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      if (partnerId) await c.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  async function asKvApp<T>(partnerId: string | null, userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await kvApp.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', '', true), set_config('app.partner_id', $1, true), set_config('app.user_id', $2, true)`, [partnerId ?? '', userId ?? '']);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    kvApp = new Pool({ connectionString: APP_URL, max: 3 });
    await makeTenant(admin, T1, 'Partner Zero FPO One'); await makeTenant(admin, T2, 'Partner Zero FPO Two');
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    for (const [id, code, name] of [[PA, `p0a_${suffix}`, 'Partner Zero Bank A'], [PB, `p0b_${suffix}`, 'Partner Zero Bank B'], [PC, `p0c_${suffix}`, 'Partner Zero Lender C']]) {
      await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, sla) VALUES ($1, $2, $3, 'bank', 'LIC-TEST-4471', '{"decisionHours": 72}'::jsonb)`, [id, code, name]);
    }
    const product = async (partnerId: string, name: string) => (await admin.query(
      `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       VALUES ($1, $2, $3, 100000, 50000000, 1100, 'harvest_aligned') RETURNING id`, [partnerId, kind, name])).rows[0].id as string;
    ids.prodA = await product(PA, 'A crop loan'); ids.prodB = await product(PB, 'B crop loan'); ids.prodC = await product(PC, 'C crop loan');
    for (const [k, n] of [['farmer1', 'Applicant One'], ['farmer2', 'Applicant Two'], ['farmer3', 'Applicant Three'],
      ['aAdmin', 'A admin'], ['aAdmin2', 'A second admin'], ['aChecker', 'A checker'], ['aMaker', 'A maker'], ['bAdmin', 'B admin'], ['both', 'In both partners'],
      ['fpoAdmin', 'FPO admin'], ['invitee', 'Invited checker'], ['late', 'Late invitee'], ['totpPerson', 'Partner person with TOTP']] as const) await user(k, n);
    await membership('aAdmin', PA, 'partner_admin'); await membership('aAdmin2', PA, 'partner_admin');
    await membership('aChecker', PA, 'partner_checker'); await membership('aMaker', PA, 'partner_maker');
    await membership('bAdmin', PB, 'partner_admin');
    await membership('both', PA, 'partner_viewer'); await membership('both', PB, 'partner_viewer');
    await membership('totpPerson', PA, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);
    // the applications: live / expired / absent consent on A's products, B's own (live for B), and two for the tenant-side rule
    ids.app1 = await application(T1, ids.prodA, 'farmer1', 'submitted'); await consent('farmer1', PA, ids.app1, 'live');
    ids.app2 = await application(T1, ids.prodA, 'farmer2', 'submitted'); await consent('farmer2', PA, ids.app2, 'expired');
    ids.app3 = await application(T2, ids.prodA, 'farmer3', 'submitted');                                  // no consent at all
    ids.app4 = await application(T2, ids.prodB, 'farmer1', 'submitted'); await consent('farmer1', PB, ids.app4, 'open');
    ids.app5 = await application(T1, ids.prodA, 'farmer3', 'under_review');                               // partner A runs its console
    ids.app6 = await application(T1, ids.prodC, 'farmer2', 'under_review');                               // partner C has no console members
    // the switches for this run: partner_console ON; the tenant `fintech` module ON for T1 only (the tenant-side rule's route)
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100 WHERE key = 'partner_console'`);
    fintechBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'fintech'`)).rows[0] ?? null;
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'fintech'`, [JSON.stringify({ tenant_ids: [T1] })]);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE); config = app.get(AppConfig);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('fintech')]) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'partner_console'`).catch(() => undefined);
    if (fintechBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'fintech'`, [fintechBackup.is_enabled, fintechBackup.rollout_pct, JSON.stringify(fintechBackup.rules ?? {})]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvApp?.end(); await admin?.end();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) sign-in to the partner: pid + realm, NO tid; a tenant route refuses it (401); a partner route refuses a tenant token (401)', async () => {
    const r = await signIn('aAdmin');
    expect(r.status).toBe(201);
    tok.aAdmin = r.body.data;
    const c = claimsOf(tok.aAdmin.accessToken);
    expect(c).toMatchObject({ sub: people.aAdmin.id, pid: PA, realm: 'partner', typ: 'partner_access' });
    expect(c).not.toHaveProperty('tid');
    expect(c.perms).toEqual(expect.arrayContaining(['partner.team.manage', 'partner.applications.decide']));
    // the session row is a PARTNER session
    expect((await admin.query(`SELECT realm, partner_id FROM sessions WHERE id = $1`, [c.sid])).rows[0]).toEqual({ realm: 'partner', partner_id: PA });
    // a TENANT route answers a partner token as anonymous → 401 (pinned: 401, not 403)
    expect((await request(http).get('/v1/auth/sessions').set(bearer(tok.aAdmin.accessToken))).status).toBe(401);
    expect((await request(http).get('/v1/fintech/loan-applications').query({ box: 'review' }).set({ ...bearer(tok.aAdmin.accessToken), 'x-tenant-id': T1 })).status).toBe(401);
    // a partner route answers a TENANT token 401 PARTNER_SESSION_REQUIRED (pinned)
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['loan.manage'] });
    const refused = await request(http).get('/v1/partner/applications').set(bearer(tenantTok));
    expect(refused.status).toBe(401); expect(refused.body.error.code).toBe('PARTNER_SESSION_REQUIRED');
    // M4 · a partner-typed token signed with the real secret but WITHOUT `realm` (everything else real: the person, the partner, the session)
    const a = config.auth;
    const noRealm = jwt.sign({ pid: PA, sid: c.sid, roles: c.roles, perms: c.perms, typ: 'partner_access' }, a.accessSecret,
      { subject: people.aAdmin.id, issuer: a.issuer, audience: a.audience, expiresIn: 300, algorithm: 'HS256' });
    const m4 = await request(http).get('/v1/partner/me').set(bearer(noRealm));
    expect(m4.status).toBe(401); expect(m4.body.error.code).toBe('PARTNER_SESSION_REQUIRED');
    // /me: the organisation (regulator reference by its last 4, the published sla) and the person (phone by its last 3)
    const me = await request(http).get('/v1/partner/me').set(bearer(tok.aAdmin.accessToken));
    expect(me.status).toBe(200);
    // PC-56 PARTNER-1a: /me also carries the partner code and the published decision promise (`sla.decision_hours` — this fixture's
    // camelCase key is NOT the promise, so it reads null)
    expect(me.body.data.organisation).toEqual({ id: PA, code: expect.stringMatching(/^p0a_/), name: 'Partner Zero Bank A', kind: 'bank', regulatorRefMasked: '••••4471', sla: { decisionHours: 72 }, slaDecisionHours: null });
    expect(me.body.data.person.phoneMasked).toBe(`••••••${people.aAdmin.phone.slice(-3)}`);
    expect(JSON.stringify(me.body)).not.toContain(people.aAdmin.phone);
    // the refresh re-mints a PARTNER token; a partner refresh token is no tenant refresh token
    const ref = await request(http).post('/v1/partner/auth/refresh').send({ refreshToken: tok.aAdmin.refreshToken });
    expect(ref.status).toBe(201); expect(claimsOf(ref.body.data.accessToken)).toMatchObject({ pid: PA, realm: 'partner' });
    tok.aAdmin = ref.body.data;
    expect((await request(http).post('/v1/auth/refresh').send({ refreshToken: tok.aAdmin.refreshToken, tenantId: T1 })).status).toBe(401);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2) + (9) + (11) before
  it('(2) A lists ONLY its products\' applications WITH a live consent; expired / absent / B\'s show nothing; a non-admitted id is 404', async () => {
    const list = await request(http).get('/v1/partner/applications').set(bearer(tok.aAdmin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([ids.app1]);
    expect(list.body.meta.asOf).toEqual(expect.any(String));
    for (const id of [ids.app2, ids.app3, ids.app4, randomUUID()]) {
      const d = await request(http).get(`/v1/partner/applications/${id}`).set(bearer(tok.aAdmin.accessToken));
      expect(d.status).toBe(404); expect(d.body.error.code).toBe('PARTNER_APPLICATION_NOT_FOUND');
    }
    // B sees only its own
    const b = await signIn('bAdmin'); tok.bAdmin = b.body.data;
    const bl = await request(http).get('/v1/partner/applications').set(bearer(tok.bAdmin.accessToken));
    expect(bl.body.data.map((x: { id: string }) => x.id)).toEqual([ids.app4]);
    // (11) before approval: no applicant words, no phone; the D2 shape — never the applicant's id or name
    const d = await request(http).get(`/v1/partner/applications/${ids.app1}`).set(bearer(tok.aAdmin.accessToken));
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ id: ids.app1, applicantRef: ids.app1, tenantId: T1, product: { id: ids.prodA, name: 'A crop loan' }, purposeCategory: 'crop',
      purposeText: null, amountRequestedMinor: '5000000', amountApprovedMinor: null, status: 'submitted', applicantPhoneMasked: null });
    expect(Object.keys(d.body.data)).not.toContain('applicantUserId');
    expect(JSON.stringify(d.body)).not.toContain(people.farmer1.id);
    expect(JSON.stringify(d.body)).not.toContain('Applicant One');
  });

  it('(9) the audit rows: a detail read is a TENANT row of the application\'s organisation; a list read one partner-realm row with the count', async () => {
    const detail = (await admin.query(`SELECT tenant_id, actor_user_id, actor_role, new_value FROM audit_log WHERE action = 'partner.application.read' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [ids.app1])).rows[0];
    expect(detail).toMatchObject({ tenant_id: T1, actor_user_id: people.aAdmin.id, new_value: { partnerId: PA, realm: 'partner' } });
    expect(detail.actor_role).toBe(`partner:${PA}:partner_admin`);
    const listed = (await admin.query(`SELECT tenant_id, actor_user_id, new_value FROM audit_log WHERE action = 'partner.applications.listed' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [PA])).rows[0];
    expect(listed).toMatchObject({ tenant_id: null, actor_user_id: people.aAdmin.id, new_value: { partnerId: PA, count: 1 } });
    const probe = (await admin.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'partner.application.read_refused' AND actor_user_id = $1`, [people.aAdmin.id])).rows[0].n;
    expect(probe).toBeGreaterThanOrEqual(4);
    // kv_app can write a tenant-less audit row ONLY inside a transaction naming THAT partner (0225's al_insert_partner_realm)
    expect(await errCode(asKvApp(null, null, (c) => c.query(`INSERT INTO audit_log (tenant_id, action, new_value) VALUES (NULL, 'partner.x', '{"partnerId":"${PA}"}'::jsonb)`)))).toBe('42501');
    expect(await errCode(asKvApp(PB, null, (c) => c.query(`INSERT INTO audit_log (tenant_id, action, new_value) VALUES (NULL, 'partner.x', '{"partnerId":"${PA}"}'::jsonb)`)))).toBe('42501');
    expect(await errCode(asKvApp(PA, null, (c) => c.query(`INSERT INTO audit_log (tenant_id, action, new_value) VALUES (NULL, 'partner.x', '{"partnerId":"${PA}"}'::jsonb)`)))).toBe('ok');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3) + (11) after
  it('(3) A\'s checker cannot touch B\'s application (404) nor read it; A\'s maker reviews but cannot approve (403); the checker approves', async () => {
    tok.aChecker = (await signIn('aChecker')).body.data; tok.aMaker = (await signIn('aMaker')).body.data;
    // B's application, by A's people — even A's ADMIN (every verb) gets the 404 shape on all three; the checker likewise on its own verbs
    for (const [act, body] of [['review', {}], ['approve', { amountApprovedMinor: '1000000', coolingOffHours: 24 }], ['reject', { note: 'not ours' }]] as const) {
      const r = await request(http).post(`/v1/partner/applications/${ids.app4}/${act}`).set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': randomUUID() }).send(body);
      expect([act, r.status, r.body.error?.code]).toEqual([act, 404, 'PARTNER_APPLICATION_NOT_FOUND']);
    }
    for (const [act, body] of [['approve', { amountApprovedMinor: '1000000', coolingOffHours: 24 }], ['reject', { note: 'not ours' }]] as const) {
      const r = await request(http).post(`/v1/partner/applications/${ids.app4}/${act}`).set({ ...bearer(tok.aChecker.accessToken), 'idempotency-key': randomUUID() }).send(body);
      expect([act, r.status]).toEqual([act, 404]);
    }
    expect((await request(http).get(`/v1/partner/applications/${ids.app4}`).set(bearer(tok.aChecker.accessToken))).status).toBe(404);
    expect((await admin.query(`SELECT status::text s FROM loan_applications WHERE id = $1`, [ids.app4])).rows[0].s).toBe('submitted');
    // an Idempotency-Key is required on every decision
    const nokey = await request(http).post(`/v1/partner/applications/${ids.app1}/review`).set(bearer(tok.aMaker.accessToken));
    expect(nokey.status).toBe(400); expect(nokey.body.error.code).toBe('PARTNER_IDEMPOTENCY_KEY_REQUIRED');
    // the maker starts the review …
    const rv = await request(http).post(`/v1/partner/applications/${ids.app1}/review`).set({ ...bearer(tok.aMaker.accessToken), 'idempotency-key': randomUUID() });
    expect(rv.status).toBe(201); expect(rv.body.data.status).toBe('under_review');
    // … but never decides
    const mk = await request(http).post(`/v1/partner/applications/${ids.app1}/approve`).set({ ...bearer(tok.aMaker.accessToken), 'idempotency-key': randomUUID() }).send({ amountApprovedMinor: '4000000', coolingOffHours: 24 });
    expect(mk.status).toBe(403); expect(mk.body.error.code).toBe('PARTNER_PERMISSION_MISSING');
    // the checker approves (≤ requested), keyed: a replay of the same key returns the same answer and moves nothing
    const key = randomUUID();
    const ap = await request(http).post(`/v1/partner/applications/${ids.app1}/approve`).set({ ...bearer(tok.aChecker.accessToken), 'idempotency-key': key }).send({ amountApprovedMinor: '4000000', coolingOffHours: 24 });
    expect(ap.status).toBe(201); expect(ap.body.data).toMatchObject({ id: ids.app1, status: 'approved', amountApprovedMinor: '4000000' });
    expect(Object.keys(ap.body.data)).not.toContain('applicantUserId');
    const again = await request(http).post(`/v1/partner/applications/${ids.app1}/approve`).set({ ...bearer(tok.aChecker.accessToken), 'idempotency-key': key }).send({ amountApprovedMinor: '4000000', coolingOffHours: 24 });
    expect(again.status).toBe(201); expect(again.body.data.status).toBe('approved');
    // the tenant-side row: decided in the APPLICATION's tenant, the actor the partner person (audit)
    const row = (await admin.query(`SELECT tenant_id, actor_user_id, actor_role, new_value FROM audit_log WHERE action = 'fintech.loan.approved' AND entity_id = $1`, [ids.app1])).rows;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ tenant_id: T1, actor_user_id: people.aChecker.id, actor_role: `partner:${PA}:partner_checker`, new_value: { realm: 'partner', partnerId: PA } });
  });

  it('(11) after approval: the applicant\'s words and a MASKED phone (last 3) — never the number, never the name', async () => {
    const d = await request(http).get(`/v1/partner/applications/${ids.app1}`).set(bearer(tok.aAdmin.accessToken));
    expect(d.status).toBe(200);
    expect(d.body.data.status).toBe('approved');
    expect(d.body.data.purposeText).toBe('seed and fertiliser for the season');
    expect(d.body.data.applicantPhoneMasked).toBe(`••••••${people.farmer1.phone.slice(-3)}`);
    expect(JSON.stringify(d.body)).not.toContain(people.farmer1.phone);
    expect(JSON.stringify(d.body)).not.toContain('Applicant One');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4) + (8)
  it('(4) an FPO tenant_admin holding loan.manage gets NOTHING on the partner routes', async () => {
    const t = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['loan.manage', '*'] });
    for (const [m, p] of [['get', '/v1/partner/applications'], ['get', `/v1/partner/applications/${ids.app1}`], ['post', `/v1/partner/applications/${ids.app5}/approve`],
      ['get', '/v1/partner/team'], ['get', '/v1/partner/me'], ['post', `/v1/partner/applications/${ids.app1}/disburse`]] as const) {
      const r = await (request(http) as any)[m](p).set({ ...bearer(t), 'x-tenant-id': T1, 'idempotency-key': randomUUID() }).send({ amountApprovedMinor: '1', coolingOffHours: 0 });
      expect([p, r.status, r.body.error?.code]).toEqual([p, 401, 'PARTNER_SESSION_REQUIRED']);
    }
  });

  it('(8) a partner\'s disburse is refused BY NAME; the tenant-side product-owner rule: the FPO cannot decide a console partner\'s product', async () => {
    const d = await request(http).post(`/v1/partner/applications/${ids.app1}/disburse`).set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': randomUUID() });
    expect(d.status).toBe(403); expect(d.body.error.code).toBe('PARTNER_CANNOT_DISBURSE');
    expect((await admin.query(`SELECT count(*)::int n FROM loans WHERE application_id = $1`, [ids.app1])).rows[0].n).toBe(0);
    // the FPO's tenant_admin (loan.manage), in the TENANT realm, on its own tenant's applications:
    const t = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['loan.manage'] });
    const onA = await request(http).post(`/v1/fintech/loan-applications/${ids.app5}/approve`).set({ ...bearer(t), 'x-tenant-id': T1 }).send({ amountApprovedMinor: '1000000', coolingOffHours: 24 });
    expect(onA.status).toBe(403); expect(onA.body.error.code).toBe('LOAN_DECIDED_BY_PARTNER');
    const rejA = await request(http).post(`/v1/fintech/loan-applications/${ids.app5}/reject`).set({ ...bearer(t), 'x-tenant-id': T1 }).send({});
    expect(rejA.status).toBe(403);
    expect((await admin.query(`SELECT status::text s FROM loan_applications WHERE id = $1`, [ids.app5])).rows[0].s).toBe('under_review');
    const onC = await request(http).post(`/v1/fintech/loan-applications/${ids.app6}/approve`).set({ ...bearer(t), 'x-tenant-id': T1 }).send({ amountApprovedMinor: '1000000', coolingOffHours: 24 });
    expect(onC.status).toBe(201); expect(onC.body.data.status).toBe('approved');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) app.partner_id unset → zero rows on the kv_partner axis; the applicant column is not granted; a header never moves the partner', async () => {
    expect(await asPartnerAxis(null, async (c) => (await c.query(`SELECT count(*)::int n FROM loan_applications`)).rows[0].n)).toBe(0);
    expect(await asPartnerAxis(null, async (c) => (await c.query(`SELECT partner_owns_application($1) v`, [ids.app1])).rows[0].v)).toBe(false);
    expect(await asPartnerAxis(null, async (c) => (await c.query(`SELECT count(*)::int n FROM partner_memberships`)).rows[0].n)).toBe(0);
    expect(await asPartnerAxis(PA, async (c) => (await c.query(`SELECT id FROM loan_applications ORDER BY id`)).rows.map((x) => x.id))).toEqual([ids.app1]);
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT applicant_user_id FROM loan_applications`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT purpose_text FROM loan_applications`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT phone FROM users`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT phone FROM partner_invites`)))).toBe('42501');
    // kv_app with app.partner_id set still reads NOTHING on loan_applications (the 0090 rule: the partner policies are TO kv_partner only)
    expect(await asKvApp(PA, null, async (c) => (await c.query(`SELECT count(*)::int n FROM loan_applications`)).rows[0].n)).toBe(0);
    // M3 · a request header naming partner B with A's token: still A's book, never B's
    const r = await request(http).get('/v1/partner/applications').set({ ...bearer(tok.aAdmin.accessToken), 'x-partner-id': PB });
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([ids.app1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (10)
  it('(10) the chooser: two partners → PARTNER_CHOICE_REQUIRED (ids + names), then a session for the chosen one; the choice is single use', async () => {
    const first = await signIn('both');
    expect(first.status).toBe(403); expect(first.body.error.code).toBe('PARTNER_CHOICE_REQUIRED');
    const det = first.body.error.details;
    expect(det.partners).toEqual(expect.arrayContaining([{ id: PA, name: 'Partner Zero Bank A' }, { id: PB, name: 'Partner Zero Bank B' }]));
    expect(det.partners).toHaveLength(2);
    expect(typeof det.choiceToken).toBe('string');
    const chosen = await request(http).post('/v1/partner/auth/verify').send({ choiceToken: det.choiceToken, partnerId: PB });
    expect(chosen.status).toBe(201); expect(claimsOf(chosen.body.data.accessToken)).toMatchObject({ pid: PB, realm: 'partner' });
    const reuse = await request(http).post('/v1/partner/auth/verify').send({ choiceToken: det.choiceToken, partnerId: PA });
    expect(reuse.status).toBe(401); expect(reuse.body.error.code).toBe('PARTNER_CHOICE_INVALID');
    // naming a partner up front works for a member, and answers "no access" for anyone else (never which partners exist)
    const direct = await signIn('both', { partnerId: PA });
    expect(direct.status).toBe(201); expect(claimsOf(direct.body.data.accessToken).pid).toBe(PA);
    const notMine = await signIn('aMaker', { partnerId: PB });
    expect(notMine.status).toBe(403); expect(notMine.body.error.code).toBe('PARTNER_ACCESS_NONE');
    const stranger = await signIn('farmer1');
    expect(stranger.status).toBe(403); expect(stranger.body.error.code).toBe('PARTNER_ACCESS_NONE');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) the invite: shown once, sha256 kept, 7 days, phone-bound, single use; accept opens a partner session; removal ends it; the last admin stays', async () => {
    await resetRates();
    const key = randomUUID();
    const inv = await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': key }).send({ phone: people.invitee.phone, roleCode: 'partner_checker' });
    expect(inv.status).toBe(201);
    const token = inv.body.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(inv.body.data.tokenShown).toBe(true);
    expect(inv.body.data.phoneMasked).toBe(`••••••${people.invitee.phone.slice(-3)}`);
    const replay = await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': key }).send({ phone: people.invitee.phone, roleCode: 'partner_checker' });
    expect(replay.body.data.id).toBe(inv.body.data.id); expect(replay.body.data.token).toBeNull();
    const row = (await admin.query(`SELECT token_hash, token_sealed IS NOT NULL AS sealed, (expires_at - created_at) = interval '7 days' AS seven, partner_id, status FROM partner_invites WHERE id = $1`, [inv.body.data.id])).rows[0];
    expect(row).toMatchObject({ sealed: true, seven: true, partner_id: PA, status: 'pending' });
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/); expect(row.token_hash).not.toContain(token);
    // the SMS rides the outbox (its handler is a relay-gate case, dispatched as kv_relay there)
    expect((await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'partner.member_invited' AND aggregate_id = $1 AND payload->>'partnerId' = $2`, [inv.body.data.id, PA])).rows[0].n).toBe(1);
    // the maker / checker / viewer cannot invite
    expect((await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aChecker.accessToken), 'idempotency-key': randomUUID() }).send({ phone: phoneOf(), roleCode: 'partner_viewer' })).status).toBe(403);
    // the public lookup: the partner's name, the role, the phone by its last 3
    const look = await request(http).get(`/v1/partner/invites/${token}`);
    expect(look.status).toBe(200);
    expect(look.body.data).toMatchObject({ organisation: 'Partner Zero Bank A', roleCode: 'partner_checker', status: 'pending', phoneMasked: `••••••${people.invitee.phone.slice(-3)}` });
    // phone-bound: another phone with the token → 404 (and no OTP was consumed for it)
    const other = await request(http).post('/v1/partner/invites/accept').send({ token, phone: people.late.phone, code: (await otp.issue(people.late.phone)).code });
    expect(other.status).toBe(404); expect(other.body.error.code).toBe('PARTNER_INVITE_NOT_FOUND');
    // accept: token + OTP on the invited phone → membership active, invite accepted, a PARTNER session
    const acc = await request(http).post('/v1/partner/invites/accept').send({ token, phone: people.invitee.phone, code: (await otp.issue(people.invitee.phone)).code });
    expect(acc.status).toBe(201);
    expect(claimsOf(acc.body.data.accessToken)).toMatchObject({ sub: people.invitee.id, pid: PA, realm: 'partner' });
    expect(acc.body.data.invite).toEqual({ id: inv.body.data.id, roleCode: 'partner_checker' });
    tok.invitee = acc.body.data;
    expect((await admin.query(`SELECT status, token_sealed IS NULL AS cleared FROM partner_invites WHERE id = $1`, [inv.body.data.id])).rows[0]).toEqual({ status: 'accepted', cleared: true });
    // M5 · single use: the same token again → 409 PARTNER_INVITE_ALREADY_USED (before any OTP is spent)
    const second = await request(http).post('/v1/partner/invites/accept').send({ token, phone: people.invitee.phone, code: (await otp.issue(people.invitee.phone)).code });
    expect(second.status).toBe(409); expect(second.body.error.code).toBe('PARTNER_INVITE_ALREADY_USED');
    // … and the database refuses to move a closed invite at all (0225's trigger), even for kv_app inside the partner
    expect(await errCode(asKvApp(PA, people.invitee.id, (c) => c.query(`UPDATE partner_invites SET status = 'revoked', revoked_by = $2, revoked_reason = 'trying to reopen it' WHERE id = $1`, [inv.body.data.id, people.aAdmin.id])))).toBe('PARTNER_INVITE_FINAL');
    expect(await errCode(asKvApp(PA, people.aAdmin.id, (c) => c.query(`DELETE FROM partner_invites WHERE id = $1`, [inv.body.data.id])))).toMatch(/42501|PARTNER_INVITE_FINAL/);
    // expired: a second invite whose 7 days are over (history written as the superuser, triggers off for that one statement)
    const late = await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': randomUUID() }).send({ phone: people.late.phone, roleCode: 'partner_viewer' });
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await c.query(`UPDATE partner_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [late.body.data.id]); await c.query('COMMIT'); }
    finally { c.release(); }
    await resetRates();
    const exp = await request(http).post('/v1/partner/invites/accept').send({ token: late.body.data.token, phone: people.late.phone, code: (await otp.issue(people.late.phone)).code });
    expect(exp.status).toBe(410); expect(exp.body.error.code).toBe('PARTNER_INVITE_EXPIRED');
    // revoke needs a reason
    const third = await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': randomUUID() }).send({ phone: phoneOf(), roleCode: 'partner_viewer' });
    expect((await request(http).post(`/v1/partner/team/invites/${third.body.data.id}/revoke`).set(bearer(tok.aAdmin.accessToken)).send({ reason: 'short' })).status).toBe(422);
    expect((await request(http).post(`/v1/partner/team/invites/${third.body.data.id}/revoke`).set(bearer(tok.aAdmin.accessToken)).send({ reason: 'the person joined another lender' })).body.data.status).toBe('revoked');
    // the team read (axis definers): names, masked phones, roles; pending invites
    const team = await request(http).get('/v1/partner/team').set(bearer(tok.aAdmin.accessToken));
    expect(team.status).toBe(200);
    const inviteeRow = team.body.data.members.find((m: { userId: string }) => m.userId === people.invitee.id);
    expect(inviteeRow).toMatchObject({ roleCode: 'partner_checker', active: true, phoneMasked: `••••••${people.invitee.phone.slice(-3)}` });
    expect(JSON.stringify(team.body)).not.toContain(people.invitee.phone);
    // removal with a reason → the person's refresh AND access token are refused at once
    const rm = await request(http).post(`/v1/partner/team/members/${inviteeRow.membershipId}/remove`).set(bearer(tok.aAdmin.accessToken)).send({ reason: 'left the credit team this week' });
    expect(rm.status).toBe(201); expect(rm.body.data.sessionsEnded).toBeGreaterThanOrEqual(1);
    const rr = await request(http).post('/v1/partner/auth/refresh').send({ refreshToken: tok.invitee.refreshToken });
    expect(rr.status).toBe(401); expect(rr.body.error.code).toBe('REFRESH_INVALID');
    const ra = await request(http).get('/v1/partner/me').set(bearer(tok.invitee.accessToken));
    expect(ra.status).toBe(401); expect(ra.body.error.code).toBe('PARTNER_SESSION_ENDED');
    // yourself: refused; the LAST admin: the service never lets it happen, and the database refuses it outright
    const self = await request(http).post(`/v1/partner/team/members/${(await admin.query(`SELECT id FROM partner_memberships WHERE user_id = $1 AND partner_id = $2`, [people.aAdmin.id, PA])).rows[0].id}/remove`)
      .set(bearer(tok.aAdmin.accessToken)).send({ reason: 'stepping down from the console' });
    expect(self.status).toBe(409); expect(self.body.error.code).toBe('PARTNER_REMOVE_SELF');
    const bAdminRow = (await admin.query(`SELECT id FROM partner_memberships WHERE user_id = $1 AND partner_id = $2`, [people.bAdmin.id, PB])).rows[0].id;
    expect(await errCode(asKvApp(PB, people.bAdmin.id, (c) => c.query(`UPDATE partner_memberships SET is_active = false, removed_at = now(), removed_by = $2, removed_reason = 'the only administrator' WHERE id = $1`, [bAdminRow, people.bAdmin.id])))).toBe('PARTNER_LAST_ADMIN');
    // kv_app cannot reach another partner's memberships even by id (RLS: the transaction's partner only)
    expect(await asKvApp(PA, people.aAdmin.id, async (c) => (await c.query(`UPDATE partner_memberships SET removed_reason = removed_reason WHERE id = $1`, [bAdminRow])).rowCount)).toBe(0);
    // a partner role can never be a tenant role
    expect(await errCode(admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'partner_admin'`, [people.late.id, T1]))).toBe('PARTNER_ROLE_NOT_TENANT');
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── 2FA
  it('TOTP for a partner person: enrol → confirm through the per-person service (a partner-realm audit row); sign-in is PENDING until the code', async () => {
    const t = (await signIn('totpPerson')).body.data;
    const en = await request(http).post('/v1/partner/me/2fa/enrol').set(bearer(t.accessToken));
    expect(en.status).toBe(201);
    const secret = en.body.data.secret as string;
    const now = Date.now();
    const cf = await request(http).post('/v1/partner/me/2fa/confirm').set(bearer(t.accessToken)).send({ code: totpCodeAt(secret, now) });
    expect(cf.status).toBe(201); expect(cf.body.data.recoveryCodes).toHaveLength(10);
    const trail = (await admin.query(`SELECT tenant_id, new_value FROM audit_log WHERE action = 'two_factor.enabled' AND actor_user_id = $1`, [people.totpPerson.id])).rows;
    expect(trail).toHaveLength(1); expect(trail[0]).toMatchObject({ tenant_id: null, new_value: { partnerId: PA } });
    const st = await request(http).get('/v1/partner/me/2fa').set(bearer(t.accessToken));
    expect(st.body.data).toMatchObject({ enrolled: true, confirmed: true });
    const pending = await signIn('totpPerson');
    expect(pending.status).toBe(403); expect(pending.body.error.code).toBe('TWO_FACTOR_PENDING');
    // the pending PARTNER session cannot be finished through the TENANT 2FA route (realms never cross)
    await resetRates();
    const crossed = await request(http).post('/v1/auth/2fa/verify').send({ tenantId: T1, challengeToken: pending.body.error.details.challengeToken, code: totpCodeAt(secret, now + 30_000) });
    expect(crossed.status).toBe(401);
    const done = await request(http).post('/v1/partner/auth/2fa/verify').send({ challengeToken: pending.body.error.details.challengeToken, code: totpCodeAt(secret, now + 30_000) });
    expect(done.status).toBe(201); expect(claimsOf(done.body.data.accessToken)).toMatchObject({ sub: people.totpPerson.id, pid: PA, realm: 'partner' });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7) LAST: switches the realm off
  it('(7) partner_console OFF → 404 on EVERY partner route (the realm is invisible); GET /v1/config/flags carries the key', async () => {
    const flags = await request(http).get('/v1/config/flags');
    expect(flags.status).toBe(200); expect(flags.body.data.partner_console).toBe(true);
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'partner_console'`);
    for (const k of flagKeys('partner_console')) await cache.del(k);
    const routes: Array<[string, string, Record<string, unknown>?]> = [
      ['post', '/v1/partner/auth/otp', { phone: people.aAdmin.phone }], ['post', '/v1/partner/auth/verify', { phone: people.aAdmin.phone, code: '123456' }],
      ['post', '/v1/partner/auth/refresh', { refreshToken: tok.aAdmin.refreshToken }], ['post', '/v1/partner/auth/2fa/verify', { challengeToken: 'x'.repeat(43), code: '123456' }],
      ['post', '/v1/partner/auth/logout'], ['get', '/v1/partner/me'], ['get', '/v1/partner/me/2fa'], ['post', '/v1/partner/me/2fa/enrol'],
      ['get', '/v1/partner/applications'], ['get', `/v1/partner/applications/${ids.app1}`], ['post', `/v1/partner/applications/${ids.app1}/review`],
      ['post', `/v1/partner/applications/${ids.app1}/approve`, { amountApprovedMinor: '1' }], ['post', `/v1/partner/applications/${ids.app1}/reject`, {}],
      ['post', `/v1/partner/applications/${ids.app1}/disburse`], ['get', '/v1/partner/team'], ['post', '/v1/partner/team/invites', { phone: phoneOf(), roleCode: 'partner_viewer' }],
      ['post', `/v1/partner/team/invites/${randomUUID()}/revoke`, { reason: 'a reason that is long' }], ['post', `/v1/partner/team/members/${randomUUID()}/remove`, { reason: 'a reason that is long' }],
      ['get', `/v1/partner/invites/${'t'.repeat(43)}`], ['post', '/v1/partner/invites/accept', { token: 't'.repeat(43), phone: people.aAdmin.phone, code: '123456' }],
    ];
    try {
      await resetRates();
      for (const [m, p, body] of routes) {
        const r = await (request(http) as any)[m](p).set({ ...bearer(tok.aAdmin.accessToken), 'idempotency-key': randomUUID() }).send(body ?? {});
        expect([m, p, r.status]).toEqual([m, p, 404]);
      }
      const off = await request(http).get('/v1/config/flags');
      expect(off.body.data.partner_console).toBe(false);
    } finally {
      await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'partner_console'`);
      for (const k of flagKeys('partner_console')) await cache.del(k);
    }
    // back ON: the same token reads again (nothing else changed)
    expect((await request(http).get('/v1/partner/me').set(bearer(tok.aAdmin.accessToken))).status).toBe(200);
  });
});
