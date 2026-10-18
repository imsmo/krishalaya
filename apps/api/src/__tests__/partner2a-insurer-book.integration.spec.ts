// apps/api/src/__tests__/partner2a-insurer-book.integration.spec.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK — LIVE proof (the real
// AppModule over HTTP, real Postgres + RLS: the kv_partner axis through 0228's definers and its narrowed column grant).
//
// Fixture (the PARTNER-0 / 1b path): TWO insurers (A, B) and ONE bank, each with an administrator and a viewer; products inserted as the owner
// for A (two) and B (one, priced differently); policies inserted as the owner on A's and B's products across TWO tenants with REAL
// holder_user_ids (named people with phones) and subject ids — for A one `active` (T1), one `proposed` (T2), one `cancelled` (T1); for B one
// `active` (T2). `partner_console` ON and `insurance` ON for the run.
//   (1) A's viewer GET /v1/partner/insurance/policies → only A's three, newest first; keyset page 2; the status filter; the FPO's PUBLIC name
//       present, `tenantId` ABSENT                                                                                                       [M3]
//   (2) a deep-key assertion over EVERY response (list, detail, products, product, dashboard): no holderUserId, subjectId, premiumPaymentId,
//       tenantId, holder, phone or name property, and no holder id / name / phone / subject id anywhere in the JSON; at the database, as
//       kv_partner (SET LOCAL ROLE + app.partner_id = A): SELECT holder_user_id / subject_id / premium_payment_id FROM insurance_policies →
//       42501, and the book definer's own column set holds none of them                                                                [M4]
//   (3) B's policy id by A → 404 PARTNER_POLICY_NOT_FOUND (an absent id the same); the bank's member → an empty book and zero counts, not an
//       error
//   (4) GET products → A's own two with A's own premium_calc, never B's; with app.partner_id unset every definer answers nothing / zeros
//   (5) a tenant token → 401; `partner_console` OFF → 404 on every route; `insurance` OFF → 404 PARTNER_INSURANCE_SWITCHED_OFF; the viewer holds
//       `partner.insurance.read` (its token, /me and role_permissions)
//   (6) ONE audit row `partner.insurance.read` per list / detail / product / dashboard call, counts only
//   (7) the dashboard equals the fixture: in force 1, Σ sum insured, proposed 1, FPOs 2, products 2, computedAt
//   (8) the machine book GET /v1/partner-api/insurance/policies (with `partner_api` ON for this one assertion) → 200 on the narrowed columns,
//       without holderUserId / subjectId (tenantId kept — the machine realm's choice, named); the flag OFF again in a `finally`
import 'reflect-metadata';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
const FORBIDDEN_KEY = /^(holderUserId|holder_user_id|holder|subjectId|subject_id|premiumPaymentId|premium_payment_id|tenantId|tenant_id|phone|name|parametricTriggers|createdBy|created_by)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

