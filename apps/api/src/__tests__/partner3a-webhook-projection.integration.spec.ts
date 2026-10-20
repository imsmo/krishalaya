// apps/api/src/__tests__/partner3a-webhook-projection.integration.spec.ts · PC-56 PARTNER-3a (founder Q7; survey F-3, P3-B2) — LIVE proof that a
// partner webhook carries the PROJECTION, never the raw outbox payload: the real AppModule, the real claim services over HTTP (file → schedule
// → record a survey WITH notes → decide WITH a note), a real policy activation (the InsurancePolicy entity's own event flushed through the
// app's outbox writer, exactly as the service's flush does), then the REAL OutboxDispatcher logged in AS kv_relay (production's shape) running
// the app's own registered PartnerWebhookFanoutHandler instances. `webhook_deliveries.payload` is then read as the owner.
//
// Fixture: one tenant; insurers A and B, a product each; H1's active policy on A's product, H2's on B's, a `proposed` policy on A's product to
// activate; ONE `partner_webhook_endpoints` row per insurer (inserted as the owner — ops-provisioned), subscribed to the five claim events +
// `insurance.policy_activated`. `insurance` ON.
//   (1) A's deliveries for claim_filed / claim_surveyed / claim_decided / policy_activated carry NO claimantUserId, surveyReport, notes, note,
//       paymentId, description property (nor their values); the ids, the status, the event code and the amounts ARE there              [M4]
//   (2) ownership routing unchanged: none of A's claim events reached B's endpoint, and B's claim reached B's endpoint only
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { OUTBOX_WRITER, OutboxWriter } from '../core/outbox/outbox.writer';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { PartnerWebhookFanoutHandler } from '../modules/partner-api/events/handlers/partner-webhook-fanout.handler';
import { InsurancePolicy } from '../modules/insurance/domain/insurance-policy.entity';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const SUBSCRIBED = ['insurance.claim_filed', 'insurance.claim_surveyed', 'insurance.claim_decided', 'insurance.claim_settled', 'insurance.claim_closed', 'insurance.policy_activated'];
const FORBIDDEN_KEY = /^(claimantUserId|surveyReport|notes|note|paymentId|description|surveyorUserId|holderUserId|subjectId|premiumPaymentId)$/;
const SURVEY_NOTE = 'The holder cried; neighbour says the shed roof was already broken';
const DECISION_NOTE = 'Approved after a call with the family';
const DESC = 'filed at the desk: flood in the lower field';
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}

