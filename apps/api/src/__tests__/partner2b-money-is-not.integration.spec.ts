// apps/api/src/__tests__/partner2b-money-is-not.integration.spec.ts · PC-56 PARTNER-2b · WHERE THE MONEY IS NOT — LIVE proof (the real AppModule
// over HTTP, real Postgres + RLS: the kv_partner axis through 0228's definers and its narrowed column grant; no migration this wave).
//
// Fixture (the PARTNER-2a path): insurer A with two products and THREE policies across TWO tenants with REAL holder_user_ids (named people with
// phones) and subject ids — `proposed` ×2 (T1 older, T2 newer) and `active` ×1 (T1); insurer B with one `proposed` (T2); a bank K. A's four
// members (admin, checker, maker, viewer), B's viewer, K's viewer. `partner_console` ON and `insurance` ON for the run.
//   (1) A's viewer GET /v1/partner/insurance/issuance → A's two `proposed` only, newest first; `active` ABSENT; B's ABSENT; the FPO's PUBLIC
//       name; the queue row's allow-list exactly; keyset page 2; a `status` parameter is refused (the queue is proposed by construction); a
//       deep-key assertion over EVERY response of the run — no holderUserId, subjectId, premiumPaymentId, tenantId, holder, phone or name
//       property, and no holder id / name / phone / subject id anywhere in the JSON                                                  [M3, M4]
//   (2) all four partner roles read it (admin, checker, maker, viewer) — `partner.insurance.read` as 0228 granted it
//   (3) the bank's member → an empty queue, not an error
//   (4) `insurance` OFF → 404 PARTNER_INSURANCE_SWITCHED_OFF; `partner_console` OFF → 404; a tenant token → 401
//   (5) ONE audit row per call of the read each page makes — issuance (the queue), dashboard (the premiums counts), products (the parametric
//       counts) — counts only, never a figure of a policy or a holder
//   (6) NO route exists for an issue act, an export or a parametric run: POST /v1/partner/insurance/policies/:id/issue, POST …/exports,
//       POST …/parametric/run (and their GET twins) → 404 — the absence pinned; nothing written
//   (7) the machine realm unchanged: one smoke call GET /v1/partner-api/insurance/policies with `partner_api` ON, OFF again in a `finally`
import 'reflect-metadata';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const FORBIDDEN_KEY = /^(holderUserId|holder_user_id|holder|subjectId|subject_id|premiumPaymentId|premium_payment_id|tenantId|tenant_id|phone|name|parametricTriggers|createdBy|created_by)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

