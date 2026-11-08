// apps/api/src/__tests__/ops3c-price.integration.spec.ts · PC-56 OPS-3c — THE PRICE, LIVE: what the ops console's `/rates` (W368) reads, and the
// acts the canon draws that do not exist. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres
// + RLS as kv_app. `dairy` is seeded OFF and switched ON for THESE two organisations only (an allow-list fixture, the HOTFIX-12 shape), restored
// in afterAll. Cards are created and approved through the REAL service with HOTFIX-12's helper (`approvedCardForTest`: a second fixture person
// approves); the one pre-rule card is an admin-realm row with exactly the stamp 0234 writes on existing rows (HOTFIX-12's own fixture shape).
//   (1) a member WITHOUT dairy.manage reads `activeOnly=true` → 200; another organisation sees none of this one's cards
//   (2) a card awaiting a second person is NOT in the `activeOnly` list; an approved one IS; a pre-rule one IS
//   (2b) the lead's fix (2026-11-09): `?activeOnly=false` means false, and widens ONLY for a `dairy.manage` holder — a member never sees an
//       awaiting card (first pinned in this wave as the `z.coerce.boolean()` defect; NAMED UPDATE in the same wave)
//   (3) absence → 404: `POST …/rate-cards/:id/{supersede,deactivate}`, `GET …/rate-cards/:id/poster`, an export of `dairy.rate_card` (no route,
//       no registered dataset)
//   (4) the organisation's console (web-tenant `/dairy/console`, `listRateCards({ activeOnly: false })`) now RECEIVES the awaiting card, and its own
//       `canApproveRateCard` offers Approve to the second person and not to the creator; the second person's approval then succeeds
//   (5) Q8-A reaches the member notices (lead decision 2026-11-09): on this fresh database the nine `dairy.bill_previewed` templates, and every
//       version 0007's backfill made SERVABLE, say kg / કિગ્રા — never L / લિટર; the variable keeps its name `{{litres}}`
import 'reflect-metadata';
import { join } from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { DatasetRegistry } from '../core/exports-plane/dataset.registry';
import { MilkRateCardService } from '../modules/dairy/services/milk-rate-card.service';
import { approvedCardForTest, tenantTomorrowForTest } from '../modules/dairy/__tests__/helpers/hotfix12-approved-card';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy'] as const;

