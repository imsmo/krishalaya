// apps/api/src/__tests__/partner3a-settlement-lockdown.integration.spec.ts · PC-56 PARTNER-3a · the FIRST commit (survey F-1 / F-2 / F-7;
// founder Q1 / Q2 / Q3 / Q5) — LIVE proof (the real AppModule over HTTP, real Postgres + RLS): the tenant realm moves no claim money, the
// claimant is the holder, the decider is never the filer or the surveyor, the surveyor is a member and never the claimant.
//
// Fixture: one tenant with an `insurance_agent` who is ALSO a farmer member (enrol + manage — the multi-role member of survey F-2), two
// `tenant_admin`s, a member who will survey, a suspended member, two holders with ACTIVE policies on an insurer's product, a third holder whose
// `person` policy covers herself, and an outsider (no role in the tenant). `insurance` ON for (1)–(5), OFF for one assertion in (2).
//   (1) an `approved` claim → POST …/settle by the agent → 403 INSURANCE_SETTLEMENT_NOT_ON_PLATFORM with its sentence; NO ledger transaction
//       (by reference or by the old idempotency key); the claim still `approved`; the policy still `active`                                 [M1]
//   (2) the same for a `tenant_admin` (with and without an Idempotency-Key); `insurance` OFF → 404
//   (3) founder Q2: the agent files on holder H1's policy → `claimant_user_id` = H1, `created_by` = the agent, the audit row's actor = the agent
//       with `assisted: true`; H2's own filing (the mobile app's route) still records H2, `assisted: false`; a death claim on a `person` policy
//       whose holder is the subject → 422 INSURANCE_CLAIM_NEEDS_NOMINEE, nothing written; an accident on it is the holder's own
//   (4) founder Q5: schedule-survey with the claimant → 422 INSURANCE_SURVEYOR_INVALID; with an outsider → 422; with a SUSPENDED member → 422;
//       with an active member → 200
//   (5) founder Q2/Q3: decide by the surveyor → 409 INSURANCE_DECIDER_CONFLICT; by the filer (the agent) → 409; by another manager → 200 — the
//       FPO desk still decides (the lock-down does not over-reach)
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const SENTENCE = 'Claim settlement is not made on the platform yet: an insurer\'s funding leg does not exist. Nothing has been paid.';
const MANAGE = ['insurance.manage', 'insurance.enrol'];

