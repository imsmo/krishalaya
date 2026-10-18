// apps/api/src/__tests__/partner2c-loan-shelf.integration.spec.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF — LIVE proof (the real AppModule over
// HTTP, real Postgres + RLS: 0229's definer on the kv_partner axis for the terms, 0225's consent axis for the 30-day count).
//
// Fixture (the PARTNER-0 / 1a / 2a path): TWO lenders (A a bank, B an NBFC) each with an administrator and a viewer, and ONE insurer with a
// viewer; loan products inserted as the owner — for A two (one whose kind resolves to the platform's `loan_kind` registry, one whose kind id
// points at a `doc_type` value, i.e. unregistered as a loan kind) and for B one (priced differently), each written by a named AUTHOR the read
// must never return; applications inserted as the owner on A's products across TWO tenants — consented in the window, un-consented, an
// expired consent, consented but 40 days old — and one consented on B's product. `partner_console` ON (and `fintech` as seeded) for the run.
//   (1) A's viewer GET /v1/partner/loan-products → A's two products only (B's absent), the terms as stored (integer bps, the net as the integer
//       difference, minor-unit strings, the currency), the kind code or null, the documents resolved, the 30-day count = the CONSENTED
//       applications created in the last 30 days only (un-consented, expired and older excluded), computedAt + windowDays          [M1, M2]
//   (2) a deep-key assertion over EVERY response: no createdBy, updatedBy, applicantUserId, holder, name, phone, partnerId or tenantId property
//       (`defaultName` is the product's own name), and no author / applicant id anywhere in the JSON                                      [M3]
//   (3) GET :id for A's product → the terms + its count; B's id by A → 404 PARTNER_LOAN_PRODUCT_NOT_FOUND; a random id and a non-uuid the same [M1]
//   (4) the insurer's viewer (every partner role holds partner.applications.read) → an EMPTY shelf, never another lender's; at the database:
//       with app.partner_id unset the definer answers nothing; kv_partner SELECT FROM loan_products → 42501 (no table grant); kv_app cannot
//       call the definer without wearing the axis role; B's axis sees B's product only
//   (5) a tenant token → 401; `partner_console` OFF → 404; `fintech` OFF → the 1a behaviour (the partner realm does not consult the tenant
//       module flag: the shelf and the 1a dashboard both still answer 200); the viewer holds partner.applications.read
//   (6) ONE partner-realm audit row `partner.products.read` per call (list, detail, a refused probe), counts only
//   (7) NO write route exists: POST /v1/partner/loan-products, PATCH / PUT / DELETE /v1/partner/loan-products/:id → 404 (the absence pinned)
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
const phoneOf = () => `+9195${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
const FORBIDDEN_KEY = /^(createdBy|created_by|updatedBy|updated_by|applicantUserId|applicant_user_id|holder|holderUserId|name|phone|partnerId|partner_id|tenantId|tenant_id)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

run('PC-56 PARTNER-2c · a lender reads its own loan products\' terms and a consented 30-day count — never another lender\'s (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const LA = randomUUID(); const LB = randomUUID(); const IN = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const apps: string[] = [];
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  let kindCrop = ''; let docAadhaar = '';

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
  const get = async (key: string, path: string) => {
    const r = await request(http).get(path).set(bearer(key));
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
    `SELECT tenant_id, entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.products.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;
  /** n applications (owner) on `productKey` in `tenant`, `agoDays` old, with a consent for `consentFor` (live / expired) or none. */
  const plant = async (n: number, tenant: string, productKey: string, agoDays: number, consentFor: string | null, consent: 'live' | 'expired' = 'live') => {
    for (let i = 0; i < n; i++) {
      const id = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, status, created_at, created_by)
         VALUES ($1, $2, $3, 2500000, 'submitted', now() - make_interval(days => $4::int, mins => $5::int), $2) RETURNING id`,
        [tenant, people.applicant.id, prod[productKey], agoDays, i + 1])).rows[0].id as string;
      apps.push(id);
      if (consentFor) await admin.query(`INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, CASE $4 WHEN 'expired' THEN now() - interval '1 day' ELSE now() + interval '30 days' END)`,
        [people.applicant.id, consentFor, id, consent]);
    }
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Shelf Growers Collective'); await makeTenant(admin, T2, 'Shelf Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref) VALUES
      ($1, $2, 'Fixture Lender A', 'bank', 'LIC-TEST-2C01'), ($3, $4, 'Fixture Lender B', 'nbfc', NULL), ($5, $6, 'Fixture Insurer I', 'insurer', NULL)`,
      [LA, `p2ca_${sfx}`, LB, `p2cb_${sfx}`, IN, `p2ci_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Lender A admin'], ['aViewer', 'Lender A viewer'], ['bAdmin', 'Lender B admin'], ['bViewer', 'Lender B viewer'], ['iViewer', 'Insurer I viewer'],
      ['author', 'Platform product author'], ['applicant', 'Applicant Savitri Shelf'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n);
    await membership('aAdmin', LA, 'partner_admin'); await membership('aViewer', LA, 'partner_viewer');
    await membership('bAdmin', LB, 'partner_admin'); await membership('bViewer', LB, 'partner_viewer');
    await membership('iViewer', IN, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);
    kindCrop = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    docAadhaar = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'doc_type' AND code = 'aadhaar' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (key: string, partnerId: string, o: Record<string, unknown>, agoMin: number) => {
      prod[key] = (await admin.query(
        `INSERT INTO loan_products (partner_id, product_kind_id, default_name, currency_code, min_amount_minor, max_amount_minor, interest_apr_bps, subvention_bps,
           tenure_months_min, tenure_months_max, ltv_bps, collateral_kind, origination_fee_minor, origination_fee_bps, eligibility_rules, required_doc_type_ids,
           repayment_style, is_active, created_at, created_by, updated_by)
         VALUES ($1, $2, $3, 'INR', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, now() - make_interval(mins => $18::int), $19, $19) RETURNING id`,
        [partnerId, o.kind, o.name, o.min, o.max, o.apr, o.sub, o.tmin, o.tmax, o.ltv, o.collateral, o.feeMinor, o.feeBps, JSON.stringify(o.rules), JSON.stringify(o.docs),
          o.style, o.active, agoMin, people.author.id])).rows[0].id;
    };
    await product('a1', LA, { kind: kindCrop, name: 'Fixture seasonal credit', min: '5000000', max: '50000000', apr: 725, sub: 300, tmin: 6, tmax: 12, ltv: null, collateral: 'none',
      feeMinor: '150000', feeBps: 50, rules: { min_land_acres: 1, crops: ['cotton'] }, docs: [docAadhaar, randomUUID()], style: 'harvest_aligned', active: true }, 30);
    await product('a2', LA, { kind: docAadhaar, name: 'Fixture warehouse credit', min: '10000000', max: '90007199254740993', apr: 1100, sub: 0, tmin: null, tmax: null, ltv: 7000,
      collateral: 'nwr', feeMinor: '0', feeBps: 0, rules: {}, docs: [], style: 'bullet', active: false }, 20);
    await product('b1', LB, { kind: kindCrop, name: 'Fixture rival credit', min: '100000', max: '200000', apr: 1999, sub: 0, tmin: 3, tmax: 6, ltv: null, collateral: 'none',
      feeMinor: '0', feeBps: 0, rules: {}, docs: [], style: 'emi', active: true }, 10);
    // the book: on a1 — 2 consented (T1) + 1 consented (T2) in the window = 3; excluded: 1 un-consented, 1 expired consent, 1 consented but 40 days old
    await plant(2, T1, 'a1', 1, LA); await plant(1, T2, 'a1', 5, LA);
    await plant(1, T1, 'a1', 2, null); await plant(1, T1, 'a1', 3, LA, 'expired'); await plant(1, T2, 'a1', 40, LA);
    // on a2 — 1 consented (T2) = 1; on b1 — 1 consented for B (T1) and 1 consented for A on B's product (a consent to the wrong lender admits nothing)
    await plant(1, T2, 'a2', 4, LA);
    await plant(1, T1, 'b1', 2, LB); await plant(1, T1, 'b1', 2, LA);

    await setFlag('partner_console', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('fintech')]) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bViewer', 'iViewer']) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A\'s viewer reads A\'s two products only — the stored terms in integer bps and minor strings, the kind or null, the consented 30-day count', async () => {
    const r = await get('aViewer', '/v1/partner/loan-products');
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([prod.a2, prod.a1]);   // newest first
    expect(r.body.meta).toMatchObject({ computedAt: expect.stringMatching(ISO), windowDays: 30 });
    expect(r.body.data.find((x: { id: string }) => x.id === prod.a1)).toEqual({
      id: prod.a1, defaultName: 'Fixture seasonal credit', kind: { id: kindCrop, code: 'crop' }, currencyCode: 'INR', minAmountMinor: '5000000', maxAmountMinor: '50000000',
      interestAprBps: 725, subventionBps: 300, netAprBps: 425, tenureMonthsMin: 6, tenureMonthsMax: 12, ltvBps: null, collateralKind: 'none',
      originationFeeMinor: '150000', originationFeeBps: 50, eligibilityRules: { min_land_acres: 1, crops: ['cotton'] }, requiredDocuments: { count: 2, codes: ['aadhaar'] },
      repaymentStyle: 'harvest_aligned', active: true, createdAt: expect.stringMatching(ISO), updatedAt: expect.stringMatching(ISO), applications30d: 3,
    });
    expect(r.body.data.find((x: { id: string }) => x.id === prod.a2)).toMatchObject({
      kind: { id: docAadhaar, code: null }, maxAmountMinor: '90007199254740993', interestAprBps: 1100, subventionBps: 0, netAprBps: 1100, tenureMonthsMin: null, ltvBps: 7000,
      collateralKind: 'nwr', requiredDocuments: { count: 0, codes: [] }, repaymentStyle: 'bullet', active: false, applications30d: 1,
    });
    const json = JSON.stringify(r.body);
    expect(json).not.toContain(prod.b1); expect(json).not.toContain('Fixture rival credit'); expect(r.body.data.some((x: { interestAprBps: number }) => x.interestAprBps === 1999)).toBe(false);
    for (const x of r.body.data) for (const k of ['interestAprBps', 'subventionBps', 'netAprBps', 'originationFeeBps', 'applications30d']) expect([k, Number.isInteger(x[k])]).toEqual([k, true]);
    // B's own read: B's one product, and its count is B's consented one only (A's consent on B's product admits nothing)
    const b = await get('bViewer', '/v1/partner/loan-products');
    expect(b.body.data.map((x: { id: string; applications30d: number }) => [x.id, x.applications30d])).toEqual([[prod.b1, 1]]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) no person anywhere — every response (deep keys + values): no author, applicant, holder, name, phone, partner or tenant', async () => {
    await get('aViewer', '/v1/partner/loan-products');
    await get('aViewer', `/v1/partner/loan-products/${prod.a1}`);
    await get('aAdmin', '/v1/partner/loan-products');
    expect(responses.length).toBeGreaterThanOrEqual(3);
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['author', 'applicant', 'aAdmin', 'aViewer']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone)]).toEqual([p, false, false, false]);
      }
      for (const a of apps) expect(json.includes(a)).toBe(false);
      for (const t of [T1, T2, LA, LB]) expect(json.includes(t)).toBe(false);
    }
    // the definer's own column set holds no person
    const cols = (await asPartnerAxis(LA, (c) => c.query(`SELECT * FROM partner_loan_product_terms()`))).fields.map((f) => f.name);
    expect(cols.filter((c) => /created_by|updated_by|partner_id|applicant/.test(c))).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) one product by id → its terms and count; B\'s product by A → 404 by name (a random id and a non-uuid the same)', async () => {
    const one = await get('aViewer', `/v1/partner/loan-products/${prod.a1}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: prod.a1, defaultName: 'Fixture seasonal credit', interestAprBps: 725, subventionBps: 300, netAprBps: 425, applications30d: 3,
      computedAt: expect.stringMatching(ISO), windowDays: 30 });
    for (const id of [prod.b1, randomUUID(), 'not-a-uuid']) {
      const r = await get('aViewer', `/v1/partner/loan-products/${id}`);
      expect([id, r.status, r.body.error?.code]).toEqual([id, 404, 'PARTNER_LOAN_PRODUCT_NOT_FOUND']);
      expect(JSON.stringify(r.body)).not.toMatch(/not yours|another (lender|partner)|Fixture rival/i);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the insurer\'s member → an empty shelf; with no partner in scope the definer answers nothing; kv_partner has no table grant', async () => {
    const i = await get('iViewer', '/v1/partner/loan-products');
    expect([i.status, i.body.data]).toEqual([200, []]);
    expect((await get('iViewer', `/v1/partner/loan-products/${prod.a1}`)).status).toBe(404);
    // the 0090 NULL guard on 0229's definer
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_loan_product_terms()`))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_loan_product_terms($1)`, [prod.a1]))).rowCount).toBe(0);
    // the definer is the wall: no table privilege for kv_partner (0090's pricing-IP rule)
    expect(await errCode(asPartnerAxis(LA, (c) => c.query(`SELECT * FROM loan_products`)))).toBe('42501');
    // the consent wall the 30-day count stands on (0225's RLS policy — the count's own `partner_owns_application` predicate is a second copy of
    // it): on A's axis, with NO predicate at all, loan_applications admits only A's consented rows — 4 on a1 (3 in the window + 1 older), 1 on a2,
    // none un-consented, none with an expired consent, none on B's product
    expect((await asPartnerAxis(LA, (c) => c.query(`SELECT product_id, count(*)::int AS n FROM loan_applications GROUP BY product_id ORDER BY 2 DESC`))).rows)
      .toEqual([{ product_id: prod.a1, n: 4 }, { product_id: prod.a2, n: 1 }]);
    // B's axis sees B's product only; A's id through B's axis → nothing
    expect((await asPartnerAxis(LB, (c) => c.query(`SELECT id FROM partner_loan_product_terms()`))).rows.map((x) => x.id)).toEqual([prod.b1]);
    expect((await asPartnerAxis(LB, (c) => c.query(`SELECT id FROM partner_loan_product_terms($1)`, [prod.a1]))).rowCount).toBe(0);
    // kv_app cannot call the definer without wearing the axis role (0090's non-inheriting grant)
    const kvApp = new Pool({ connectionString: APP_URL, max: 1 });
    try { expect(await errCode(kvApp.query(`SELECT * FROM partner_loan_product_terms()`))).toBe('42501'); } finally { await kvApp.end(); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) a tenant token → 401; partner_console OFF → 404; fintech OFF → still 200 (the 1a dashboard\'s behaviour); the viewer holds the permission', async () => {
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['loan.manage'] });
    const t = await request(http).get('/v1/partner/loan-products').set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': T1 });
    expect([t.status, t.body.error?.code]).toEqual([401, 'PARTNER_SESSION_REQUIRED']);
    expect((jwt.decode(tok.aViewer) as { perms: string[] }).perms).toContain('partner.applications.read');
    expect((await admin.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'partner.applications.read' AND r.scope = 'partner'`)).rows[0].roles)
      .toBe('partner_admin,partner_checker,partner_maker,partner_viewer');
    const routes = ['/v1/partner/loan-products', `/v1/partner/loan-products/${prod.a1}`];
    await setFlag('fintech', false);
    try {
      for (const p of [...routes, '/v1/partner/dashboard']) {
        const r = await request(http).get(p).set(bearer('aViewer'));
        expect([p, r.status]).toEqual([p, 200]);
      }
    } finally {
      const b = backup.fintech;
      if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, ['fintech', b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]);
      for (const k of flagKeys('fintech')) await cache.del(k);
    }
    await setFlag('partner_console', false);
    try {
      for (const p of routes) {
        const r = await request(http).get(p).set(bearer('aViewer'));
        expect([p, r.status, r.body.error?.code === 'PARTNER_LOAN_PRODUCT_NOT_FOUND']).toEqual([p, 404, false]);
      }
    } finally { await setFlag('partner_console', true); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) one partner-realm audit row `partner.products.read` per call — the shelf, a product, a refused probe — counts only', async () => {
    const before = (await audits(LA)).length;
    await get('aAdmin', '/v1/partner/loan-products');
    await get('aAdmin', `/v1/partner/loan-products/${prod.a2}`);
    await get('aAdmin', `/v1/partner/loan-products/${prod.b1}`);
    const rows = (await audits(LA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['shelf', 'product', 'product']);
    expect(rows.map((r) => [r.tenant_id, r.entity_type, r.entity_id])).toEqual([[null, 'financial_partner', LA], [null, 'loan_product', prod.a2], [null, 'loan_product', prod.b1]]);
    const allowed = new Set(['partnerId', 'realm', 'surface', 'products', 'applications30d', 'found']);
    for (const r of rows) {
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      expect(r.new_value).toMatchObject({ partnerId: LA, realm: 'partner' });
      const json = JSON.stringify(r);
      expect(json).not.toMatch(/Fixture seasonal|cotton|harvest_aligned|interestApr|minAmount/); for (const a of apps) expect(json).not.toContain(a);
      expect(json).not.toContain(people.applicant.id); expect(json).not.toContain(people.author.id);
    }
    expect(rows[0].new_value).toMatchObject({ products: 2, applications30d: 4 });
    expect(rows[1].new_value).toMatchObject({ found: true, applications30d: 1 });
    expect(rows[2].new_value).toMatchObject({ found: false, applications30d: 0 });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) NO write route exists — create, change, replace or delete a loan product from the partner console answers 404', async () => {
    const calls: Array<[string, request.Test]> = [
      ['POST /', request(http).post('/v1/partner/loan-products').set(bearer('aAdmin')).send({ defaultName: 'x', interestAprBps: 1 })],
      ['PATCH /:id', request(http).patch(`/v1/partner/loan-products/${prod.a1}`).set(bearer('aAdmin')).send({ interestAprBps: 1 })],
      ['PUT /:id', request(http).put(`/v1/partner/loan-products/${prod.a1}`).set(bearer('aAdmin')).send({ interestAprBps: 1 })],
      ['DELETE /:id', request(http).delete(`/v1/partner/loan-products/${prod.a1}`).set(bearer('aAdmin'))],
    ];
    for (const [name, call] of calls) expect([name, (await call).status]).toEqual([name, 404]);
    expect((await admin.query(`SELECT interest_apr_bps, default_name FROM loan_products WHERE id = $1`, [prod.a1])).rows[0]).toEqual({ interest_apr_bps: 725, default_name: 'Fixture seasonal credit' });
  });
});
