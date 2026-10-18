// apps/api/src/__tests__/partner2a-authoring-lockdown.integration.spec.ts · PC-56 PARTNER-2a · the FIRST commit (survey F-1 / F-3 / F-5; founder
// Q5 + Q7 + Q10) — LIVE proof (the real AppModule over HTTP, real Postgres + RLS): the tenant realm authors NOTHING.
//
//   (1) `insurance` ON, a `tenant_admin` token holding `insurance.manage` → POST /v1/insurance/authoring/products → 403
//       INSURANCE_PRODUCT_PLATFORM_AUTHORED with its sentence; `insurance_products` count unchanged — with the old body shape, with a
//       malformed body and with no Idempotency-Key alike (the refusal answers before anything else)                                   [M2]
//   (2) PATCH …/products/:id on a product inserted as the owner for another partner → 403 by name, the row BYTE-EQUAL (row_to_json before =
//       after); POST …/policies/:id/issue → 403 INSURANCE_ISSUE_NOT_ON_PLATFORM, the policy untouched (status, policy_no); the tenant's own
//       book read still answers (a tenant read under tenant RLS, named)
//   (3) `insurance` OFF → 404 on EVERY authoring route (the five)                                                                         [M1]
//   (4) the validator: `{pct_of_sum_insured: 2.0}` is refused by the pure `parsePremiumCalc` (`isAuthorablePremiumCalc`) — NO HTTP path that
//       writes a product survives to prove it live (named; the api unit premium-calc spec carries the cases).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { isAuthorablePremiumCalc } from '../modules/insurance/domain/premium-calc';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