run('PC-56 PARTNER-2b · the insurer reads the proposals awaiting the farmer\'s payment — and no issue, export or run exists (integration)', () => {
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
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.insurance.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;
  const ids = (r: request.Response) => r.body.data.map((x: { id: string }) => x.id);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'insurance', 'partner_api']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Issuance Queue Growers Collective'); await makeTenant(admin, T2, 'Issuance Queue Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref) VALUES
      ($1, $2, 'Fixture Insurer A', 'insurer', 'LIC-TEST-2B01'), ($3, $4, 'Fixture Insurer B', 'insurer', NULL), ($5, $6, 'Fixture Bank K', 'bank', NULL)`,
      [IA, `p2ba_${sfx}`, IB, `p2bb_${sfx}`, BK, `p2bk_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Insurer A admin'], ['aChecker', 'Insurer A checker'], ['aMaker', 'Insurer A maker'], ['aViewer', 'Insurer A viewer'],
      ['bViewer', 'Insurer B viewer'], ['kViewer', 'Bank K viewer'], ['h1', 'Holder Savitri One'], ['h2', 'Holder Ramesh Two'], ['h3', 'Holder Hetal Three'],
      ['h4', 'Holder Meera Four'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n);
    await membership('aAdmin', IA, 'partner_admin'); await membership('aChecker', IA, 'partner_checker');
    await membership('aMaker', IA, 'partner_maker'); await membership('aViewer', IA, 'partner_viewer');
    await membership('bViewer', IB, 'partner_viewer'); await membership('kViewer', BK, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (key: string, partnerId: string, name: string, calc: Record<string, unknown>, parametric: boolean) => {
      prod[key] = (await admin.query(`INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc, govt_subsidy_bps, our_commission_bps, is_parametric)
        VALUES ($1, $2, $3, $4::jsonb, 0, 0, $5) RETURNING id`, [partnerId, kind, name, JSON.stringify(calc), parametric])).rows[0].id;
    };
    await product('a1', IA, 'Fixture cattle cover', { kind: 'pct_of_sum_insured', bps: 320 }, false);
    await product('a2', IA, 'Fixture rain-index cover', { parametric: { index: 'fixture' } }, true);
    await product('b1', IB, 'Fixture rival cover', { kind: 'pct_of_sum_insured', bps: 777 }, false);
    /** A policy (owner) `agoMin` minutes old — with a REAL holder and a subject id the read must never return. */
    const policy = async (key: string, tenantId: string, holderKey: string, productKey: string, status: string, sum: string, premium: string, agoMin: number) => {
      const subject = randomUUID(); subjects.push(subject);
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until, created_at, created_by)
         VALUES ($1, $2, $3, 'animal', $4, $5, $6, $7::policy_status, current_date, current_date + 365, now() - make_interval(mins => $8::int), $2) RETURNING id`,
        [tenantId, people[holderKey].id, prod[productKey], subject, sum, premium, status, agoMin])).rows[0].id;
    };
    await policy('pa1', T1, 'h1', 'a1', 'proposed', '16000000', '512000', 30);   // A, proposed, older
    await policy('aa1', T1, 'h3', 'a2', 'active', '5000000', '48000', 25);       // A, active (on the parametric product) — never in the queue
    await policy('pa2', T2, 'h2', 'a1', 'proposed', '8000000', '256000', 20);    // A, proposed, newer
    await policy('pb1', T2, 'h4', 'b1', 'proposed', '9000000', '699300', 5);     // B, proposed — never A's

    await setFlag('partner_console', true); await setFlag('insurance', true); await setFlag('partner_api', false);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('insurance'), ...flagKeys('partner_api')]) await cache.del(k);
    for (const k of ['aAdmin', 'aChecker', 'aMaker', 'aViewer', 'bViewer', 'kViewer']) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A\'s viewer reads A\'s proposals only, newest first — never `active`, never B\'s; the queue row\'s allow-list; keyset; no identity anywhere', async () => {
    const q = await get('aViewer', '/v1/partner/insurance/issuance');
    expect([q.status, q.status === 200 ? null : q.body]).toEqual([200, null]);
    expect(ids(q)).toEqual([pol.pa2, pol.pa1]);
    expect(JSON.stringify(q.body)).not.toContain(pol.aa1);
    expect(JSON.stringify(q.body)).not.toContain(pol.pb1);
    expect(q.body.meta).toMatchObject({ nextCursor: null, limit: 25, computedAt: expect.any(String) });
    expect(q.body.data[0]).toEqual({ id: pol.pa2, productId: prod.a1, productName: 'Fixture cattle cover', fpoName: 'Issuance Queue Dairy Collective', subjectType: 'animal',
      sumInsuredMinor: '8000000', premiumMinor: '256000', proposedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(q.body.data[1]).toMatchObject({ id: pol.pa1, fpoName: 'Issuance Queue Growers Collective', sumInsuredMinor: '16000000', premiumMinor: '512000' });
    // keyset: page 1 of one, page 2 of one, then nothing
    const p1 = await get('aViewer', '/v1/partner/insurance/issuance', { limit: 1 });
    const p2 = await get('aViewer', '/v1/partner/insurance/issuance', { limit: 1, cursor: p1.body.meta.nextCursor });
    expect([ids(p1), ids(p2)]).toEqual([[pol.pa2], [pol.pa1]]);
    // the queue is proposed BY CONSTRUCTION: asking it for another status is refused by the query schema, not answered
    expect((await get('aViewer', '/v1/partner/insurance/issuance', { status: 'active' })).status).toBe(422);
    // B's own queue holds B's one proposal
    expect(ids(await get('bViewer', '/v1/partner/insurance/issuance'))).toEqual([pol.pb1]);
    // the deep-key wall over every response so far
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['h1', 'h2', 'h3', 'h4']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone), json.includes(people[p].phone.slice(-6))]).toEqual([p, false, false, false, false]);
      }
      for (const s of subjects) expect(json.includes(s)).toBe(false);
      expect(json.includes(T1) || json.includes(T2)).toBe(false);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) all four partner roles read the queue — admin, checker, maker, viewer (partner.insurance.read as 0228 granted it)', async () => {
    for (const k of ['aAdmin', 'aChecker', 'aMaker', 'aViewer']) {
      const r = await get(k, '/v1/partner/insurance/issuance');
      expect([k, r.status, ids(r)]).toEqual([k, 200, [pol.pa2, pol.pa1]]);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) the bank\'s member → an empty queue, not an error', async () => {
    const k = await get('kViewer', '/v1/partner/insurance/issuance');
    expect([k.status, k.body.data, k.body.meta.nextCursor]).toEqual([200, [], null]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) insurance OFF → 404 by name; partner_console OFF → 404; a tenant token → 401', async () => {
    await setFlag('insurance', false);
    try {
      const r = await request(http).get('/v1/partner/insurance/issuance').set(bearer('aViewer'));
      expect([r.status, r.body.error?.code]).toEqual([404, 'PARTNER_INSURANCE_SWITCHED_OFF']);
    } finally { await setFlag('insurance', true); }
    await setFlag('partner_console', false);
    try {
      const r = await request(http).get('/v1/partner/insurance/issuance').set(bearer('aViewer'));
      expect([r.status, r.body.error?.code === 'PARTNER_INSURANCE_SWITCHED_OFF']).toEqual([404, false]);
    } finally { await setFlag('partner_console', true); }
    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['insurance.manage'] });
    const t = await request(http).get('/v1/partner/insurance/issuance').set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': T1 });
    expect([t.status, t.body.error?.code]).toEqual([401, 'PARTNER_SESSION_REQUIRED']);
    // and back ON: the queue answers again
    expect((await get('aViewer', '/v1/partner/insurance/issuance')).status).toBe(200);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) one audit row per call of the read each page makes — the queue, the premiums counts, the parametric counts — counts only', async () => {
    const before = (await audits(IA)).length;
    const iss = await get('aAdmin', '/v1/partner/insurance/issuance');          // /insurer/issuance
    const dash = await get('aAdmin', '/v1/partner/insurance/dashboard');        // /insurer/premiums (the two counts)
    const prods = await get('aAdmin', '/v1/partner/insurance/products');        // /insurer/parametric (the two counts)
    expect([iss.status, dash.status, prods.status]).toEqual([200, 200, 200]);
    const rows = (await audits(IA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['issuance', 'dashboard', 'products']);
    expect(rows.map((r) => [r.entity_type, r.entity_id])).toEqual([['financial_partner', IA], ['financial_partner', IA], ['financial_partner', IA]]);
    expect(rows[0].new_value).toEqual({ partnerId: IA, realm: 'partner', surface: 'issuance', listed: 2, status: 'proposed', page: 'first' });
    const allowed = new Set(['partnerId', 'realm', 'surface', 'listed', 'status', 'page', 'found', 'products', 'policies', 'inForce', 'proposed', 'fpos']);
    for (const r of rows) {
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      const json = JSON.stringify(r);
      for (const x of ['16000000', '512000', '8000000', '256000', people.h1.id, people.h2.id, people.h1.phone]) expect([x, json.includes(x)]).toEqual([x, false]);
    }
    // what the premiums page prints: two COUNTS (in force, proposed) — the same read the dashboard makes; nothing about money is new
    expect([dash.body.data.inForce.count, dash.body.data.proposed]).toEqual([1, 2]);
    // what the parametric page prints: own products flagged parametric (1) and the active policies on them (1)
    const parametric = prods.body.data.filter((p: { isParametric: boolean }) => p.isParametric);
    expect([parametric.length, parametric.reduce((a: number, p: { policies: Record<string, number> }) => a + (p.policies.active ?? 0), 0)]).toEqual([1, 1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) NO route for an issue act, an export or a parametric run — 404, the absence pinned; nothing written', async () => {
    const before = (await admin.query(`SELECT status::text AS s, policy_no FROM insurance_policies WHERE id = $1`, [pol.pa1])).rows[0];
    const probes: Array<['post' | 'get', string]> = [
      ['post', `/v1/partner/insurance/policies/${pol.pa1}/issue`], ['post', '/v1/partner/insurance/issuance'], ['post', '/v1/partner/insurance/issuance/batch'],
      ['post', '/v1/partner/insurance/exports'], ['get', '/v1/partner/insurance/exports'], ['post', '/v1/partner/insurance/premiums/export'], ['get', '/v1/partner/insurance/premiums'],
      ['post', '/v1/partner/insurance/parametric/run'], ['get', '/v1/partner/insurance/parametric'], ['get', '/v1/partner/insurance/parametric/trigger-audit'],
      ['post', '/v1/partner/insurance/reports/pack'],
    ];
    for (const [m, p] of probes) {
      const r = await request(http)[m](p).set({ ...bearer('aAdmin'), 'idempotency-key': randomUUID() }).send({});
      expect([m, p, r.status]).toEqual([m, p, 404]);
    }
    expect((await admin.query(`SELECT status::text AS s, policy_no FROM insurance_policies WHERE id = $1`, [pol.pa1])).rows[0]).toEqual(before);
    expect(before).toEqual({ s: 'proposed', policy_no: null });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) the machine realm unchanged — one smoke call with partner_api ON (OFF again in a finally)', async () => {
    const handle = randomBytes(8).toString('hex'); const secret = randomBytes(32).toString('base64url');
    await admin.query(`INSERT INTO partner_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, is_active) VALUES ($1, 'insurer book', $2, $3, $4::jsonb, 1000, true)`,
      [IA, `kv_pk_test_${handle}`, createHash('sha256').update(secret, 'utf8').digest('hex'), JSON.stringify(['insurance:book:read'])]);
    await setFlag('partner_api', true);
    let r: request.Response;
    try {
      r = await request(http).get('/v1/partner-api/insurance/policies').set({ authorization: `Bearer kv_pk_test_${handle}.${secret}` });
    } finally { await setFlag('partner_api', false); }
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    expect(r.body.data.map((x: { id: string }) => x.id).sort()).toEqual([pol.pa1, pol.aa1, pol.pa2].sort());
    expect(deepKeys(r.body).filter((k) => /^(holderUserId|subjectId|premiumPaymentId|holder_user_id|subject_id)$/.test(k))).toEqual([]);
    expect((await request(http).get('/v1/partner-api/insurance/policies').set({ authorization: `Bearer kv_pk_test_${handle}.${secret}` })).status).toBe(404);
  });
});