run('PC-56 PARTNER-2a · an insurer reads its own products and the policy facts on them — never a policyholder (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const IA = randomUUID(); const IB = randomUUID(); const BK = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const subjects: string[] = [];
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  const SUM_P1 = '16000000';

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
    `SELECT entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.insurance.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'insurance', 'partner_api']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Insurer Book Growers Collective'); await makeTenant(admin, T2, 'Insurer Book Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref) VALUES
      ($1, $2, 'Fixture Insurer A', 'insurer', 'LIC-TEST-2A01'), ($3, $4, 'Fixture Insurer B', 'insurer', NULL), ($5, $6, 'Fixture Bank K', 'bank', NULL)`,
      [IA, `p2aa_${sfx}`, IB, `p2ab_${sfx}`, BK, `p2ak_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Insurer A admin'], ['aViewer', 'Insurer A viewer'], ['bAdmin', 'Insurer B admin'], ['bViewer', 'Insurer B viewer'],
      ['kAdmin', 'Bank K admin'], ['kViewer', 'Bank K viewer'], ['h1', 'Holder Savitri One'], ['h2', 'Holder Ramesh Two'], ['h3', 'Holder Hetal Three'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n);
    await membership('aAdmin', IA, 'partner_admin'); await membership('aViewer', IA, 'partner_viewer');
    await membership('bAdmin', IB, 'partner_admin'); await membership('bViewer', IB, 'partner_viewer');
    await membership('kAdmin', BK, 'partner_admin'); await membership('kViewer', BK, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (key: string, partnerId: string, name: string, calc: Record<string, unknown>, subsidy: number, commission: number) => {
      prod[key] = (await admin.query(`INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc, govt_subsidy_bps, our_commission_bps)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`, [partnerId, kind, name, JSON.stringify(calc), subsidy, commission])).rows[0].id;
    };
    await product('a1', IA, 'Fixture cattle cover', { kind: 'pct_of_sum_insured', bps: 320 }, 0, 250);
    await product('a2', IA, 'Fixture crop cover', { kind: 'flat_minor', amountMinor: '48000' }, 4000, 0);
    await product('b1', IB, 'Fixture rival cover', { kind: 'pct_of_sum_insured', bps: 777 }, 0, 0);
    /** A policy (owner) `agoMin` minutes old — with a REAL holder and a subject id the read must never return. */
    const policy = async (key: string, tenantId: string, holderKey: string, productKey: string, status: string, sum: string, premium: string, agoMin: number) => {
      const subject = randomUUID(); subjects.push(subject);
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until, created_at, created_by)
         VALUES ($1, $2, $3, 'animal', $4, $5, $6, $7::policy_status, current_date, current_date + 365, now() - make_interval(mins => $8::int), $2) RETURNING id`,
        [tenantId, people[holderKey].id, prod[productKey], subject, sum, premium, status, agoMin])).rows[0].id;
    };
    await policy('p1', T1, 'h1', 'a1', 'active', SUM_P1, '512000', 30);      // oldest
    await policy('p2', T2, 'h2', 'a1', 'proposed', '8000000', '256000', 20);
    await policy('p3', T1, 'h3', 'a2', 'cancelled', '5000000', '48000', 10);  // newest of A's
    await policy('q1', T2, 'h2', 'b1', 'active', '9000000', '699300', 5);     // B's

    await setFlag('partner_console', true); await setFlag('insurance', true); await setFlag('partner_api', false);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('insurance'), ...flagKeys('partner_api')]) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bViewer', 'kViewer']) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A\'s viewer reads only A\'s policies, newest first; keyset page 2; the status filter; the FPO\'s public name, never its id', async () => {
    const all = await get('aViewer', '/v1/partner/insurance/policies');
    expect([all.status, all.status === 200 ? null : all.body]).toEqual([200, null]);
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual([pol.p3, pol.p2, pol.p1]);
    expect(all.body.meta).toMatchObject({ nextCursor: null, limit: 25, computedAt: expect.any(String) });
    const p1 = await get('aViewer', '/v1/partner/insurance/policies', { limit: 2 });
    const p2 = await get('aViewer', '/v1/partner/insurance/policies', { limit: 2, cursor: p1.body.meta.nextCursor });
    expect([p1.body.data.map((x: { id: string }) => x.id), p2.body.data.map((x: { id: string }) => x.id), p2.body.meta.nextCursor]).toEqual([[pol.p3, pol.p2], [pol.p1], null]);
    const active = await get('aViewer', '/v1/partner/insurance/policies', { status: 'active' });
    expect(active.body.data.map((x: { id: string }) => x.id)).toEqual([pol.p1]);
    const proposed = await get('aViewer', '/v1/partner/insurance/policies', { status: 'proposed' });
    expect(proposed.body.data.map((x: { id: string }) => x.id)).toEqual([pol.p2]);
    expect((await get('aViewer', '/v1/partner/insurance/policies', { status: 'lapsing' })).status).toBe(422);   // not a state of the machine — refused by the query schema
    const row = all.body.data.find((x: { id: string }) => x.id === pol.p1);
    expect(row).toEqual({ id: pol.p1, policyNo: null, productId: prod.a1, productName: 'Fixture cattle cover', fpoName: 'Insurer Book Growers Collective', subjectType: 'animal',
      status: 'active', sumInsuredMinor: SUM_P1, premiumMinor: '512000', validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/) });
    expect(all.body.data.find((x: { id: string }) => x.id === pol.p2).fpoName).toBe('Insurer Book Dairy Collective');
    expect(JSON.stringify(all.body)).not.toContain(pol.q1);
    expect(JSON.stringify(all.body)).not.toContain(T1); expect(JSON.stringify(all.body)).not.toContain(T2);
    // B's own read: B's one policy only
    const b = await get('bViewer', '/v1/partner/insurance/policies');
    expect(b.body.data.map((x: { id: string }) => x.id)).toEqual([pol.q1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) no identity anywhere — every response (deep keys + values); at the database kv_partner cannot select the holder, the subject or the payment', async () => {
    await get('aViewer', `/v1/partner/insurance/policies/${pol.p1}`);
    await get('aViewer', '/v1/partner/insurance/products');
    await get('aViewer', `/v1/partner/insurance/products/${prod.a1}`);
    await get('aViewer', '/v1/partner/insurance/dashboard');
    expect(responses.length).toBeGreaterThanOrEqual(10);
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['h1', 'h2', 'h3']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone), json.includes(people[p].phone.slice(-6))]).toEqual([p, false, false, false, false]);
      }
      for (const s of subjects) expect(json.includes(s)).toBe(false);
    }
    // the database wall: the narrowed column grant (0228.3) — 42501, not "no rows"
    for (const col of ['holder_user_id', 'subject_id', 'premium_payment_id', 'parametric_triggers', 'created_by']) {
      expect([col, await errCode(asPartnerAxis(IA, (c) => c.query(`SELECT ${col} FROM insurance_policies`)))]).toEqual([col, '42501']);
    }
    // what kv_partner may read through the 0090 policy alone (no WHERE): A's three, on the facts columns
    expect((await asPartnerAxis(IA, (c) => c.query(`SELECT id FROM insurance_policies`))).rows.map((x) => x.id).sort()).toEqual([pol.p1, pol.p2, pol.p3].sort());
    // the definer's own column set holds no identity
    const cols = (await asPartnerAxis(IA, (c) => c.query(`SELECT * FROM partner_insurance_book(NULL, NULL, NULL, 100)`))).fields.map((f) => f.name);
    expect(cols.filter((c) => /holder|subject_id|payment|parametric|created_by/.test(c))).toEqual([]);
    const one = (await asPartnerAxis(IA, (c) => c.query(`SELECT * FROM partner_insurance_policy($1)`, [pol.p1]))).fields.map((f) => f.name);
    expect(one.filter((c) => /holder|subject_id|payment|parametric|created_by/.test(c))).toEqual([]);
    // kv_app cannot call a definer without wearing the axis role (0090's non-inheriting grant)
    const kvApp = new Pool({ connectionString: APP_URL, max: 1 });
    try { expect(await errCode(kvApp.query(`SELECT * FROM partner_insurance_book(NULL, NULL, NULL, 100)`))).toBe('42501'); } finally { await kvApp.end(); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) B\'s policy by A → 404 (an absent id the same); the bank\'s member → an empty book and zero counts, not an error', async () => {
    for (const id of [pol.q1, randomUUID(), 'not-a-uuid']) {
      const r = await get('aViewer', `/v1/partner/insurance/policies/${id}`);
      expect([id, r.status, r.body.error?.code]).toEqual([id, 404, 'PARTNER_POLICY_NOT_FOUND']);
      expect(JSON.stringify(r.body)).not.toMatch(/not yours|another (insurer|partner)/i);
    }
    expect((await get('aViewer', `/v1/partner/insurance/products/${prod.b1}`)).status).toBe(404);
    const k = await get('kViewer', '/v1/partner/insurance/policies');
    expect([k.status, k.body.data]).toEqual([200, []]);
    const kd = await get('kViewer', '/v1/partner/insurance/dashboard');
    expect(kd.status).toBe(200);
    expect(kd.body.data).toEqual({ computedAt: expect.any(String), policies: 0, inForce: { count: 0, sumInsuredMinor: '0' }, proposed: 0, fpos: 0, products: 0 });
    expect((await get('kViewer', '/v1/partner/insurance/products')).body.data).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) A\'s own products with A\'s own premium_calc — never B\'s; with no partner in scope every definer answers nothing', async () => {
    const r = await get('aViewer', '/v1/partner/insurance/products');
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { id: string }) => x.id).sort()).toEqual([prod.a1, prod.a2].sort());
    const a1 = r.body.data.find((x: { id: string }) => x.id === prod.a1);
    expect(a1).toMatchObject({ productName: 'Fixture cattle cover', kind: { code: null }, formula: { kind: 'pct_of_sum_insured', bps: 320 }, storedTerms: { kind: 'pct_of_sum_insured', bps: 320 },
      govtSubsidyBps: 0, ourCommissionBps: 250, isParametric: false, active: true, policies: { active: 1, proposed: 1 } });
    expect(r.body.data.find((x: { id: string }) => x.id === prod.a2)).toMatchObject({ formula: { kind: 'flat_minor', amountMinor: '48000' }, govtSubsidyBps: 4000, policies: { cancelled: 1 } });
    expect(JSON.stringify(r.body)).not.toMatch(/777|Fixture rival cover/);
    const one = await get('aViewer', `/v1/partner/insurance/products/${prod.a2}`);
    expect(one.body.data).toMatchObject({ id: prod.a2, productName: 'Fixture crop cover', computedAt: expect.any(String) });
    // the 0090 NULL guard on every 0228 definer
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_products()`))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_book(NULL, NULL, NULL, 100)`))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_insurance_policy($1)`, [pol.p1]))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT policies, in_force, fpos FROM partner_insurance_counts()`))).rows[0]).toEqual({ policies: '0', in_force: '0', fpos: '0' });
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT count(*)::int AS n FROM insurance_policies`))).rows[0].n).toBe(0);
    // and B's axis sees B's product and policy only
    expect((await asPartnerAxis(IB, (c) => c.query(`SELECT id FROM partner_insurance_products()`))).rows.map((x) => x.id)).toEqual([prod.b1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) a tenant token → 401; partner_console OFF → 404; insurance OFF → 404 by name; the viewer holds partner.insurance.read', async () => {
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['insurance.manage'] });
    const t = await request(http).get('/v1/partner/insurance/policies').set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': T1 });
    expect([t.status, t.body.error?.code]).toEqual([401, 'PARTNER_SESSION_REQUIRED']);
    // the viewer's permission: in its token, in /me, in role_permissions
    expect((jwt.decode(tok.aViewer) as { perms: string[] }).perms).toContain('partner.insurance.read');
    const me = await request(http).get('/v1/partner/me').set(bearer('aViewer'));
    expect(me.body.data.person.permissions).toContain('partner.insurance.read');
    expect(me.body.data.organisation.kind).toBe('insurer');
    expect((await admin.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'partner.insurance.read'`)).rows[0].roles)
      .toBe('partner_admin,partner_checker,partner_maker,partner_viewer');
    const routes = ['/v1/partner/insurance/dashboard', '/v1/partner/insurance/products', `/v1/partner/insurance/products/${prod.a1}`, '/v1/partner/insurance/policies', `/v1/partner/insurance/policies/${pol.p1}`];
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

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) one partner-realm audit row `partner.insurance.read` per call — list, detail, products, product, dashboard — counts only', async () => {
    const before = (await audits(IA)).length;
    await get('aAdmin', '/v1/partner/insurance/policies', { status: 'active' });
    await get('aAdmin', `/v1/partner/insurance/policies/${pol.p2}`);
    await get('aAdmin', '/v1/partner/insurance/products');
    await get('aAdmin', `/v1/partner/insurance/products/${prod.a1}`);
    await get('aAdmin', '/v1/partner/insurance/dashboard');
    const rows = (await audits(IA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['policies', 'policy', 'products', 'products', 'dashboard']);
    expect(rows.map((r) => [r.entity_type, r.entity_id])).toEqual([['financial_partner', IA], ['insurance_policy', pol.p2], ['financial_partner', IA], ['insurance_product', prod.a1], ['financial_partner', IA]]);
    const allowed = new Set(['partnerId', 'realm', 'surface', 'listed', 'status', 'page', 'found', 'products', 'policies', 'inForce', 'proposed', 'fpos']);
    for (const r of rows) {
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      expect(r.new_value).toMatchObject({ partnerId: IA, realm: 'partner' });
      const json = JSON.stringify(r);
      expect(json).not.toContain(SUM_P1); expect(json).not.toContain(people.h1.id); expect(json).not.toContain(people.h2.id);
    }
    expect(rows[0].new_value).toMatchObject({ listed: 1, status: 'active' });
    expect(rows[4].new_value).toMatchObject({ policies: 3, inForce: 1, proposed: 1, fpos: 2, products: 2 });
    // a refused probe is recorded too (A asked for B's policy id)
    const n = (await audits(IA)).length;
    await get('aAdmin', `/v1/partner/insurance/policies/${pol.q1}`);
    const probe = (await audits(IA)).slice(n);
    expect(probe.map((r) => [r.entity_id, r.new_value.found])).toEqual([[pol.q1, false]]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) the dashboard equals the fixture: in force 1 + Σ sum insured, proposed 1, FPOs 2, products 2, computedAt', async () => {
    const d = await get('aViewer', '/v1/partner/insurance/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.data).toEqual({ computedAt: expect.any(String), policies: 3, inForce: { count: 1, sumInsuredMinor: SUM_P1 }, proposed: 1, fpos: 2, products: 2 });
    expect(JSON.stringify(d.body)).not.toMatch(/claim|reserve|payout|premiumTotal|settled|receivable/i);
    const b = await get('bViewer', '/v1/partner/insurance/dashboard');
    expect(b.body.data).toMatchObject({ policies: 1, inForce: { count: 1, sumInsuredMinor: '9000000' }, proposed: 0, fpos: 1, products: 1 });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (8)
  it('(8) the machine book still answers on the narrowed columns — without holderUserId / subjectId (partner_api ON for this one assertion)', async () => {
    const handle = randomBytes(8).toString('hex'); const secret = randomBytes(32).toString('base64url');
    await admin.query(`INSERT INTO partner_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, is_active) VALUES ($1, 'insurer book', $2, $3, $4::jsonb, 1000, true)`,
      [IA, `kv_pk_test_${handle}`, createHash('sha256').update(secret, 'utf8').digest('hex'), JSON.stringify(['insurance:book:read'])]);
    await setFlag('partner_api', true);
    let r: request.Response;
    try {
      r = await request(http).get('/v1/partner-api/insurance/policies').set({ authorization: `Bearer kv_pk_test_${handle}.${secret}` });
    } finally { await setFlag('partner_api', false); }
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    expect(r.body.data.map((x: { id: string }) => x.id).sort()).toEqual([pol.p1, pol.p2, pol.p3].sort());
    expect(deepKeys(r.body).filter((k) => /^(holderUserId|subjectId|premiumPaymentId|holder_user_id|subject_id)$/.test(k))).toEqual([]);
    const json = JSON.stringify(r.body);
    for (const p of ['h1', 'h2', 'h3']) expect(json.includes(people[p].id)).toBe(false);
    for (const s of subjects) expect(json.includes(s)).toBe(false);
    // the machine realm keeps the organisation's id (named): an FPO is not a person, and a machine caller has no public-name resolver
    expect(r.body.data.find((x: { id: string }) => x.id === pol.p1)).toMatchObject({ tenantId: T1, productId: prod.a1, subjectType: 'animal', status: 'active', sumInsuredMinor: SUM_P1 });
    expect((await request(http).get('/v1/partner-api/insurance/policies').set({ authorization: `Bearer kv_pk_test_${handle}.${secret}` })).status).toBe(404);
  });
});