run('PC-56 PARTNER-2a · the tenant realm authors no insurance product and issues no policy (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;
  const T1 = randomUUID(); const P_INS = randomUUID(); const P_OTHER = randomUUID();
  const ids = { admin: '', holder: '', kind: '', product: '', otherProduct: '', policy: '' };
  let tok = ''; let flagBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const h = () => ({ authorization: `Bearer ${tok}`, 'x-tenant-id': T1 });
  const productRow = async (id: string) => (await admin.query(`SELECT row_to_json(p)::text AS j FROM insurance_products p WHERE id = $1`, [id])).rows[0].j as string;
  const policyRow = async (id: string) => (await admin.query(`SELECT row_to_json(p)::text AS j FROM insurance_policies p WHERE id = $1`, [id])).rows[0].j as string;
  const products = async () => (await admin.query(`SELECT count(*)::int AS n FROM insurance_products`)).rows[0].n as number;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    flagBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'insurance'`)).rows[0] ?? null;
    await makeTenant(admin, T1, 'Lockdown Fixture Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Lockdown Fixture Insurer', 'insurer'), ($3, $4, 'Lockdown Fixture Other Insurer', 'insurer')`,
      [P_INS, `p2l_${sfx}`, P_OTHER, `p2lo_${sfx}`]);
    // the kind column is an unconstrained FK into lookup_values (the `insurance_kind` type is not registered — survey F-13): any value
    ids.kind = (await admin.query(`SELECT id FROM lookup_values WHERE tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (partnerId: string, name: string, calc: Record<string, unknown>) => (await admin.query(
      `INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc, govt_subsidy_bps, our_commission_bps)
       VALUES ($1, $2, $3, $4::jsonb, 4000, 250) RETURNING id`, [partnerId, ids.kind, name, JSON.stringify(calc)])).rows[0].id as string;
    ids.product = await product(P_INS, 'Lockdown fixture crop cover', { kind: 'pct_of_sum_insured', bps: 200 });
    ids.otherProduct = await product(P_OTHER, 'Lockdown fixture other cover', { kind: 'flat_minor', amountMinor: '48000' });
    for (const k of ['admin', 'holder'] as const) {
      ids[k] = randomUUID();
      await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [ids[k], phoneOf(), k === 'admin' ? 'Lockdown FPO admin' : 'Lockdown holder']);
    }
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [ids.admin, T1]);
    ids.policy = (await admin.query(
      `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
       VALUES ($1, $2, $3, 'crop_season', $4, 10000000, 200000, 'proposed', current_date, current_date + 180) RETURNING id`,
      [T1, ids.holder, ids.product, randomUUID()])).rows[0].id;
    await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
    for (const k of flagKeys('insurance')) await cache.del(k);
    tok = mintToken(app, { userId: ids.admin, tenantId: T1, roles: ['tenant_admin'], perms: ['insurance.manage'] });
  }, 180_000);

  afterAll(async () => {
    if (flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'insurance'`,
      [flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) a tenant_admin cannot create a product: 403 INSURANCE_PRODUCT_PLATFORM_AUTHORED, nothing inserted — old body, malformed body, no key alike', async () => {
    const before = await products();
    const oldShape = { partnerId: P_OTHER, productKindId: ids.kind, defaultName: 'Priced by a stranger', premiumCalc: { pct_of_sum_insured: 2.0 } };
    for (const [body, key] of [[oldShape, randomUUID()], [{ nonsense: true }, randomUUID()], [oldShape, null]] as const) {
      const r = await request(http).post('/v1/insurance/authoring/products').set({ ...h(), ...(key ? { 'idempotency-key': key } : {}) }).send(body);
      expect([r.status, r.body.error?.code]).toEqual([403, 'INSURANCE_PRODUCT_PLATFORM_AUTHORED']);
      expect(r.body.error.message).toMatch(/authored by the platform/);
    }
    expect(await products()).toBe(before);
    expect((await admin.query(`SELECT count(*)::int AS n FROM insurance_products WHERE default_name = 'Priced by a stranger'`)).rows[0].n).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) PATCH another partner\'s product → 403 by name, the row byte-equal; issue → 403 INSURANCE_ISSUE_NOT_ON_PLATFORM, the policy untouched', async () => {
    const before = await productRow(ids.otherProduct);
    for (const patch of [{ premiumCalc: { pct_of_sum_insured: 9 } }, { isActive: false }, { defaultName: 'Renamed by a stranger' }]) {
      const r = await request(http).patch(`/v1/insurance/authoring/products/${ids.otherProduct}`).set(h()).send(patch);
      expect([r.status, r.body.error?.code]).toEqual([403, 'INSURANCE_PRODUCT_PLATFORM_AUTHORED']);
    }
    expect(await productRow(ids.otherProduct)).toBe(before);
    const policyBefore = await policyRow(ids.policy);
    const iss = await request(http).post(`/v1/insurance/authoring/policies/${ids.policy}/issue`).set(h()).send({ policyNo: 'INVENTED-0001' });
    expect([iss.status, iss.body.error?.code]).toEqual([403, 'INSURANCE_ISSUE_NOT_ON_PLATFORM']);
    expect(iss.body.error.message).toMatch(/not issued on the platform/);
    expect(await policyRow(ids.policy)).toBe(policyBefore);
    expect((await admin.query(`SELECT status::text, policy_no FROM insurance_policies WHERE id = $1`, [ids.policy])).rows[0]).toEqual({ status: 'proposed', policy_no: null });
    // the tenant's OWN book read stays (a tenant read under tenant RLS, behind the flag — named, survey F-12)
    const book = await request(http).get('/v1/insurance/authoring/book').set(h());
    expect(book.status).toBe(200);
    expect(book.body.data.map((x: { id: string }) => x.id)).toEqual([ids.policy]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) `insurance` OFF → 404 on every authoring route', async () => {
    await setFlag('insurance', false);
    try {
      const routes: Array<[string, string]> = [
        ['post', '/v1/insurance/authoring/products'], ['patch', `/v1/insurance/authoring/products/${ids.product}`],
        ['post', `/v1/insurance/authoring/policies/${ids.policy}/issue`], ['get', '/v1/insurance/authoring/book'], ['get', '/v1/insurance/authoring/insights'],
      ];
      for (const [m, p] of routes) {
        const r = await (request(http) as any)[m](p).set({ ...h(), 'idempotency-key': randomUUID() }).send({});
        expect([m, p, r.status]).toEqual([m, p, 404]);
      }
    } finally { await setFlag('insurance', true); }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the one premium shape: a float percentage is refused by the pure validator (no HTTP write path survives to prove it live)', () => {
    expect(isAuthorablePremiumCalc({ pct_of_sum_insured: 2.0 })).toBe(false);
    expect(isAuthorablePremiumCalc({ kind: 'pct_of_sum_insured', bps: 200 })).toBe(true);
  });
});