run('PC-56 PARTNER-3a · a partner webhook carries the projection, never the raw outbox payload (integration, real relay as kv_relay)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let registry: OutboxHandlerRegistry;
  const T = randomUUID(); const IA = randomUUID(); const IB = randomUUID();
  const u: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const ep: Record<string, string> = {};
  const clm: Record<string, string> = {};
  const tok: Record<string, string> = {};
  let flagBackup: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null = null;
  const PAYMENT = randomUUID();

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const h = (who: string) => ({ authorization: `Bearer ${tok[who]}`, 'x-tenant-id': T });
  const role = (userKey: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [u[userKey], T, code]);
  /** Relay every pending outbox row of this aggregate through the REAL dispatcher, as kv_relay, with the app's partner fan-out handlers only. */
  const relayAggregate = async (aggregateId: string) => {
    const ids = (await admin.query(`SELECT id::text FROM outbox_events WHERE aggregate_id = $1 AND status = 'pending' ORDER BY created_at, id`, [aggregateId])).rows.map((r) => r.id as string);
    const metrics = { inc: () => undefined, observe: () => undefined } as never;
    const out: string[] = [];
    for (const id of ids) out.push((await new OutboxDispatcher(relayPool, registry, metrics).relayById(id)).status);
    return out;
  };
  const deliveries = async (endpointId: string) => (await admin.query(
    `SELECT event_type, payload FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at, id`, [endpointId])).rows as Array<{ event_type: string; payload: Record<string, any> }>;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    flagBackup = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'insurance'`)).rows[0] ?? null;
    // the relay LOGS IN as kv_relay — production's shape (the HOTFIX-2 gate's local convention; RELAY_TEST_DATABASE_URL overrides)
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) {
      await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
      const x = new URL(APP_URL as string); x.username = 'kv_relay'; x.password = 'dev'; relayUrl = x.toString();
    }
    relayPool = new Pool({ connectionString: relayUrl, max: 2, application_name: 'p3a-webhook-projection' });
    expect((await relayPool.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');

    await makeTenant(admin, T, 'Projection Fixture Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Projection Insurer A', 'insurer'), ($3, $4, 'Projection Insurer B', 'insurer')`,
      [IA, `p3wa_${sfx}`, IB, `p3wb_${sfx}`]);
    for (const k of ['agent', 'admin2', 'member', 'h1', 'h2']) {
      u[k] = randomUUID();
      await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [u[k], phoneOf(), `Projection ${k}`]);
    }
    await role('agent', 'insurance_agent'); await role('agent', 'farmer'); await role('admin2', 'tenant_admin'); await role('member', 'insurance_agent');
    await role('h1', 'farmer'); await role('h2', 'farmer');
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (partnerId: string) => (await admin.query(`INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc) VALUES ($1, $2, 'Projection cover', '{"kind":"pct_of_sum_insured","bps":200}'::jsonb) RETURNING id`, [partnerId, kind])).rows[0].id as string;
    const pa = await product(IA); const pb = await product(IB);
    const policy = async (key: string, holder: string, productId: string, status: string) => {
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
         VALUES ($1, $2, $3, 'animal', $4, 10000000, 200000, $5::policy_status, current_date - 10, current_date + 300) RETURNING id`, [T, u[holder], productId, randomUUID(), status])).rows[0].id;
    };
    await policy('a', 'h1', pa, 'active'); await policy('b', 'h2', pb, 'active'); await policy('aProposed', 'h1', pa, 'proposed');
    for (const [k, partnerId] of [['A', IA], ['B', IB]] as const) {
      ep[k] = (await admin.query(`INSERT INTO partner_webhook_endpoints (partner_id, url, secret_enc, event_types, is_active) VALUES ($1, $2, 'v2.00000000.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb', $3::jsonb, true) RETURNING id`,
        [partnerId, `https://hooks.projection-${k.toLowerCase()}.example.com/in`, JSON.stringify(SUBSCRIBED)])).rows[0].id;
    }
    await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
    for (const k of flagKeys('insurance')) await cache.del(k);
    // the app's OWN registered partner fan-out handlers (one per allow-listed event type) — nothing hand-built
    registry = new OutboxHandlerRegistry();
    for (const e of app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY).entries()) if (e.handler instanceof PartnerWebhookFanoutHandler) registry.register(e.handler);
    expect(registry.entries().map((e) => e.eventType)).toEqual(expect.arrayContaining(SUBSCRIBED));
    tok.agent = mintToken(app, { userId: u.agent, tenantId: T, roles: ['insurance_agent', 'farmer'], perms: ['insurance.manage', 'insurance.enrol'] });
    tok.admin2 = mintToken(app, { userId: u.admin2, tenantId: T, roles: ['tenant_admin'], perms: ['insurance.manage', 'insurance.enrol'] });
    tok.h2 = mintToken(app, { userId: u.h2, tenantId: T, roles: ['farmer'], perms: ['insurance.enrol'] });
  }, 180_000);

  afterAll(async () => {
    if (flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'insurance'`,
      [flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND tenant_id = $1`, [T]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await relayPool?.end().catch(() => undefined);
    await admin?.end();
  }, 40_000);

  it('(1) the claim and policy events reach A\'s endpoint PROJECTED: no claimant, report, notes, note, payment id or description — the ids, status, code and amounts are there', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const f = await request(http).post('/v1/insurance/claims').set({ ...h('agent'), 'idempotency-key': `idem-${randomUUID()}` })
      .send({ policyId: pol.a, eventDate: today, eventTypeCode: 'flood', description: DESC });
    expect([f.status, f.status === 201 ? null : f.body]).toEqual([201, null]);
    clm.a = f.body.data.id;
    expect((await request(http).post(`/v1/insurance/claims/${clm.a}/schedule-survey`).set(h('admin2')).send({ surveyorUserId: u.member })).status).toBe(201);
    expect((await request(http).post(`/v1/insurance/claims/${clm.a}/record-survey`).set(h('admin2')).send({ damagePercent: 40, notes: SURVEY_NOTE, surveyedAt: '2026-10-19T10:00:00.000Z' })).status).toBe(201);
    expect((await request(http).post(`/v1/insurance/claims/${clm.a}/decide`).set(h('admin2')).send({ decision: 'partially_approved', approvedMinor: '3500000', note: DECISION_NOTE })).status).toBe(201);
    // the outbox payloads DO carry the identities (the internal rail) — that is exactly what must not leave
    const raw = (await admin.query(`SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at, id`, [clm.a])).rows;
    expect(raw.find((r) => r.event_type === 'insurance.claim_filed')?.payload).toMatchObject({ claimantUserId: u.h1 });
    expect(JSON.stringify(raw)).toContain(SURVEY_NOTE); expect(JSON.stringify(raw)).toContain(DECISION_NOTE);
    // a policy activation: the entity's own event, flushed through the app's outbox writer exactly as InsurancePolicyService.flush does
    const p = InsurancePolicy.rehydrate({ id: pol.aProposed, tenantId: T, holderUserId: u.h1, productId: 'x', policyNo: null, subjectType: 'animal', subjectId: null,
      sumInsuredMinor: 10000000n, premiumMinor: 200000n, premiumPaymentId: null, status: 'proposed', validFrom: today, validUntil: today, parametricTriggers: null });
    expect(p.activate(PAYMENT)).toBe(true);
    const outbox = app.get<OutboxWriter>(OUTBOX_WRITER); const uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await uow.run(T, async (tx) => { for (const e of p.pullEvents()) await outbox.write(tx, { tenantId: T, aggregateType: 'insurance_policy', aggregateId: pol.aProposed, eventType: e.type, payload: { v: 1, ...e.payload } }); });

    for (const id of [clm.a, pol.aProposed]) expect((await relayAggregate(id)).every((s) => s === 'published')).toBe(true);
    const ds = await deliveries(ep.A);
    expect(ds.map((d) => d.event_type).sort()).toEqual(['insurance.claim_decided', 'insurance.claim_filed', 'insurance.claim_surveyed', 'insurance.policy_activated']);
    for (const d of ds) {
      expect([d.event_type, deepKeys(d.payload).filter((k) => FORBIDDEN_KEY.test(k))]).toEqual([d.event_type, []]);
      const json = JSON.stringify(d.payload);
      for (const needle of [u.h1, u.member, u.agent, u.admin2, SURVEY_NOTE, DECISION_NOTE, DESC, PAYMENT]) expect([d.event_type, json.includes(needle)]).toEqual([d.event_type, false]);
      expect(d.payload).toMatchObject({ type: d.event_type, partnerId: IA });
    }
    const by = (t: string) => ds.find((d) => d.event_type === t)?.payload.data;
    expect(by('insurance.claim_filed')).toEqual({ v: 1, claimId: clm.a, policyId: pol.a, eventTypeCode: 'flood', status: 'intimated' });
    expect(by('insurance.claim_surveyed')).toEqual({ v: 1, claimId: clm.a, surveyedAt: '2026-10-19T10:00:00.000Z', status: 'surveyed' });
    expect(by('insurance.claim_decided')).toEqual({ v: 1, claimId: clm.a, status: 'partially_approved', approvedMinor: '3500000' });
    expect(by('insurance.policy_activated')).toEqual({ v: 1, policyId: pol.aProposed, status: 'active' });
  });

  it('(2) ownership routing unchanged: A\'s events never reached B\'s endpoint; B\'s claim reached B\'s endpoint only, projected', async () => {
    expect((await deliveries(ep.B)).length).toBe(0);
    const f = await request(http).post('/v1/insurance/claims').set({ ...h('h2'), 'idempotency-key': `idem-${randomUUID()}` })
      .send({ policyId: pol.b, eventDate: new Date().toISOString().slice(0, 10), eventTypeCode: 'hail', description: DESC });
    expect(f.status).toBe(201);
    clm.b = f.body.data.id;
    expect((await relayAggregate(clm.b)).every((s) => s === 'published')).toBe(true);
    const b = await deliveries(ep.B);
    expect(b.map((d) => [d.event_type, d.payload.data])).toEqual([['insurance.claim_filed', { v: 1, claimId: clm.b, policyId: pol.b, eventTypeCode: 'hail', status: 'intimated' }]]);
    expect(JSON.stringify(b)).not.toContain(u.h2);
    expect((await deliveries(ep.A)).some((d) => JSON.stringify(d.payload).includes(clm.b))).toBe(false);
  });
});
