// modules/esg/__tests__/tenant9d-esg.integration.spec.ts · PC-56 TENANT-9d · ESG, live.
//
// Real PG16, the harness's test database (the real migrations + seeds), every tenant-realm query as `kv_app` under RLS.
// Run under TZ=Asia/Kolkata AND TZ=UTC: the window and every as-of are civil days / times the DATABASE computes in
// `countries.timezone`, never the process zone. What this proves:
//   1. NO METHOD, NO METRIC · a metric with no published method never returns a figure EVEN WHEN SOURCE ROWS EXIST — gender on
//      every member (women participation), a labour grievance (grievance channels), a carbon project (carbon), and the
//      adulteration method itself switched to not_published while flagged pours exist;
//   2. 0183 · the tenant realm cannot write a platform method row (INSERT / UPDATE / DELETE → 42501);
//   3. a disclosure cannot carry a numeric claim — the review (NUMBER_IN_DISCLOSURE, ASCII and Gujarati digits) and 23514
//      underneath as kv_app;
//   4. W424 · the export receipt opens UNSIGNED and names every metric it left out; the file carries only the gate's figures
//      and the published disclosures; the enqueue needs esg.disclose and goes to the plane as `esg.metrics`;
//   5. F-12 class · another tenant's disclosures are invisible (service 404, kv_app 0 rows, an UPDATE across the wall moves 0);
//   6. one member, one vote derives from 9b's SNAPSHOT (`eligible_at_close`), not today's roll — five members join after close
//      and the figure does not move;
//   7. adulteration: flags + retests inside the method's window in the cooperative's days; the audit-trail fact is the catalogue's
//      truth (append-only; no hash column; the ledger chained);
//   8. the disclosure lifecycle: keyed (one key → one row, one audit row), edited while a draft, published (one per metric —
//      ANOTHER_PUBLISHED, and 23505 underneath), withdrawn with a declared reason, final after (23514);
//   9. the verbs: esg.read for tenant_admin + fpo_coordinator, esg.disclose for tenant_admin only, nothing for the auditor.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { GovernanceRepository } from '../../memberships/repositories/governance.repository';
import { GovernanceService, GovActor } from '../../memberships/services/governance.service';
import { EsgRepository } from '../repositories/esg.repository';
import { EsgFactsReadModel } from '../read-models/esg-facts.read-model';
import { EsgActor, EsgService } from '../services/esg.service';
import { EsgMetricsDataset } from '../exports/esg-metrics.dataset';
import { ESG_UNSIGNED_NOTE } from '../domain/esg-export';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('TENANT-9d · ESG (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool;
  let esg: EsgService; let gov: GovernanceService; let dataset: EsgMetricsDataset; let repo: EsgRepository;
  const planeCalls: Array<{ tenantId: string; datasetCode: string; params: unknown; key: string }> = [];
  const tA = randomUUID(); const tB = randomUUID();
  const adminA = randomUUID(); const coordA = randomUUID(); const auditorA = randomUUID(); const adminB = randomUUID();
  const members = Array.from({ length: 5 }, () => randomUUID());
  const late = Array.from({ length: 5 }, () => randomUUID());
  let adminPerms: Set<string>; let coordPerms: Set<string>; let auditorPerms: Set<string>;
  const A = (): EsgActor => ({ userId: adminA, permissions: adminPerms, ip: '203.0.113.9', requestId: 'req-9d' });
  const B = (): EsgActor => ({ userId: adminB, permissions: adminPerms, ip: null, requestId: null });
  const C = (): EsgActor => ({ userId: coordA, permissions: coordPerms, ip: null, requestId: null });
  const words = 'Every pour is tested at the counter in front of the member, and the sample is sealed when a flag is raised.';
  const wordsGu = 'દરેક ઠાલવણ સભ્યની સામે કાઉન્ટર પર તપાસાય છે અને ચિહ્ન આવે ત્યારે નમૂનો સીલ થાય છે.';

  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const refusals = async (p: Promise<unknown>) => { try { await p; return ['ok']; } catch (e) { const d = (e as any).details?.refusals; return d ? d.map((r: any) => r.code) : [(e as any).code ?? String(e)]; } };
  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const permsOf = async (role: string) => new Set<string>((await admin.query(
    `SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((r) => r.p));
  const staff = (u: string, code: string, t = tA) => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, kyc_status) SELECT $1, $2, id, true, 'none' FROM roles WHERE code = $3`, [u, t, code]);
  /** A member of a year's standing with 20 shares — eligible under 0130's default bylaws; gender stated as 'female'. */
  const member = async (u: string, t = tA) => {
    await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await admin.query(`UPDATE users SET gender = 'female' WHERE id = $1`, [u]);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, kyc_status, created_at)
                       SELECT $1, $2, id, true, 'verified', now() - interval '1 year' FROM roles WHERE code = 'farmer'`, [u, t]);
    await admin.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor) VALUES ($1, $2, 20, 400000)`, [t, u]);
  };
  const today = async () => (await admin.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`)).rows[0].d as string;
  const pour = async (t: string, day: string, flag: 'none' | 'water' | 'flags') => admin.query(
    `INSERT INTO milk_collections (tenant_id, membership_id, mcc_id, collected_on, shift, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, water_flag, adulteration_flags)
     VALUES ($1, $2, $3, $4::date, 'morning', 5.000, 4.00, 8.50, $5, 1000, $6, $7::jsonb) RETURNING id`,
    [t, randomUUID(), randomUUID(), day, randomUUID(), flag === 'water', flag === 'flags' ? '["urea"]' : '[]']);
  const row = async (actor: EsgActor, code: string, t = tA) => (await esg.dashboard(t, actor)).rows.find((r) => r.metricCode === code)!;
  const gActor = (u: string): GovActor => ({ userId: u, permissions: adminPerms, ip: null, requestId: null });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tA, 'Anand Dairy Coop'); await makeTenant(admin, tB, 'B');
    for (const u of [adminA, coordA, auditorA, adminB]) await makeUser(admin, u);
    await staff(adminA, 'tenant_admin'); await staff(coordA, 'fpo_coordinator'); await staff(auditorA, 'auditor'); await staff(adminB, 'tenant_admin', tB);
    for (const m of members) await member(m);
    adminPerms = await permsOf('tenant_admin'); coordPerms = await permsOf('fpo_coordinator'); auditorPerms = await permsOf('auditor');

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const auditWriter = new AuditWriter(pools);
    const ui = new UiMessageRepository(replica as never);
    const idem = new PgIdempotencyService(pools);
    repo = new EsgRepository(replica as never);
    const plane = { enqueue: async (tenantId: string, _a: unknown, key: string, input: { datasetCode: string; params: unknown }) => {
      planeCalls.push({ tenantId, datasetCode: input.datasetCode, params: input.params, key }); return { id: randomUUID(), datasetCode: input.datasetCode, status: 'queued' };
    } };
    esg = new EsgService(uow, idem, repo, new EsgFactsReadModel(replica as never), auditWriter, ui, plane as never);
    dataset = new EsgMetricsDataset(esg, repo, ui, { isEnabled: async () => true } as never);
    gov = new GovernanceService(uow, idem, new GovernanceRepository(replica as never), auditWriter, new PgOutboxWriter(), ui);
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); await app?.end(); });

  it('0183 · the verbs: esg.read for tenant_admin + fpo_coordinator, esg.disclose for tenant_admin, nothing for the auditor', async () => {
    expect([adminPerms.has('esg.read'), adminPerms.has('esg.disclose')]).toEqual([true, true]);
    expect([coordPerms.has('esg.read'), coordPerms.has('esg.disclose')]).toEqual([true, false]);
    expect([...auditorPerms].filter((p) => p.startsWith('esg.'))).toEqual([]);
    expect(auditorPerms.size).toBe(5);
  });

  it('NO METHOD, NO METRIC · source rows exist and no published method → no figure (gender, a grievance, a carbon project)', async () => {
    const lookup = (await admin.query(`SELECT id FROM lookup_values LIMIT 1`)).rows[0].id;
    await admin.query(`INSERT INTO labour_grievances (tenant_id, raised_by, grievance_type_id, description) VALUES ($1, $2, $3, 'shade missing')`, [tA, members[0], lookup]);
    await admin.query(`INSERT INTO carbon_projects (tenant_id, default_name, methodology) VALUES ($1, 'AWD pilot', 'awd_methane')`, [tA]);
    const g = (await admin.query(`SELECT count(*)::int n FROM users u JOIN user_tenant_roles r ON r.user_id = u.id WHERE r.tenant_id = $1 AND u.gender = 'female'`, [tA])).rows[0].n;
    expect(g).toBe(5);                                                   // the source rows the canon's "18%" would be computed from
    const d = await esg.dashboard(tA, A());
    for (const code of ['women_participation', 'grievance_channels', 'carbon_participation', 'water_per_kg', 'worksite_injury_rate', 'to_farmer_hands']) {
      const r = d.rows.find((x) => x.metricCode === code)!;
      expect([code, r.fact, r.freshness, r.method.ref]).toEqual([code, null, null, null]);
    }
    expect(d.rows.find((x) => x.metricCode === 'carbon_participation')!.verdict).toBe('no_programme');
    expect(d.rows.find((x) => x.metricCode === 'grievance_channels')!.verdict).toBe('no_method');
    expect(d.rows.find((x) => x.metricCode === 'women_participation')!.needs!.en).toMatch(/declared basis/);
    // eslint-disable-next-line no-console
    console.log(`[9d gate probe] source rows: 5 members gender=female · 1 labour_grievances · 1 carbon_projects → women_participation ${d.rows.find((x) => x.metricCode === 'women_participation')!.verdict} fact=null · grievance_channels no_method fact=null · carbon_participation no_programme fact=null`);
  });

  it('NO METHOD, NO METRIC · the adulteration METHOD switched to not_published while flagged pours exist → no figure; restored → the figure', async () => {
    const day = await today();
    await pour(tA, day, 'water'); await pour(tA, day, 'flags'); await pour(tA, day, 'none');
    const before = await row(A(), 'adulteration');
    expect(before.verdict).toBe('published_with_fact');
    expect(before.fact).toMatchObject({ kind: 'adulteration', pours: 3, flaggedPours: 2, waterFlagged: 1, lastFlaggedDay: day });
    await admin.query(`UPDATE esg_metric_methods SET method_status = 'not_published', refusal_kind = 'no_method', method_ref = NULL, method_version = NULL,
                         published_at = NULL, fact_kind = 'none' WHERE metric_code = 'adulteration'`);
    try {
      const off = await row(A(), 'adulteration');
      const report = await esg.report(tA, A());
      expect([off.verdict, off.fact, off.freshness, report.checklist.find((c) => c.metricCode === 'adulteration')!.included]).toEqual(['no_method', null, null, false]);
      // eslint-disable-next-line no-console
      console.log(`[9d gate probe] adulteration with 3 pours (2 flagged) and its method unpublished → verdict ${off.verdict} · fact ${off.fact} · in report: false`);
    } finally {
      await admin.query(`UPDATE esg_metric_methods SET method_status = 'published', refusal_kind = NULL, method_ref = 'KV-ESG-S4', method_version = 1,
                           published_at = '2026-10-02T00:00:00Z', fact_kind = 'adulteration' WHERE metric_code = 'adulteration'`);
    }
    expect((await row(A(), 'adulteration')).verdict).toBe('published_with_fact');
  });

  it('0183 · the tenant realm cannot write a platform method row (42501 on INSERT, UPDATE, DELETE)', async () => {
    const r = await asApp(tA, async (q) => [
      await pgCode(q(`INSERT INTO esg_metric_methods (metric_code, pillar, sort_order, method_status, refusal_kind) VALUES ('my_metric', 'E', 9, 'not_published', 'no_method')`)),
    ]);
    const u = await asApp(tA, async (q) => [await pgCode(q(`UPDATE esg_metric_methods SET method_status = 'published' WHERE metric_code = 'women_participation'`))]);
    const d = await asApp(tA, async (q) => [await pgCode(q(`DELETE FROM esg_metric_methods WHERE metric_code = 'water_per_kg'`))]);
    expect([...r, ...u, ...d]).toEqual(['42501', '42501', '42501']);
    const readable = await asApp(tA, async (q) => (await q(`SELECT count(*)::int n FROM esg_metric_methods`)).rows[0].n);
    expect(readable).toBe(14);
  });

  it('a disclosure cannot carry a numeric claim — the review refuses it, and 23514 underneath as kv_app', async () => {
    expect(await refusals(esg.createDisclosure(tA, A(), randomUUID(), { metricCode: 'women_participation', texts: { en: 'Women are 18% of our members and growing every season.' } }))).toEqual(['NUMBER_IN_DISCLOSURE']);
    expect(await refusals(esg.createDisclosure(tA, A(), randomUUID(), { metricCode: 'women_participation', texts: { gu: 'અમારા સભ્યોમાં ૧૮ ટકા મહિલાઓ છે અને દર મોસમે વધે છે.' } }))).toEqual(['NUMBER_IN_DISCLOSURE']);
    // Each in its own transaction (a refused statement aborts the transaction it is in).
    const direct: string[] = [];
    for (const texts of ['{"en":"Women are 18 percent of our members today."}', '{"gu":"અમારા સભ્યોમાં ૧૮ ટકા મહિલાઓ છે."}', '{"xx":"words in a language nobody declared"}']) {
      direct.push(await asApp(tA, (q) => pgCode(q(`INSERT INTO esg_disclosures (tenant_id, metric_code, texts, created_by) VALUES ($1, 'women_participation', $3::jsonb, $2)`, [tA, adminA, texts]))));
    }
    expect(direct).toEqual(['23514', '23514', '23514']);
    expect(await refusals(esg.createDisclosure(tA, C(), randomUUID(), { metricCode: 'adulteration', texts: { en: words } }))).toEqual(['NO_PERMISSION']);
  });

  it('the lifecycle · keyed create (one key → one row, one audit row), edit while a draft, publish (one per metric), withdraw, final', async () => {
    const key = randomUUID();
    const a = await esg.createDisclosure(tA, A(), key, { metricCode: 'adulteration', texts: { en: words } });
    const again = await esg.createDisclosure(tA, A(), key, { metricCode: 'adulteration', texts: { en: words } });
    expect(again.id).toBe(a.id);
    expect((await admin.query(`SELECT count(*)::int n FROM esg_disclosures WHERE tenant_id = $1 AND metric_code = 'adulteration'`, [tA])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND entity_id = $2::uuid AND action = 'esg.disclosure.created'`, [tA, a.id])).rows[0].n).toBe(1);

    await esg.updateDisclosure(tA, A(), a.id, randomUUID(), { texts: { en: words, gu: wordsGu } });
    const pv = await esg.previewAct(tA, A(), a.id, 'publish', { note: 'approved at the committee meeting' });
    expect(pv.allowed).toBe(true);
    await esg.act(tA, A(), a.id, 'publish', { note: 'approved at the committee meeting' }, randomUUID());
    const shown = await row(A(), 'adulteration');
    expect(shown.disclosure).toMatchObject({ id: a.id, status: 'published', texts: { en: words, gu: wordsGu } });
    const audit = (await admin.query(`SELECT actor_user_id, reason, old_value, new_value, ip FROM audit_log WHERE tenant_id = $1 AND entity_id = $2::uuid AND action = 'esg.disclosure.published'`, [tA, a.id])).rows[0];
    expect(audit).toMatchObject({ actor_user_id: adminA, reason: 'approved at the committee meeting', old_value: { status: 'draft' }, new_value: { status: 'published' } });

    // A second disclosure on the same metric cannot be published while the first stands — the service and the index.
    const b = await esg.createDisclosure(tA, A(), randomUUID(), { metricCode: 'adulteration', texts: { en: `${words} The committee reviews every flag.` } });
    expect((await esg.previewAct(tA, A(), b.id, 'publish', { note: 'second' })).refusals).toEqual(['ANOTHER_PUBLISHED']);
    expect(await refusals(esg.act(tA, A(), b.id, 'publish', { note: 'second' }, randomUUID()))).toEqual(['ANOTHER_PUBLISHED']);
    const dup = await asApp(tA, async (q) => [await pgCode(q(`UPDATE esg_disclosures SET status = 'published', published_at = now(), published_by = $2 WHERE id = $1`, [b.id, adminA]))]);
    expect(dup).toEqual(['23505']);
    // A published disclosure's words cannot change (the guard), even as kv_app directly.
    const edit = await asApp(tA, async (q) => [await pgCode(q(`UPDATE esg_disclosures SET texts = '{"en":"Something else entirely, said later on."}' WHERE id = $1`, [a.id]))]);
    expect(edit).toEqual(['23514']);
    expect(await refusals(esg.act(tA, A(), a.id, 'withdraw', { reasonCode: 'whim', note: 'gone' }, randomUUID()))).toEqual(['REASON_UNKNOWN']);
    await esg.act(tA, A(), a.id, 'withdraw', { reasonCode: 'superseded', note: 'replaced by the committee text' }, randomUUID());
    await esg.act(tA, A(), b.id, 'publish', { note: 'the committee text' }, randomUUID());
    const final = await asApp(tA, async (q) => [await pgCode(q(`UPDATE esg_disclosures SET status = 'draft', withdrawn_at = NULL, withdrawn_by = NULL, withdraw_reason = NULL WHERE id = $1`, [a.id]))]);
    expect(final).toEqual(['23514']);
    // A DISCARDED draft (withdrawn, never published) is final too — it cannot be revived as a draft.
    const c = await esg.createDisclosure(tA, A(), randomUUID(), { metricCode: 'adulteration', texts: { en: `${words} A third version.` } });
    await esg.act(tA, A(), c.id, 'withdraw', { reasonCode: 'drafting_error', note: 'discarded' }, randomUUID());
    const revive = await asApp(tA, async (q) => [await pgCode(q(`UPDATE esg_disclosures SET status = 'draft', withdrawn_at = NULL, withdrawn_by = NULL, withdraw_reason = NULL WHERE id = $1`, [c.id]))]);
    expect(revive).toEqual(['23514']);
    expect((await row(A(), 'adulteration')).disclosure!.id).toBe(b.id);
  });

  it('F-12 class · another tenant\'s disclosures are invisible — the service, kv_app, an UPDATE across the wall', async () => {
    const mine = (await admin.query(`SELECT id FROM esg_disclosures WHERE tenant_id = $1 AND status = 'published' LIMIT 1`, [tA])).rows[0].id;
    expect((await row(B(), 'adulteration', tB)).disclosure).toBeNull();
    expect(await refusals(esg.disclosure(tB, mine))).toEqual(['NOT_FOUND']);
    const seen = await asApp(tB, async (q) => (await q(`SELECT count(*)::int n FROM esg_disclosures`)).rows[0].n);
    const moved = await asApp(tB, async (q) => (await q(`UPDATE esg_disclosures SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = 'inaccurate' WHERE id = $1`, [mine, adminB])).rowCount);
    const forged = await asApp(tB, async (q) => [await pgCode(q(`INSERT INTO esg_disclosures (tenant_id, metric_code, texts, created_by) VALUES ($1, 'adulteration', '{"en":"Planted into another cooperative by mistake."}', $2)`, [tA, adminB]))]);
    expect([seen, moved, forged]).toEqual([0, 0, ['42501']]);
    expect((await esg.dashboard(tB, B())).rows.find((r) => r.metricCode === 'adulteration')!.fact).toBeNull();   // B has no pours
  });

  it('one member, one vote derives from 9b\'s SNAPSHOT — five members join after the close and the figure does not move', async () => {
    const note = 'as minuted at the general meeting';
    const id = (await gov.create(tA, gActor(adminA), randomUUID(), { title: 'Adopt digital AGM notices', resolutionType: 'agm_vote',
      votingCloses: new Date(Date.now() + 7 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 16) })).id;
    await gov.transition(tA, gActor(adminA), id, 'open', { note }, randomUUID());
    for (const [i, c] of ['for', 'for', 'against', 'for'].entries()) await gov.vote(tA, members[i], id, c);
    await gov.transition(tA, gActor(adminA), id, 'close', { note, reasonCode: 'agm_declared' }, randomUUID());
    const at = (await row(A(), 'one_member_one_vote')).fact;
    for (const u of late) await member(u);
    const after = await row(A(), 'one_member_one_vote');
    const todaysRoll = (await admin.query(`SELECT count(*)::int n FROM coop_share_registers WHERE tenant_id = $1`, [tA])).rows[0].n;
    expect(at).toMatchObject({ kind: 'omov', closedWithSnapshot: 1, ballots: 4, eligibleAtClose: 5, maxBallotsPerMember: 1, overRoll: 0 });
    expect(after.fact).toEqual(at);
    expect(after.verdict).toBe('published_with_fact');
    expect(todaysRoll).toBe(10);
    expect(after.freshness!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // eslint-disable-next-line no-console
    console.log(`[9d omov probe] closed resolution: 4 ballots, eligible at close 5 · +5 members after close (today's roll ${todaysRoll}) → eligibleAtClose ${(after.fact as any).eligibleAtClose} · ballots ${(after.fact as any).ballots} · max per member ${(after.fact as any).maxBallotsPerMember}`);
  });

  it('adulteration counts inside the method\'s window in the cooperative\'s days; the audit-trail fact is the catalogue\'s truth', async () => {
    const day = await today();
    const old = (await admin.query(`SELECT to_char($1::date - 40, 'YYYY-MM-DD') AS d`, [day])).rows[0].d;
    await pour(tA, old, 'flags');                                        // outside the 30-day window — never counted
    const r = await row(A(), 'adulteration');
    expect(r.fact).toMatchObject({ windowDays: 30, to: day, pours: 3, flaggedPours: 2 });
    expect(r.freshness).toMatchObject({ zone: 'Asia/Kolkata', today: day, stale: false, ageDays: 0 });
    const t = await row(A(), 'audit_trail');
    expect(t.verdict).toBe('published_with_fact');
    expect(t.fact).toMatchObject({ kind: 'audit_trail', appendOnly: true, canInsert: true, canUpdate: false, canDelete: false, canTruncate: false, hashColumns: [], ledgerChained: true });
    expect(t.freshness!.rule).toBe('catalogue_now');
    // eslint-disable-next-line no-console
    console.log(`[9d facts] adulteration ${JSON.stringify(r.fact)} · audit_trail appendOnly=${(t.fact as any).appendOnly} hashColumns=[${(t.fact as any).hashColumns}] ledgerChained=${(t.fact as any).ledgerChained}`);
  });

  it('W424 · the receipt opens UNSIGNED and names every metric left out; the file carries only the gate\'s figures; the enqueue needs esg.disclose', async () => {
    const out = await dataset.produce({ tenantId: tA, requestedBy: adminA, today: await today() }, { lang: 'gu' });
    if (out.kind !== 'file') throw new Error('expected a file');
    const notes = out.file.notes;
    expect(notes[0]).toBe(ESG_UNSIGNED_NOTE);
    const excluded = notes.filter((n) => n.startsWith('excluded: ')).map((n) => n.slice(10).split(' — ')[0]).sort();
    expect(excluded).toEqual(['carbon_participation', 'delay_compensation', 'diesel_per_qtl', 'grievance_channels', 'solar_share_bmc', 'to_farmer_hands',
      'wage_on_time', 'water_per_kg', 'women_participation', 'worksite_facilities', 'worksite_injury_rate']);
    const rows: unknown[][] = []; for await (const r of out.file.rows) rows.push([...r]);
    const figureMetrics = [...new Set(rows.filter((r) => r[3] === 'figure').map((r) => r[1]))].sort();
    expect(figureMetrics).toEqual(['adulteration', 'audit_trail', 'one_member_one_vote']);
    expect(rows.filter((r) => r[3] === 'disclosure').map((r) => r[1])).toEqual(['adulteration']);
    expect(rows.find((r) => r[1] === 'adulteration' && r[3] === 'figure')![6]).toMatch(/[઀-૿]/);    // the method appendix, in Gujarati
    // eslint-disable-next-line no-console
    console.log(`[9d receipt] ${notes.length} notes:\n  ${notes.join('\n  ')}\n[9d file] ${rows.length} rows · figures for ${figureMetrics.join(', ')}`);

    expect(await refusals(esg.enqueueReport(tA, C(), randomUUID(), { lang: 'en' }, null))).toEqual(['NO_PERMISSION']);
    const key = randomUUID();
    await esg.enqueueReport(tA, A(), key, { lang: 'hi' }, '203.0.113.9');
    expect(planeCalls.at(-1)).toEqual({ tenantId: tA, datasetCode: 'esg.metrics', params: { lang: 'hi' }, key });
    const xx = await dataset.produce({ tenantId: tA, requestedBy: adminA, today: await today() }, { lang: 'xx' });
    if (xx.kind !== 'file') throw new Error('expected a file');
    const xxRows: unknown[][] = []; for await (const r of xx.file.rows) xxRows.push([...r]);
    expect(xx.file.notes).toContain('requested language not active; names and methods in en');
    expect(xxRows.find((r) => r[1] === 'adulteration' && r[3] === 'figure')![2]).toBe('Adulteration');
    const off = new EsgMetricsDataset(esg, repo, new UiMessageRepository(null as never), { isEnabled: async () => false } as never);
    expect(await off.produce({ tenantId: tA, requestedBy: adminA, today: await today() }, {})).toEqual({ kind: 'refused', code: 'dataset_disabled', detail: 'flag esg is off for this tenant' });
  });

  it('the dashboard counts, the read-only role, and the method page', async () => {
    await esg.createDisclosure(tA, A(), randomUUID(), { metricCode: 'audit_trail', texts: { en: 'The committee reads the trail at every quarterly meeting.' } });
    expect((await row(A(), 'audit_trail')).drafts.length).toBe(1);
    const d = await esg.dashboard(tA, C());
    expect(d.canDisclose).toBe(false);
    expect(d.rows.every((r) => r.drafts.length === 0)).toBe(true);
    expect(d.counts).toEqual({ published_with_fact: 3, published_no_fact: 0, no_method: 10, no_programme: 1 });
    const m = await esg.method(tA, 'one_member_one_vote');
    expect(m.row.method).toMatchObject({ status: 'published', ref: 'KV-ESG-G1', version: 1, sourceTables: ['coop_resolutions', 'coop_votes'] });
    expect(m.row.method.text!.gu).toMatch(/[઀-૿]/);
    expect(await refusals(esg.method(tA, 'happiness_index'))).toEqual(['NOT_FOUND']);
  });
});
