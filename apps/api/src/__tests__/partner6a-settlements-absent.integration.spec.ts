// apps/api/src/__tests__/partner6a-settlements-absent.integration.spec.ts · PC-56 PARTNER-6a · WHERE A CLAIM IS NOT PAID — the LIVE proof (the
// real AppModule over HTTP, real Postgres + RLS) behind W260 `/insurer/settlements` (a read of PARTNER-3a's existing, audited claims COUNTS)
// and W261 `/insurer/settlements/[id]` (an honest page that reads nothing). This wave adds NO route, NO definer, NO grant and NO migration;
// this spec is its only `apps/api` file (the 4c / 5b precedent). It proves that what the two pages say is true of the platform underneath:
//
//   (1) an insurer A with claims on its products moved through the REAL tenant routes (file → schedule-survey → record-survey → decide) into
//       approved, partially_approved and rejected, plus an intimated one in each of TWO cooperatives; a rival insurer B with its own claim; a
//       lender. `GET /v1/partner/insurance/claims/counts` (the IST financial year the database answers) returns A's counts by status — paid
//       0 — B's claim never counted for A; the lender gets 200 with zero counts, never a 5xx.
//   (2) TODAY'S TRUTH PINNED: the tenant settle route on A's approved claim → 403 INSURANCE_SETTLEMENT_NOT_ON_PLATFORM with its sentence; the
//       claim still `approved`; no ledger transaction or entry, no payout and no new outbox event by the claim id.
//   (3) deep-key and deep-value absence over every counts response: no claimant / payout / bank / surveyor / decision-note / phone / name /
//       tenant key at any depth; the claimant's distinctive name, phone and account tail, the decision note and the approved amounts in no body.
//   (4) THE 42501 PROBE under `SET LOCAL ROLE kv_partner`: insurance_claims, payouts, payout_batches, bank_accounts, wallet_accounts,
//       ledger_entries, settlement_statements (it exists — 0006:201) and the nine of 0232:189-190 → 42501 each (RE-PROVED here: 0230–0232's
//       asserts are LOCAL — M6 kills here); `pg_proc` holds no partner_%settle%, partner_%payout%, partner_%statement%, partner_%invoice%.
//   (5) ONE partner-realm audit row `partner.claims.read` (surface `claims_counts`) per counts read, counts only.
//   (6) absence → 404: every settlement / payout / statement / invoice address a partner console could call.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9195${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');
const SENTENCE = 'Claim settlement is not made on the platform yet: an insurer\'s funding leg does not exist. Nothing has been paid.';
const MANAGE = ['insurance.manage', 'insurance.enrol'];

/** The fixture's DISTINCTIVE values — none can occur by chance in a partner response. */
const CLAIMANT_NAME = 'Claimant Philomena Zaragoza-Quist';
const ACCOUNT_TAIL = '9317';
const NOTE = 'DECISIONNOTE-P6A-natural-cause-survey-conclusive';
const APPROVED = '7314159'; const PARTIAL = '2718281';
const FORBIDDEN_KEY = /^(claimantUserId|claimant_user_id|claimant|claimantName|description|surveyorUserId|surveyor_user_id|surveyor|surveyReport|survey_report|notes|note|decisionNote|decision_note|payoutId|payout_id|payout|bankAccount|bank_account|bankAccountId|accountLast4|account_last4|ifsc|holderName|holder_name|tenantId|tenant_id|createdBy|created_by|phone|name|fullName|full_name|amount|amountMinor|approvedMinor)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}