run('PC-56 PARTNER-3a · the tenant realm settles no claim; the claimant is the holder; deciders and surveyors are separated (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;
  const T = randomUUID(); const INS = randomUUID();
  const u: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const clm: Record<string, string> = {};
  const tok: Record<string, string> = {};
  let flagBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const h = (who: string) => ({ authorization: `Bearer ${tok[who]}`, 'x-tenant-id': T });
  const role = (userKey: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [u[userKey], T, code]);
  const claimRow = async (id: string) => (await admin.query(`SELECT status::text, claimant_user_id, created_by, surveyor_user_id, approved_minor::text FROM insurance_claims WHERE id = $1`, [id])).rows[0];
  const policyStatus = async (id: string) => (await admin.query(`SELECT status::text FROM insurance_policies WHERE id = $1`, [id])).rows[0].status as string;
  const ledgerFor = async (claimId: string) => (await admin.query(
    `SELECT count(*)::int AS n FROM ledger_transactions WHERE (reference_type = 'insurance_claim' AND reference_id = $1) OR idempotency_key = $2`, [claimId, `insurance-claim-settle:${claimId}`])).rows[0].n as number;
  const file = (who: string, body: Record<string, unknown>) => request(http).post('/v1/insurance/claims').set({ ...h(who), 'idempotency-key': `idem-${randomUUID()}` }).send(body);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    flagBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'insurance'`)).rows[0] ?? null;
    await makeTenant(admin, T, 'Lockdown Claims Collective');
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Lockdown Fixture Insurer', 'insurer')`, [INS, `p3l_${randomUUID().replace(/-/g, '').slice(0, 10)}`]);
    for (const k of ['agent', 'admin', 'admin2', 'member', 'suspended', 'h1', 'h2', 'h3', 'outsider']) {
      u[k] = randomUUID();
      await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [u[k], phoneOf(), `Lockdown ${k}`]);
    }
    await role('agent', 'insurance_agent'); await role('agent', 'farmer');   // the multi-role member (survey F-2)
    await role('admin', 'tenant_admin'); await role('admin2', 'tenant_admin');
    await role('member', 'insurance_agent'); await role('suspended', 'insurance_agent');
    for (const k of ['h1', 'h2', 'h3']) await role(k, 'farmer');
    await admin.query(`INSERT INTO tenant_member_suspensions (tenant_id, user_id, reason, suspended_by) VALUES ($1, $2, 'Suspended by the desk for the lockdown fixture', $3)`, [T, u.suspended, u.admin]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = (await admin.query(`INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc) VALUES ($1, $2, 'Lockdown cover', '{"kind":"pct_of_sum_insured","bps":200}'::jsonb) RETURNING id`, [INS, kind])).rows[0].id;
    const policy = async (key: string, holder: string, subjectType: string, subjectId: string | null) => {
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, 10000000, 200000, 'active', current_date - 30, current_date + 300) RETURNING id`, [T, u[holder], product, subjectType, subjectId])).rows[0].id;
    };
    await policy('p1', 'h1', 'animal', randomUUID()); await policy('p2', 'h2', 'crop_season', randomUUID()); await policy('p3', 'h3', 'person', u.h3);
    const flood = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'claim_event' AND code = 'flood' AND tenant_id IS NULL`)).rows[0].id;
    // an APPROVED claim on H1's policy, written as the owner (the desk's decision already made)
    clm.approved = (await admin.query(
      `INSERT INTO insurance_claims (tenant_id, policy_id, claimant_user_id, event_date, event_type_id, status, intimated_within_72h, survey_report, approved_minor, created_by)
       VALUES ($1, $2, $3, current_date - 5, $4, 'approved', true, '{"damagePercent": 40}'::jsonb, 4000000, $3) RETURNING id`, [T, pol.p1, u.h1, flood])).rows[0].id;
    await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
    for (const k of flagKeys('insurance')) await cache.del(k);
    tok.agent = mintToken(app, { userId: u.agent, tenantId: T, roles: ['insurance_agent', 'farmer'], perms: MANAGE });
    tok.admin = mintToken(app, { userId: u.admin, tenantId: T, roles: ['tenant_admin'], perms: MANAGE });
    tok.admin2 = mintToken(app, { userId: u.admin2, tenantId: T, roles: ['tenant_admin'], perms: MANAGE });
    tok.member = mintToken(app, { userId: u.member, tenantId: T, roles: ['insurance_agent'], perms: ['insurance.manage'] });
    for (const k of ['h1', 'h2', 'h3']) tok[k] = mintToken(app, { userId: u[k], tenantId: T, roles: ['farmer'], perms: ['insurance.enrol'] });
  }, 180_000);

  afterAll(async () => {
    if (flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'insurance'`,
      [flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND tenant_id = $1`, [T]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) an approved claim → settle by the insurance agent → 403 by name; no ledger transaction; the claim still approved; the policy still active', async () => {
    const r = await request(http).post(`/v1/insurance/claims/${clm.approved}/settle`).set({ ...h('agent'), 'idempotency-key': `settle-${randomUUID()}` });
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([403, 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM', SENTENCE]);
    expect(await ledgerFor(clm.approved)).toBe(0);
    expect(await claimRow(clm.approved)).toMatchObject({ status: 'approved', approved_minor: '4000000' });
    expect(await policyStatus(pol.p1)).toBe('active');
    expect((await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type IN ('insurance.claim_settled', 'insurance.policy_claimed')`, [clm.approved])).rows[0].n).toBe(0);
  });

  it('(2) the same for a tenant_admin (with and without an Idempotency-Key); insurance OFF → 404', async () => {
    for (const headers of [{ ...h('admin'), 'idempotency-key': `settle-${randomUUID()}` }, h('admin')]) {
      const r = await request(http).post(`/v1/insurance/claims/${clm.approved}/settle`).set(headers);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([403, 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM', SENTENCE]);
    }
    expect(await ledgerFor(clm.approved)).toBe(0);
    expect([(await claimRow(clm.approved)).status, await policyStatus(pol.p1)]).toEqual(['approved', 'active']);
    await setFlag('insurance', false);
    try {
      const r = await request(http).post(`/v1/insurance/claims/${clm.approved}/settle`).set(h('admin'));
      expect(r.status).toBe(404);
    } finally { await setFlag('insurance', true); }
  });

  it('(3) founder Q2: the agent files ON BEHALF OF the holder (claimant = H1, filer audited, assisted); H2\'s own filing records H2; a death on one\'s own cover needs a nominee', async () => {
    const a = await file('agent', { policyId: pol.p1, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'flood', description: 'filed at the desk for the holder' });
    expect([a.status, a.status === 201 ? null : a.body]).toEqual([201, null]);
    clm.assisted = a.body.data.id;
    expect(a.body.data.claimantUserId).toBe(u.h1);
    expect(await claimRow(clm.assisted)).toMatchObject({ status: 'intimated', claimant_user_id: u.h1, created_by: u.agent });
    const audit = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'insurance.claim.filed' AND entity_id = $1`, [clm.assisted])).rows;
    expect(audit).toEqual([{ actor_user_id: u.agent, new_value: { policyId: pol.p1, assisted: true } }]);
    // the holder's own filing — the route the mobile app calls (apps/mobile insurance.api.ts POST insurance/claims) — still records the holder
    const own = await file('h2', { policyId: pol.p2, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'hail' });
    expect(own.status).toBe(201);
    clm.own = own.body.data.id;
    expect(await claimRow(clm.own)).toMatchObject({ claimant_user_id: u.h2, created_by: u.h2 });
    expect((await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'insurance.claim.filed' AND entity_id = $1`, [clm.own])).rows)
      .toEqual([{ actor_user_id: u.h2, new_value: { policyId: pol.p2, assisted: false } }]);
    // a holder cannot file on another holder's policy (404, no IDOR) — only a desk member files on behalf
    expect((await file('h2', { policyId: pol.p1, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'flood' })).status).toBe(404);
    // a death claim on a person policy whose holder is the subject → refused by name, nothing written — by the holder or the desk
    const before = (await admin.query(`SELECT count(*)::int n FROM insurance_claims WHERE policy_id = $1`, [pol.p3])).rows[0].n;
    for (const who of ['agent', 'h3']) {
      const d = await file(who, { policyId: pol.p3, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'death' });
      expect([who, d.status, d.body.error?.code]).toEqual([who, 422, 'INSURANCE_CLAIM_NEEDS_NOMINEE']);
    }
    expect((await admin.query(`SELECT count(*)::int n FROM insurance_claims WHERE policy_id = $1`, [pol.p3])).rows[0].n).toBe(before);
    const acc = await file('h3', { policyId: pol.p3, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'accident' });
    expect([acc.status, acc.body.data?.claimantUserId]).toEqual([201, u.h3]);
  });

  it('(4) founder Q5: the surveyor is never the claimant and is an ACTIVE member of the claim\'s organisation (user_tenant_roles, no live suspension)', async () => {
    const sched = (surveyorUserId: string) => request(http).post(`/v1/insurance/claims/${clm.assisted}/schedule-survey`).set(h('admin')).send({ surveyorUserId });
    for (const [who, reason] of [['h1', 'claimant'], ['outsider', 'not_member'], ['suspended', 'not_member']] as const) {
      const r = await sched(u[who]);
      expect([who, r.status, r.body.error?.code, r.body.error?.details?.reason]).toEqual([who, 422, 'INSURANCE_SURVEYOR_INVALID', reason]);
    }
    expect((await claimRow(clm.assisted)).status).toBe('intimated');
    const ok = await sched(u.member);
    expect([ok.status, ok.body.data?.status]).toEqual([201, 'survey_scheduled']);
    expect(await claimRow(clm.assisted)).toMatchObject({ status: 'survey_scheduled', surveyor_user_id: u.member });
  });

  it('(5) the decider is never the surveyor or the filer; another manager decides (the FPO desk still decides — founder Q3)', async () => {
    const rec = await request(http).post(`/v1/insurance/claims/${clm.assisted}/record-survey`).set(h('admin')).send({ damagePercent: 35, notes: 'measured on site' });
    expect([rec.status, rec.body.data?.status]).toEqual([201, 'surveyed']);
    const decide = (who: string) => request(http).post(`/v1/insurance/claims/${clm.assisted}/decide`).set(h(who)).send({ decision: 'approved', approvedMinor: '3500000' });
    const bySurveyor = await decide('member');
    expect([bySurveyor.status, bySurveyor.body.error?.code, bySurveyor.body.error?.details?.as]).toEqual([409, 'INSURANCE_DECIDER_CONFLICT', 'surveyor']);
    const byFiler = await decide('agent');
    expect([byFiler.status, byFiler.body.error?.code, byFiler.body.error?.details?.as]).toEqual([409, 'INSURANCE_DECIDER_CONFLICT', 'filer']);
    expect((await claimRow(clm.assisted)).status).toBe('surveyed');
    const ok = await decide('admin2');
    expect([ok.status, ok.body.data?.status, ok.body.data?.approvedMinor]).toEqual([201, 'approved', '3500000']);
    // and the decision is not money: settle is still the sentence, and nothing was posted
    const s = await request(http).post(`/v1/insurance/claims/${clm.assisted}/settle`).set(h('admin2'));
    expect([s.status, s.body.error?.code]).toEqual([403, 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM']);
    expect(await ledgerFor(clm.assisted)).toBe(0);
  });
});