run('PC-56 OPS-3c · the price: the rate-card read the ops console relies on (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID(); const T2 = randomUUID();
  let A = ''; let B = ''; let M = ''; let E = '';
  let approved = ''; let awaiting = ''; let preRule = ''; let other = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];
  const H = (token: string, tenant: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const get = (token: string, path: string, tenant: string = T1) => request(http).get(path).set(H(token, tenant));
  const post = (token: string, path: string, body: object = {}, tenant: string = T1) =>
    request(http).post(path).set({ ...H(token, tenant), 'idempotency-key': randomUUID() }).send(body);
  const ids = (r: { body: { data?: Array<{ id: string }> } }) => (r.body.data ?? []).map((c) => c.id).sort();
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T1}`, `flagctx:${T2}`]) await cache.del(c);
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T1, `OPS3c desk ${T1.slice(0, 4)}`);
    await makeTenant(admin, T2, `OPS3c other ${T2.slice(0, 4)}`);
    [A, B, M, E] = await Promise.all(Array.from({ length: 4 }, () => makeUser(admin)));
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    await role(A, T1, 'tenant_admin'); await role(B, T1, 'tenant_admin'); await role(M, T1, 'farmer'); await role(E, T2, 'tenant_admin');

    // The fixture switches `dairy` ON for these two organisations only (seeded OFF; restored in afterAll).
    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T1, T2] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    tok.A = mintToken(app, { userId: A, tenantId: T1, roles: ['tenant_admin'], perms: ['dairy.manage'] });
    tok.M = mintToken(app, { userId: M, tenantId: T1, roles: ['farmer'], perms: [] });
    tok.E = mintToken(app, { userId: E, tenantId: T2, roles: ['tenant_admin'], perms: ['dairy.manage'] });

    const cards = app.get(MilkRateCardService);
    const tomorrow = await tenantTomorrowForTest(admin, T1);
    // APPROVED: created by A, approved by a second fixture person (HOTFIX-12's helper, the real service both times).
    approved = (await approvedCardForTest(cards, admin, T1, { userId: A, canManage: true },
      { defaultName: 'OPS3c cow', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '68100', ratePerKgSnfMinor: '23300', effectiveFrom: tomorrow })).id;
    // AWAITING A SECOND PERSON: created by A through the real route, never approved.
    const w = await post(tok.A, '/v1/dairy/rate-cards', { defaultName: 'OPS3c draft buffalo', animalType: 'buffalo', pricingModel: 'fat_pooled', ratePerKgFatMinor: '81900', effectiveFrom: tomorrow });
    expect([w.status, w.body.data?.approvalState]).toEqual([201, 'awaiting_second_person']);
    awaiting = w.body.data.id;
    // PRE-RULE (founder Q1-sub): exactly the stamp 0234's UPDATE writes on every existing row — the HOTFIX-12 spec's fixture shape.
    preRule = (await admin.query(
      `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, effective_from, is_active, approved_before_rule, approved_at)
       VALUES ($1, 'OPS3c mixed legacy', 'mixed', 'two_axis', 64900, 21700, CURRENT_DATE - 30, true, true, now()) RETURNING id`, [T1])).rows[0].id;
    // ANOTHER ORGANISATION's approved card.
    other = (await approvedCardForTest(cards, admin, T2, { userId: E, canManage: true },
      { defaultName: 'OPS3c other cow', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '70100', ratePerKgSnfMinor: '24300', effectiveFrom: await tenantTomorrowForTest(admin, T2) })).id;
  }, 180_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) a member WITHOUT dairy.manage reads activeOnly=true → 200; another organisation sees none of this one\'s cards', async () => {
    const r = await get(tok.M, '/v1/dairy/rate-cards?activeOnly=true');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([approved, preRule].sort());
    expect(JSON.stringify(r.body.data)).not.toContain(A);                         // no person id on the wire (HOTFIX-12 D10)
    const o = await get(tok.E, '/v1/dairy/rate-cards?activeOnly=true', T2);
    expect(o.status).toBe(200);
    expect(ids(o)).toEqual([other]);
    for (const id of [approved, awaiting, preRule]) expect([id, ids(o).includes(id)]).toEqual([id, false]);
    // RLS, not the filter: the other organisation cannot read this one's card by id either.
    expect((await get(tok.E, `/v1/dairy/rate-cards/${approved}`, T2)).status).toBe(404);
  });

  it('(2) awaiting a second person → NOT in the activeOnly list; approved → in; pre-rule → in, each with its state', async () => {
    const r = await get(tok.M, '/v1/dairy/rate-cards?activeOnly=true');
    const by = Object.fromEntries((r.body.data as Array<{ id: string; approvalState: string; bonusSlabs: unknown }>).map((c) => [c.id, c]));
    expect(by[awaiting]).toBeUndefined();
    expect(by[approved]).toMatchObject({ approvalState: 'approved', ratePerKgFatMinor: '68100', ratePerKgSnfMinor: '23300', baseRatePerLitreMinor: null, bonusSlabs: [], isActive: true });
    expect(by[preRule]).toMatchObject({ approvalState: 'approved_before_rule', isActive: true });
    // OPS3-B17 (E13): every field the SDK's `DairyRateCard` declares is on the wire, and nothing else.
    expect(Object.keys(by[approved]).sort()).toEqual(['animalType', 'approvalState', 'approvedAt', 'approvedByYou', 'baseRatePerLitreMinor', 'bonusSlabs',
      'createdByYou', 'defaultName', 'effectiveFrom', 'effectiveTo', 'id', 'isActive', 'pricingModel', 'ratePerKgFatMinor', 'ratePerKgSnfMinor'].sort());
    // The default (no query) is the same list.
    expect(ids(await get(tok.M, '/v1/dairy/rate-cards'))).toEqual([approved, preRule].sort());
  });

  it('(2b) THE FIXED RULE (lead decision 2026-11-09): activeOnly=false widens ONLY for a dairy.manage holder; a member never sees the awaiting card', async () => {
    // Was pinned at first build as the defect: `z.coerce.boolean()` read "false" as TRUE. NAMED UPDATE (OPS-3c, same wave): the query is the
    // strict `queryBoolean()` and `MilkRateCardService.list` narrows every caller without `dairy.manage` to approved-and-active cards.
    // (a) manage + activeOnly=false → the awaiting card IS listed, with its state
    const a = await get(tok.A, '/v1/dairy/rate-cards?activeOnly=false');
    expect(a.status).toBe(200);
    expect(ids(a)).toEqual([approved, awaiting, preRule].sort());
    const byA = Object.fromEntries((a.body.data as Array<{ id: string; approvalState: string; createdByYou: boolean }>).map((c) => [c.id, c])) as Record<string, { approvalState: string; createdByYou: boolean }>;
    expect([byA[awaiting].approvalState, byA[awaiting].createdByYou]).toEqual(['awaiting_second_person', true]);
    // (b) a member WITHOUT dairy.manage + activeOnly=false → never the awaiting card (the conservative trust rule)
    const m = await get(tok.M, '/v1/dairy/rate-cards?activeOnly=false');
    expect([m.status, ids(m)]).toEqual([200, [approved, preRule].sort()]);
    // (c) activeOnly=true unchanged for both; an unknown spelling is refused by the schema, never guessed
    expect(ids(await get(tok.A, '/v1/dairy/rate-cards?activeOnly=true'))).toEqual([approved, preRule].sort());
    expect(ids(await get(tok.M, '/v1/dairy/rate-cards?activeOnly=true'))).toEqual([approved, preRule].sort());
    expect((await get(tok.A, '/v1/dairy/rate-cards?activeOnly=maybe')).status).toBe(422);
    // the other organisation's desk, asking for everything, still sees only its own
    expect(ids(await get(tok.E, '/v1/dairy/rate-cards?activeOnly=false', T2))).toEqual([other]);
  });

  it('(3) absence → 404: supersede, deactivate, the poster, an export of dairy.rate_card — nothing is written', async () => {
    const before = Number((await admin.query(`SELECT count(*)::int n FROM milk_rate_cards WHERE tenant_id = $1`, [T1])).rows[0].n);
    for (const act of ['supersede', 'deactivate']) {
      const r = await post(tok.A, `/v1/dairy/rate-cards/${approved}/${act}`);
      expect([act, r.status]).toEqual([act, 404]);
    }
    expect((await get(tok.A, `/v1/dairy/rate-cards/${approved}/poster`)).status).toBe(404);
    expect((await post(tok.A, '/v1/dairy/rate-cards/export', { language: 'gu' })).status).toBe(404);
    expect((await post(tok.A, '/v1/exports', { datasetCode: 'dairy.rate_card', params: {} })).status).toBe(404);
    expect(app.get(DatasetRegistry).has('dairy.rate_card')).toBe(false);
    expect(app.get(DatasetRegistry).codes().filter((c) => /rate/i.test(c))).toEqual([]);
    expect(Number((await admin.query(`SELECT count(*)::int n FROM milk_rate_cards WHERE tenant_id = $1`, [T1])).rows[0].n)).toBe(before);
    expect((await admin.query(`SELECT effective_to FROM milk_rate_cards WHERE id = $1`, [approved])).rows[0].effective_to).toBeNull();
  });

  it('(4) /dairy/console now receives the awaiting card: Approve renders for the second person, never for the creator; the second person approves', async () => {
    // web-tenant's own pure rule, loaded from its source (no copy): `features/dairy/calc.ts` canApproveRateCard.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const calc = require(join(__dirname, '..', '..', '..', 'web-tenant', 'src', 'features', 'dairy', 'calc.ts')) as { canApproveRateCard: (c: unknown) => boolean };
    tok.B = mintToken(app, { userId: B, tenantId: T1, roles: ['tenant_admin'], perms: ['dairy.manage'] });
    const seen = async (token: string) => ((await get(token, '/v1/dairy/rate-cards?activeOnly=false')).body.data as Array<{ id: string }>).find((c) => c.id === awaiting);
    const asB = await seen(tok.B); const asA = await seen(tok.A);
    expect([asB?.id, (asB as { createdByYou?: boolean })?.createdByYou, calc.canApproveRateCard(asB)]).toEqual([awaiting, false, true]);
    expect([asA?.id, (asA as { createdByYou?: boolean })?.createdByYou, calc.canApproveRateCard(asA)]).toEqual([awaiting, true, false]);
    expect(calc.canApproveRateCard((await seen(tok.B)) ?? {})).toBe(true);
    const r = await post(tok.B, `/v1/dairy/rate-cards/${awaiting}/approve`);
    expect([r.status, r.body.data?.approvalState]).toEqual([201, 'approved']);
    // and now a member's ordinary list carries it
    expect(ids(await get(tok.M, '/v1/dairy/rate-cards?activeOnly=true')).includes(awaiting)).toBe(true);
  });

  it('(5) the bill-preview notices a member is served say kilograms (seeded copy, fresh database)', async () => {
    const t = (await admin.query(`SELECT channel, language_code AS l, body FROM notification_templates WHERE event_code = 'dairy.bill_previewed' AND tenant_id IS NULL AND deleted_at IS NULL ORDER BY 1, 2`)).rows as Array<{ channel: string; l: string; body: string }>;
    expect(t.length).toBe(9);
    const served = (await admin.query(`SELECT t.channel, t.language_code AS l, v.body FROM notification_templates t JOIN notification_template_versions v ON v.id = t.serving_version_id
      WHERE t.event_code = 'dairy.bill_previewed' AND t.tenant_id IS NULL AND v.lifecycle = 'approved' ORDER BY 1, 2`)).rows as Array<{ channel: string; l: string; body: string }>;
    expect(served.length).toBeGreaterThanOrEqual(6);   // push + in-app ×3 at least (an inactive SMS placeholder is not served)
    for (const r of [...t, ...served]) {
      expect([r.channel, r.l, r.body.includes(r.l === 'gu' ? '{{litres}} કિગ્રા' : '{{litres}} kg')]).toEqual([r.channel, r.l, true]);
      expect([r.channel, r.l, /\{\{litres\}\}\s*(L\b|લિટર|लीटर)/.test(r.body)]).toEqual([r.channel, r.l, false]);
    }
  });
});