run('PC-56 PARTNER-6a · where a claim is not paid — counts only, settlement refused, nothing of a payment reaches an insurer (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const IA = randomUUID(); const IB = randomUUID(); const BK = randomUUID();
  const u: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const clm: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    u[key] = { id, phone, name };
  };
  const tenantRole = (key: string, tenantId: string, code: string) => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [u[key].id, tenantId, code]);
  const membership = (key: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`, [u[key].id, partnerId, role]);
  const H = (key: string) => ({ authorization: `Bearer ${tok[key]}`, 'x-tenant-id': T1 });
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  const counts = async (key: string, query: Record<string, string> = {}) => {
    const r = await request(http).get('/v1/partner/insurance/claims/counts').query(query).set(bearer(key));
    responses.push(r.body);
    return r;
  };
  const claimStatus = async (id: string) => (await admin.query(`SELECT status::text AS s FROM insurance_claims WHERE id = $1`, [id])).rows[0].s as string;
  const moneyBy = async (claimId: string) => ({
    txns: (await admin.query(`SELECT count(*)::int AS n FROM ledger_transactions WHERE reference_id = $1 OR idempotency_key LIKE $2`, [claimId, `%${claimId}%`])).rows[0].n as number,
    entries: (await admin.query(`SELECT count(*)::int AS n FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id WHERE t.reference_id = $1 OR t.idempotency_key LIKE $2`, [claimId, `%${claimId}%`])).rows[0].n as number,
    payouts: (await admin.query(`SELECT count(*)::int AS n FROM payouts WHERE reference_id = $1 OR idempotency_key LIKE $2`, [claimId, `%${claimId}%`])).rows[0].n as number,
    outbox: (await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1`, [claimId])).rows[0].n as number,
    settledEvents: (await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type IN ('insurance.claim_settled', 'payout.completed')`, [claimId])).rows[0].n as number,
  });
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.claims.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'insurance']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Settlement Absent Growers Collective'); await makeTenant(admin, T2, 'Settlement Absent Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES
      ($1, $2, 'Fixture Settlement Insurer A', 'insurer'), ($3, $4, 'Fixture Settlement Insurer B', 'insurer'), ($5, $6, 'Fixture Settlement Bank K', 'bank')`,
      [IA, `p6aa_${sfx}`, IB, `p6ab_${sfx}`, BK, `p6ak_${sfx}`]);
    for (const [k, n] of [['agent', 'Absent desk agent'], ['admin', 'Absent desk admin'], ['admin2', 'Absent desk admin two'], ['member', 'Absent surveyor member'],
      ['h1', CLAIMANT_NAME], ['h2', 'Absent holder two'], ['h3', 'Absent rival holder'],
      ['aViewer', 'Insurer A viewer'], ['aAdmin', 'Insurer A admin'], ['bViewer', 'Insurer B viewer'], ['kViewer', 'Bank K viewer']] as const) await user(k, n);
    await tenantRole('agent', T1, 'insurance_agent'); await tenantRole('admin', T1, 'tenant_admin'); await tenantRole('admin2', T1, 'tenant_admin');
    await tenantRole('member', T1, 'insurance_agent'); await tenantRole('h1', T1, 'farmer'); await tenantRole('h2', T2, 'farmer'); await tenantRole('h3', T2, 'farmer');
    await membership('aViewer', IA, 'partner_viewer'); await membership('aAdmin', IA, 'partner_admin');
    await membership('bViewer', IB, 'partner_viewer'); await membership('kViewer', BK, 'partner_viewer');
    // the claimant's own bank account — a payee the insurer must never see (bank_accounts is user / tenant owned, 0003:136-149)
    await admin.query(`INSERT INTO bank_accounts (user_id, account_kind, account_last4, ifsc, holder_name, vault_ref, is_primary) VALUES ($1, 'bank', $2, 'ZZZZ0P6A001', $3, $4, true)`,
      [u.h1.id, ACCOUNT_TAIL, CLAIMANT_NAME, `vault-p6a-${sfx}`]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code <> 'claim_event' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (partnerId: string, name: string) => (await admin.query(
      `INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc) VALUES ($1, $2, $3, '{"kind":"pct_of_sum_insured","bps":200}'::jsonb) RETURNING id`,
      [partnerId, kind, name])).rows[0].id as string;
    const pa = await product(IA, 'Fixture settlement cover'); const pb = await product(IB, 'Fixture rival cover');
    const policy = async (key: string, tenantId: string, holder: string, productId: string) => {
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
         VALUES ($1, $2, $3, 'animal', $4, 10000000, 200000, 'active', current_date - 30, current_date + 300) RETURNING id`, [tenantId, u[holder].id, productId, randomUUID()])).rows[0].id;
    };
    await policy('a1', T1, 'h1', pa); await policy('a2', T2, 'h2', pa); await policy('b1', T2, 'h3', pb);
    const ev = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'claim_event' AND code = 'flood' AND tenant_id IS NULL`)).rows[0].id;
    // the second cooperative's claims, written as the owner (A's intimated one, and B's — which A must never count)
    const ownerClaim = async (key: string, tenantId: string, policyKey: string, holder: string) => {
      clm[key] = (await admin.query(
        `INSERT INTO insurance_claims (tenant_id, policy_id, claimant_user_id, event_date, event_type_id, status, intimated_within_72h, created_by)
         VALUES ($1, $2, $3, current_date - 2, $4, 'intimated', true, $3) RETURNING id`, [tenantId, pol[policyKey], u[holder].id, ev])).rows[0].id;
    };
    await ownerClaim('a2', T2, 'a2', 'h2'); await ownerClaim('b1', T2, 'b1', 'h3');

    await setFlag('partner_console', true); await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('insurance')]) await cache.del(k);
    for (const k of ['agent', 'admin', 'admin2']) tok[k] = mintToken(app, { userId: u[k].id, tenantId: T1, roles: k === 'agent' ? ['insurance_agent'] : ['tenant_admin'], perms: MANAGE });
    // the partner people sign in through the partner realm's own OTP door
    for (const k of ['aViewer', 'aAdmin', 'bViewer', 'kViewer']) {
      const w = Math.floor(Date.now() / 1000 / 60);
      for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
        for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
      const { code } = await otp.issue(u[k].phone);
      const v = await request(http).post('/v1/partner/auth/verify').send({ phone: u[k].phone, code });
      expect([k, v.status]).toEqual([k, 201]);
      tok[k] = v.body.data.accessToken;
    }
    // A's claims on the FIRST cooperative, moved through the REAL tenant routes: filed at the desk for the holder, surveyed by a member, decided
    // by a manager who is neither the filer nor the surveyor (the 3a lock-down holds)
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);   // the India-time day
    const file = async (key: string) => {
      const r = await request(http).post('/v1/insurance/claims').set({ ...H('agent'), 'idempotency-key': `idem-${randomUUID()}` })
        .send({ policyId: pol.a1, eventDate: today, eventTypeCode: 'flood', description: `filed at the desk for the holder (${key})` });
      expect([key, r.status, r.status === 201 ? null : r.body]).toEqual([key, 201, null]);
      clm[key] = r.body.data.id;
    };
    const surveyAndDecide = async (key: string, decision: string, approvedMinor?: string) => {
      const s = await request(http).post(`/v1/insurance/claims/${clm[key]}/schedule-survey`).set(H('admin')).send({ surveyorUserId: u.member.id });
      expect([key, s.status]).toEqual([key, 201]);
      const rec = await request(http).post(`/v1/insurance/claims/${clm[key]}/record-survey`).set(H('admin')).send({ damagePercent: 40, notes: 'measured on site' });
      expect([key, rec.status]).toEqual([key, 201]);
      const d = await request(http).post(`/v1/insurance/claims/${clm[key]}/decide`).set(H('admin2')).send({ decision, ...(approvedMinor ? { approvedMinor } : {}), note: NOTE });
      expect([key, d.status, d.body.data?.status]).toEqual([key, 201, decision]);
    };
    for (const k of ['approved', 'partial', 'rejected', 'intimated']) await file(k);
    await surveyAndDecide('approved', 'approved', APPROVED);
    await surveyAndDecide('partial', 'partially_approved', PARTIAL);
    await surveyAndDecide('rejected', 'rejected');
  }, 300_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`,
        [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
      if (cache) for (const x of flagKeys(k)) await cache.del(x).catch(() => undefined);
    }
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND tenant_id = ANY($1::uuid[])`, [[T1, T2]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A\'s counts by status across two cooperatives — approved, partially approved, rejected, intimated; paid 0; B never counted for A; the lender gets zero, not an error', async () => {
    expect([await claimStatus(clm.approved), await claimStatus(clm.partial), await claimStatus(clm.rejected), await claimStatus(clm.intimated)])
      .toEqual(['approved', 'partially_approved', 'rejected', 'intimated']);
    const r = await counts('aViewer');
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    const d = r.body.data;
    expect(d).toMatchObject({ timeZone: 'Asia/Kolkata', fy: expect.stringMatching(/^\d{4}-\d{2}$/), from: expect.stringMatching(/^\d{4}-04-01$/), total: 5,
      decided: { approved: 1, partiallyApproved: 1, rejected: 1 } });
    expect(d.byStatus).toMatchObject({ approved: 1, partially_approved: 1, rejected: 1, intimated: 2 });
    expect(d.byStatus.paid ?? 0).toBe(0);
    // what W260 prints: approved + partially approved (integer addition of counts), and paid 0
    expect([d.byStatus.approved + d.byStatus.partially_approved, d.byStatus.paid ?? 0]).toEqual([2, 0]);
    // B sees its own one claim and none of A's; A's counts never include B's
    const b = await counts('bViewer');
    expect([b.status, b.body.data.total, b.body.data.byStatus.intimated, b.body.data.byStatus.approved ?? 0]).toEqual([200, 1, 1, 0]);
    // the lender: 200 with zero counts — refused nothing it could not read, and never a 5xx
    const k = await counts('kViewer');
    expect(k.status).toBe(200);
    expect(k.body.data).toMatchObject({ total: 0, decided: { approved: 0, partiallyApproved: 0, rejected: 0 } });
    expect(Object.values(k.body.data.byStatus).every((n) => n === 0)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) TODAY\'S TRUTH: the tenant settle route on A\'s approved claim → 403 by name; the claim still approved; no ledger, payout or outbox row by the claim id', async () => {
    const before = await moneyBy(clm.approved);
    expect([before.txns, before.entries, before.payouts, before.settledEvents]).toEqual([0, 0, 0, 0]);
    for (const headers of [{ ...H('admin'), 'idempotency-key': `settle-${randomUUID()}` }, H('admin2')]) {
      const s = await request(http).post(`/v1/insurance/claims/${clm.approved}/settle`).set(headers);
      expect([s.status, s.body.error?.code, s.body.error?.message]).toEqual([403, 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM', SENTENCE]);
    }
    const s2 = await request(http).post(`/v1/insurance/claims/${clm.partial}/settle`).set(H('admin'));
    expect([s2.status, s2.body.error?.code]).toEqual([403, 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM']);
    expect([await claimStatus(clm.approved), await claimStatus(clm.partial)]).toEqual(['approved', 'partially_approved']);
    const after = await moneyBy(clm.approved);
    expect(after).toEqual(before);
    expect(await moneyBy(clm.partial)).toMatchObject({ txns: 0, entries: 0, payouts: 0, settledEvents: 0 });
    // and the partner's own counts still say paid 0
    expect((await counts('aViewer')).body.data.byStatus.paid ?? 0).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) deep-key and deep-value absence over every counts response: no person, payee, account, surveyor, note, amount or tenant', async () => {
    await counts('aAdmin'); await counts('aViewer', { from: '2025-04-01', to: '2027-04-01' });
    expect(responses.length).toBeGreaterThanOrEqual(5);
    const people = ['h1', 'h2', 'h3', 'member', 'agent', 'admin', 'admin2'];
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      expect(deepKeys(body).filter((k) => /payout|bank|account|ifsc|settle|ledger|wallet|amount|minor/i.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of people) expect([p, json.includes(u[p].id), json.includes(u[p].name), json.includes(u[p].phone)]).toEqual([p, false, false, false]);
      for (const v of [CLAIMANT_NAME, ACCOUNT_TAIL, 'ZZZZ0P6A001', NOTE, APPROVED, PARTIAL, T1, T2, 'measured on site']) expect([v, json.includes(v)]).toEqual([v, false]);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) THE WALL IS THE GRANT: kv_partner → 42501 on every money / claim / payee table (settlement_statements included); no settle / payout / statement / invoice definer exists', async () => {
    const TABLES = ['insurance_claims', 'payouts', 'payout_batches', 'bank_accounts', 'wallet_accounts', 'ledger_entries', 'ledger_transactions', 'settlement_statements',
      // the nine of 0232:189-190
      'loan_disbursement_runs', 'loan_disbursement_run_items', 'kcc_drawl_ledger', 'loan_restructures', 'credit_scores', 'credit_score_consents'];
    expect((await admin.query(`SELECT to_regclass('public.settlement_statements') IS NOT NULL AS ok`)).rows[0].ok).toBe(true);
    for (const t of TABLES) {
      expect((await admin.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`])).rows[0].ok).toBe(true);
      const c = await admin.connect();
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
        await c.query(`SELECT set_config('app.partner_id', $1, true)`, [IA]);
        expect([t, await errCode(c.query(`SELECT 1 FROM ${t} LIMIT 1`))]).toEqual([t, '42501']);
      } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    }
    // and no write privilege either (asserted at the catalogue, without attempting a write)
    for (const t of TABLES) {
      const priv = (await admin.query(`SELECT has_table_privilege('kv_partner', $1, 'INSERT') OR has_table_privilege('kv_partner', $1, 'UPDATE') OR has_table_privilege('kv_partner', $1, 'DELETE') AS w`, [`public.${t}`])).rows[0].w;
      expect([t, priv]).toEqual([t, false]);
    }
    const names = async (pattern: string) => (await admin.query(`SELECT proname FROM pg_proc WHERE proname LIKE $1 ORDER BY proname`, [pattern])).rows.map((r) => r.proname as string);
    for (const p of ['partner\\_%settle%', 'partner\\_%payout%', 'partner\\_%statement%', 'partner\\_%invoice%']) expect([p, await names(p)]).toEqual([p, []]);
    // the counts definer the page reads is the 0230 one, callable by the axis only
    const def = (await admin.query(`SELECT has_function_privilege('kv_partner', oid, 'EXECUTE') AS axis, has_function_privilege('kv_app', oid, 'EXECUTE') AS app
      FROM pg_proc WHERE proname = 'partner_insurance_claim_counts'`)).rows;
    expect(def).toEqual([{ axis: true, app: false }]);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) ONE partner-realm audit row per counts read — surface claims_counts, counts only, no person and no amount', async () => {
    const before = (await audits(IA)).length;
    await counts('aAdmin'); await counts('aViewer');
    const rows = (await audits(IA)).slice(before);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => [r.entity_type, r.entity_id, r.new_value.surface])).toEqual([['financial_partner', IA, 'claims_counts'], ['financial_partner', IA, 'claims_counts']]);
    const allowed = new Set(['partnerId', 'realm', 'surface', 'from', 'to', 'claims']);
    for (const r of rows) {
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      expect(r.new_value).toMatchObject({ partnerId: IA, realm: 'partner', claims: 5 });
      const json = JSON.stringify(r);
      for (const v of [u.h1.id, CLAIMANT_NAME, ACCOUNT_TAIL, NOTE, APPROVED, PARTIAL]) expect([v, json.includes(v)]).toEqual([v, false]);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) absence → 404: no settlement, release, settle, payout, statement or invoice address exists in the partner realm; nothing moved', async () => {
    for (const p of ['/v1/partner/settlements', `/v1/partner/settlements/${clm.approved}`, '/v1/partner/insurance/settlements', `/v1/partner/insurance/settlements/${clm.approved}`,
      '/v1/partner/payouts', '/v1/partner/statements', '/v1/partner/invoices', `/v1/partner/insurance/claims/${clm.approved}/payout`]) {
      const r = await request(http).get(p).set(bearer('aAdmin'));
      expect([p, r.status]).toEqual([p, 404]);
    }
    for (const p of ['/v1/partner/insurance/settlements/release', `/v1/partner/insurance/claims/${clm.approved}/settle`, '/v1/partner/settlements',
      `/v1/partner/settlements/${clm.approved}/release`, '/v1/partner/payouts']) {
      const r = await request(http).post(p).set(bearer('aAdmin')).send({ claims: [clm.approved] });
      expect([p, r.status]).toEqual([p, 404]);
    }
    expect([await claimStatus(clm.approved), await claimStatus(clm.partial)]).toEqual(['approved', 'partially_approved']);
    expect(await moneyBy(clm.approved)).toMatchObject({ txns: 0, entries: 0, payouts: 0, settledEvents: 0 });
  });
});
