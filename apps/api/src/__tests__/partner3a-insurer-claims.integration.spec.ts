// apps/api/src/__tests__/partner3a-insurer-claims.integration.spec.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — FACTS, NEVER A
// CLAIMANT — LIVE proof (the real AppModule over HTTP, real Postgres + RLS: the kv_partner axis through 0230's definers; kv_partner holds NO
// privilege on insurance_claims).
//
// Fixture (the 2a path): TWO insurers (A, B) and ONE bank, each with an administrator and a viewer; products for A (two) and B (one); policies
// on them across TWO tenants with REAL holders; claims inserted as the owner on A's policies in EVERY status of the machine — the `surveyed`
// one with a survey_report carrying `damagePercent` AND free-text `notes` and a real surveyor; the approved ones with `approved_minor`; every
// one with a real claimant and a description — one claim older than the FY start, one whose event_type_id resolves to a lookup value that is
// NOT a platform `claim_event` (it must count as "not recorded"), and one claim on B's policy. `partner_console` ON and `insurance` ON.
//   (1) A's viewer GET /v1/partner/insurance/claims → A's claims only, OLDEST first; keyset page 2; the status filter                       [M2]
//   (2) a deep-key assertion over EVERY response (list, detail, counts): no claimantUserId / description / surveyorUserId / surveyReport / notes
//       / payoutId / tenantId / createdBy / phone / name property, and no claimant, surveyor or note VALUE; `damagePercent` a number on the
//       surveyed claim; at the database, as kv_partner, `SELECT claimant_user_id FROM insurance_claims` and `SELECT *` → 42501           [M3]
//   (3) B's claim by A → 404 PARTNER_CLAIM_NOT_FOUND (an absent id the same); the bank's member → an empty queue and zero counts, not an
//       error; `app.partner_id` unset → zero rows through every definer
//   (4) partner_console OFF → 404; insurance OFF → 404 PARTNER_INSURANCE_SWITCHED_OFF; a tenant token → 401; all four partner roles hold
//       `partner.claims.read` (the viewer proven over HTTP)
//   (5) ONE audit row `partner.claims.read` per list / detail / counts call, counts only                                                    [M6]
//   (6) the counts equal the fixture by status × event code inside the FY window (the old claim excluded; a non-`claim_event` id → not
//       recorded); decided counts; no money, no ratio
//   (7) the absence pinned: POST …/claims/:id/{decide,settle,assign,flag}, POST …/claims/:id/evidence/verify, POST …/surveys/:id/accept,
//       POST …/surveyors → 404
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

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
const FORBIDDEN_KEY = /^(claimantUserId|claimant_user_id|claimant|description|surveyorUserId|surveyor_user_id|surveyor|surveyReport|survey_report|notes|note|payoutId|payout_id|tenantId|tenant_id|createdBy|created_by|updatedBy|updated_by|holderUserId|phone|name)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const NOTE = 'Surveyor note: the animal was found near the canal; owner distraught';
const DESC = 'My buffalo died after the storm, please help';

run('PC-56 PARTNER-3a · an insurer reads the claim facts on its own products — never a claimant (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const IA = randomUUID(); const IB = randomUUID(); const BK = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const clm: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  const ev: Record<string, string> = {};
  let foreignLookup = '';

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone, name };
  };
  const membership = (userKey: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`, [people[userKey].id, partnerId, role]);
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const signIn = async (key: string) => {
    await resetRates();
    const { code } = await otp.issue(people[key].phone);
    const r = await request(http).post('/v1/partner/auth/verify').send({ phone: people[key].phone, code });
    expect([key, r.status]).toEqual([key, 201]);
    tok[key] = r.body.data.accessToken;
  };
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  const get = async (key: string, path: string, query: Record<string, unknown> = {}) => {
    const r = await request(http).get(path).query(query).set(bearer(key));
    responses.push(r.body);
    return r;
  };
  async function asPartnerAxis<T>(partnerId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      if (partnerId) await c.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.claims.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'insurance']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Claims Fixture Growers Collective'); await makeTenant(admin, T2, 'Claims Fixture Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES
      ($1, $2, 'Fixture Insurer A', 'insurer'), ($3, $4, 'Fixture Insurer B', 'insurer'), ($5, $6, 'Fixture Bank K', 'bank')`,
      [IA, `p3aa_${sfx}`, IB, `p3ab_${sfx}`, BK, `p3ak_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Insurer A admin'], ['aViewer', 'Insurer A viewer'], ['bViewer', 'Insurer B viewer'], ['kViewer', 'Bank K viewer'],
      ['h1', 'Claimant Savitri One'], ['h2', 'Claimant Ramesh Two'], ['h3', 'Claimant Hetal Three'], ['sv', 'Surveyor Dinesh'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n);
    await membership('aAdmin', IA, 'partner_admin'); await membership('aViewer', IA, 'partner_viewer');
    await membership('bViewer', IB, 'partner_viewer'); await membership('kViewer', BK, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);
    for (const r of (await admin.query(`SELECT id, code FROM lookup_values WHERE type_code = 'claim_event' AND tenant_id IS NULL`)).rows) ev[r.code] = r.id;
    foreignLookup = (await admin.query(`SELECT id FROM lookup_values WHERE type_code <> 'claim_event' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const kind = foreignLookup;
    const product = async (key: string, partnerId: string, name: string) => {
      prod[key] = (await admin.query(`INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc) VALUES ($1, $2, $3, '{"kind":"pct_of_sum_insured","bps":320}'::jsonb) RETURNING id`,
        [partnerId, kind, name])).rows[0].id;
    };
    await product('a1', IA, 'Fixture cattle cover'); await product('a2', IA, 'Fixture crop cover'); await product('b1', IB, 'Fixture rival cover');
    const policy = async (key: string, tenantId: string, holderKey: string, productKey: string, subject: string, sum: string) => {
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, 1000, 'active', current_date - 200, current_date + 165) RETURNING id`, [tenantId, people[holderKey].id, prod[productKey], subject, randomUUID(), sum])).rows[0].id;
    };
    await policy('p1', T1, 'h1', 'a1', 'animal', '11000000');
    await policy('p2', T2, 'h2', 'a2', 'crop_season', '8000000');
    await policy('q1', T2, 'h3', 'b1', 'animal', '9000000');
    /** A claim (owner) `agoMin` minutes old (or at a fixed instant), with a REAL claimant, a description and a creator the read must never return. */
    const claim = async (key: string, tenantId: string, policyKey: string, claimantKey: string, status: string, eventId: string, at: string, extra: { surveyor?: boolean; report?: unknown; approved?: string; within?: boolean } = {}) => {
      clm[key] = (await admin.query(
        `INSERT INTO insurance_claims (tenant_id, policy_id, claimant_user_id, event_date, event_type_id, description, status, intimated_within_72h, surveyor_user_id, survey_report,
                                       approved_minor, closed_at, created_at, created_by)
         VALUES ($1, $2, $3, current_date - 20, $4, $5, $6::claim_status, $7, $8, $9::jsonb, $10, CASE WHEN $6::text = 'closed' THEN now() END, $11::timestamptz, $3) RETURNING id`,
        [tenantId, pol[policyKey], people[claimantKey].id, eventId, DESC, status, extra.within ?? true, extra.surveyor ? people.sv.id : null,
          extra.report ? JSON.stringify(extra.report) : null, extra.approved ?? null, at])).rows[0].id;
    };
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    // A's claims, one per status (oldest first = the order below), across two tenants; the old one before the FY start
    await claim('old', T1, 'p1', 'h1', 'closed', ev.death, '2025-12-01T06:00:00Z');
    await claim('c1', T1, 'p1', 'h1', 'intimated', ev.death, ago(90), { within: false });
    await claim('c2', T2, 'p2', 'h2', 'docs_pending', foreignLookup, ago(80));
    await claim('c3', T1, 'p1', 'h1', 'survey_scheduled', ev.flood, ago(70), { surveyor: true });
    await claim('c4', T1, 'p1', 'h1', 'surveyed', ev.death, ago(60), { surveyor: true, report: { damagePercent: 62, notes: NOTE, surveyedAt: ago(61) } });
    await claim('c5', T2, 'p2', 'h2', 'approved', ev.hail, ago(50), { surveyor: true, approved: '6400000', report: { damagePercent: 80, notes: NOTE } });
    await claim('c6', T2, 'p2', 'h2', 'partially_approved', ev.hail, ago(40), { surveyor: true, approved: '2850000' });
    await claim('c7', T1, 'p1', 'h1', 'rejected', ev.fire, ago(30));
    await claim('c8', T2, 'p2', 'h2', 'paid', ev.pest, ago(20), { approved: '1000000' });
    await claim('c9', T1, 'p1', 'h1', 'closed', ev.death, ago(10));
    // B's claim
    await claim('b1', T2, 'q1', 'h3', 'intimated', ev.theft, ago(5));

    await setFlag('partner_console', true); await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('insurance')]) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bViewer', 'kViewer']) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  const A_ORDER = () => [clm.old, clm.c1, clm.c2, clm.c3, clm.c4, clm.c5, clm.c6, clm.c7, clm.c8, clm.c9];

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A\'s viewer reads only A\'s claims, OLDEST first; keyset page 2; the status filter', async () => {
    const all = await get('aViewer', '/v1/partner/insurance/claims');
    expect([all.status, all.status === 200 ? null : all.body]).toEqual([200, null]);
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual(A_ORDER());
    expect(all.body.meta).toMatchObject({ nextCursor: null, limit: 25, computedAt: expect.any(String) });
    const p1 = await get('aViewer', '/v1/partner/insurance/claims', { limit: 4 });
    const p2 = await get('aViewer', '/v1/partner/insurance/claims', { limit: 4, cursor: p1.body.meta.nextCursor });
    const p3 = await get('aViewer', '/v1/partner/insurance/claims', { limit: 4, cursor: p2.body.meta.nextCursor });
    expect([p1.body.data.map((x: { id: string }) => x.id), p2.body.data.map((x: { id: string }) => x.id), p3.body.data.map((x: { id: string }) => x.id), p3.body.meta.nextCursor])
      .toEqual([A_ORDER().slice(0, 4), A_ORDER().slice(4, 8), A_ORDER().slice(8), null]);
    const surveyed = await get('aViewer', '/v1/partner/insurance/claims', { status: 'surveyed' });
    expect(surveyed.body.data.map((x: { id: string }) => x.id)).toEqual([clm.c4]);
    const closed = await get('aViewer', '/v1/partner/insurance/claims', { status: 'closed' });
    expect(closed.body.data.map((x: { id: string }) => x.id)).toEqual([clm.old, clm.c9]);
    expect((await get('aViewer', '/v1/partner/insurance/claims', { status: 'paying' })).status).toBe(422);   // not a state of the machine
    const row = all.body.data.find((x: { id: string }) => x.id === clm.c1);
    expect(row).toEqual({ id: clm.c1, policyId: pol.p1, policyNo: null, productId: prod.a1, productName: 'Fixture cattle cover', fpoName: 'Claims Fixture Growers Collective',
      subjectType: 'animal', sumInsuredMinor: '11000000', eventTypeCode: 'death', eventDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), status: 'intimated',
      reportedWithin72h: false, approvedMinor: null, damagePercent: null, filedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      lastChangedAt: expect.any(String), closedAt: null, waitingDays: 0 });
    expect(all.body.data.find((x: { id: string }) => x.id === clm.c2)).toMatchObject({ fpoName: 'Claims Fixture Dairy Collective', eventTypeCode: null, subjectType: 'crop_season' });
    expect(all.body.data.find((x: { id: string }) => x.id === clm.c6)).toMatchObject({ status: 'partially_approved', approvedMinor: '2850000' });
    expect(all.body.data.find((x: { id: string }) => x.id === clm.c9)).toMatchObject({ closedAt: expect.any(String), waitingDays: null });
    const json = JSON.stringify(all.body);
    expect(json).not.toContain(clm.b1); expect(json).not.toContain(T1); expect(json).not.toContain(T2);
    const b = await get('bViewer', '/v1/partner/insurance/claims');
    expect(b.body.data.map((x: { id: string }) => x.id)).toEqual([clm.b1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) no identity anywhere — every response (deep keys + values); damagePercent a number; kv_partner cannot select from insurance_claims at all', async () => {
    const one = await get('aViewer', `/v1/partner/insurance/claims/${clm.c4}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: clm.c4, status: 'surveyed', damagePercent: 62, eventTypeCode: 'death', computedAt: expect.any(String) });
    expect(typeof one.body.data.damagePercent).toBe('number');
    await get('aViewer', '/v1/partner/insurance/claims/counts');
    await get('aViewer', `/v1/partner/insurance/claims/${clm.c5}`);
    expect(responses.length).toBeGreaterThanOrEqual(10);
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['h1', 'h2', 'h3', 'sv']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone)]).toEqual([p, false, false, false]);
      }
      expect([json.includes(NOTE), json.includes(DESC), json.includes('canal')]).toEqual([false, false, false]);
    }
    // the database wall: kv_partner holds NO privilege on insurance_claims — 42501, not "no rows"
    for (const sql of ['SELECT claimant_user_id FROM insurance_claims', 'SELECT * FROM insurance_claims', 'SELECT id FROM insurance_claims', 'SELECT survey_report FROM insurance_claims']) {
      expect([sql, await errCode(asPartnerAxis(IA, (c) => c.query(sql)))]).toEqual([sql, '42501']);
    }
    // the definers' own column sets hold no identity
    for (const sql of ['SELECT * FROM partner_insurance_claims(NULL, NULL, NULL, 100)', `SELECT * FROM partner_insurance_claim('${clm.c4}')`]) {
      const cols = (await asPartnerAxis(IA, (c) => c.query(sql))).fields.map((f) => f.name);
      expect([sql, cols.filter((c) => /claimant|description|surveyor|survey_report|payout|created_by|updated_by|notes/.test(c))]).toEqual([sql, []]);
    }
    // kv_app cannot call a claims definer without wearing the axis role
    const kvApp = new Pool({ connectionString: APP_URL, max: 1 });
    try { expect(await errCode(kvApp.query(`SELECT * FROM partner_insurance_claims(NULL, NULL, NULL, 100)`))).toBe('42501'); } finally { await kvApp.end(); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) B\'s claim by A → 404 (an absent id the same); the bank\'s member → empty, zero counts, not an error; no partner in scope → nothing', async () => {
    for (const id of [clm.b1, randomUUID(), 'not-a-uuid']) {
      const r = await get('aViewer', `/v1/partner/insurance/claims/${id}`);
      expect([id, r.status, r.body.error?.code]).toEqual([id, 404, 'PARTNER_CLAIM_NOT_FOUND']);
      expect(JSON.stringify(r.body)).not.toMatch(/not yours|another (insurer|partner)/i);
    }
    const k = await get('kViewer', '/v1/partner/insurance/claims');
    expect([k.status, k.body.data]).toEqual([200, []]);
    const kc = await get('kViewer', '/v1/partner/insurance/claims/counts');
    expect(kc.status).toBe(200);
    expect(kc.body.data).toMatchObject({ total: 0, decided: { approved: 0, partiallyApproved: 0, rejected: 0 } });
    expect(Object.values(kc.body.data.byStatus).every((n) => n === 0)).toBe(true);
    // the 0090 NULL guard on every 0230 definer
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_claims(NULL, NULL, NULL, 100)`))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_claim($1)`, [clm.c4]))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_claim_counts('2000-01-01', '2100-01-01')`))).rowCount).toBe(0);
    // and B's axis sees B's claim only
    expect((await asPartnerAxis(IB, (c) => c.query(`SELECT id FROM partner_insurance_claims(NULL, NULL, NULL, 100)`))).rows.map((x) => x.id)).toEqual([clm.b1]);
    expect((await asPartnerAxis(IB, (c) => c.query(`SELECT id FROM partner_insurance_claim($1)`, [clm.c4]))).rowCount).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) partner_console OFF → 404; insurance OFF → 404 by name; a tenant token → 401; every partner role holds partner.claims.read', async () => {
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['insurance.manage'] });
    const t = await request(http).get('/v1/partner/insurance/claims').set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': T1 });
    expect([t.status, t.body.error?.code]).toEqual([401, 'PARTNER_SESSION_REQUIRED']);
    expect((jwt.decode(tok.aViewer) as { perms: string[] }).perms).toContain('partner.claims.read');
    const me = await request(http).get('/v1/partner/me').set(bearer('aViewer'));
    expect(me.body.data.person.permissions).toContain('partner.claims.read');
    expect((await admin.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'partner.claims.read'`)).rows[0].roles)
      .toBe('partner_admin,partner_checker,partner_maker,partner_viewer');
    const routes = ['/v1/partner/insurance/claims', '/v1/partner/insurance/claims/counts', `/v1/partner/insurance/claims/${clm.c4}`];
    await setFlag('insurance', false);
    try {
      for (const p of routes) {
        const r = await request(http).get(p).set(bearer('aViewer'));
        expect([p, r.status, r.body.error?.code]).toEqual([p, 404, 'PARTNER_INSURANCE_SWITCHED_OFF']);
      }
    } finally { await setFlag('insurance', true); }
    await setFlag('partner_console', false);
    try {
      for (const p of routes) {
        const r = await request(http).get(p).set(bearer('aViewer'));
        expect([p, r.status, r.body.error?.code === 'PARTNER_INSURANCE_SWITCHED_OFF']).toEqual([p, 404, false]);
      }
    } finally { await setFlag('partner_console', true); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) one partner-realm audit row `partner.claims.read` per call — list, detail, counts — counts only', async () => {
    const before = (await audits(IA)).length;
    await get('aAdmin', '/v1/partner/insurance/claims', { status: 'approved' });
    await get('aAdmin', `/v1/partner/insurance/claims/${clm.c5}`);
    await get('aAdmin', '/v1/partner/insurance/claims/counts');
    const rows = (await audits(IA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['claims', 'claim', 'claims_counts']);
    expect(rows.map((r) => [r.entity_type, r.entity_id])).toEqual([['financial_partner', IA], ['insurance_claim', clm.c5], ['financial_partner', IA]]);
    const allowed = new Set(['partnerId', 'realm', 'surface', 'listed', 'status', 'page', 'found', 'from', 'to', 'claims']);
    for (const r of rows) {
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      expect(r.new_value).toMatchObject({ partnerId: IA, realm: 'partner' });
      const json = JSON.stringify(r);
      for (const p of ['h1', 'h2', 'sv']) expect(json.includes(people[p].id)).toBe(false);
      expect([json.includes('6400000'), json.includes(NOTE)]).toEqual([false, false]);
    }
    expect(rows[0].new_value).toMatchObject({ listed: 1, status: 'approved', page: 'first' });
    expect(rows[1].new_value).toMatchObject({ found: true });
    expect(rows[2].new_value).toMatchObject({ claims: 9, from: expect.stringMatching(/^\d{4}-04-01$/) });
    // a refused probe is recorded too (A asked for B's claim)
    const n = (await audits(IA)).length;
    await get('aAdmin', `/v1/partner/insurance/claims/${clm.b1}`);
    expect((await audits(IA)).slice(n).map((r) => [r.entity_id, r.new_value.found])).toEqual([[clm.b1, false]]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) the counts equal the fixture by status × event code inside the FY window (the old claim out; a non-claim_event id → not recorded); no money', async () => {
    const fy = (await admin.query(`SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata')::date) >= 4 THEN extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int
      ELSE extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int - 1 END AS y`)).rows[0].y as number;
    const r = await get('aViewer', '/v1/partner/insurance/claims/counts');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      from: `${fy}-04-01`, to: `${fy + 1}-04-01`, timeZone: 'Asia/Kolkata', fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, total: 9,
      byStatus: { intimated: 1, docs_pending: 1, survey_scheduled: 1, surveyed: 1, approved: 1, partially_approved: 1, rejected: 1, paid: 1, closed: 1 },
      byEvent: { not_recorded: 1, death: 3, flood: 1, hail: 2, fire: 1, pest: 1 },
      decided: { approved: 1, partiallyApproved: 1, rejected: 1 }, computedAt: expect.any(String),
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Minor|ratio|rate|median|percent|paid_minor|settle/i);
    // an explicit window that holds the old claim counts it (a window is the caller's, the FY the default)
    const wide = await get('aViewer', '/v1/partner/insurance/claims/counts', { from: '2025-11-01', to: '2026-11-01' });
    expect(wide.body.data).toMatchObject({ total: 10, fy: null, byStatus: { closed: 2 } });
    expect((await get('aViewer', '/v1/partner/insurance/claims/counts', { from: '2026-04-01' })).status).toBe(422);
    expect((await get('aViewer', '/v1/partner/insurance/claims/counts', { from: '2027-04-01', to: '2026-04-01' })).status).toBe(422);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) no money, decision, assignment, flag, evidence, survey or surveyor route exists in the partner realm — 404, pinned', async () => {
    const posts = [`/v1/partner/insurance/claims/${clm.c5}/decide`, `/v1/partner/insurance/claims/${clm.c5}/settle`, `/v1/partner/insurance/claims/${clm.c1}/assign`,
      `/v1/partner/insurance/claims/${clm.c1}/flag`, `/v1/partner/insurance/claims/${clm.c1}/evidence/verify`, `/v1/partner/insurance/surveys/${clm.c3}/accept`,
      '/v1/partner/insurance/surveyors', '/v1/partner/insurance/claims', `/v1/partner/insurance/claims/${clm.c1}/take-next`];
    for (const p of posts) {
      const r = await request(http).post(p).set(bearer('aAdmin')).send({ decision: 'approved', approvedMinor: '100' });
      expect([p, r.status]).toEqual([p, 404]);
    }
    for (const p of [`/v1/partner/insurance/claims/${clm.c5}`]) {
      for (const m of ['patch', 'put', 'delete'] as const) expect([p, m, (await request(http)[m](p).set(bearer('aAdmin')).send({ status: 'paid' })).status]).toEqual([p, m, 404]);
    }
    // nothing moved: A's approved claim is still approved, the paid one still paid
    expect((await admin.query(`SELECT status::text FROM insurance_claims WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [[clm.c5, clm.c8]])).rows.map((x) => x.status)).toEqual(['approved', 'paid']);
  });
});
