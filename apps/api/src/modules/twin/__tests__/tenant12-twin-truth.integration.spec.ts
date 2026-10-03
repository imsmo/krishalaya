// modules/twin/__tests__/tenant12-twin-truth.integration.spec.ts · PC-56 TENANT-12 — LIVE proof against real Postgres + RLS (no infra
// mocks). Founder decision: HONEST FRAME, NO MODEL · DEVICE REGISTRY ONLY, READINGS REFUSED · LICENSED BY FEATURE FLAG PER PLAN.
// Each block fails on HEAD 0a85b30 (no twin module or tables, `{}` boundaries accepted, a caller-chosen mandi source, an advisory job
// whose SQL could not parse and named no recipient, no yield unit, ms cursors, unaudited land writes):
//   FLAG   `digital_twin` OFF → the guard answers 404; the Locked page's one ask is idempotent (one row per tenant, audited once);
//   A/B1   a scenario from a template + assumptions WITH citation + as-of (a missing citation is refused and writes nothing); history
//          by trigger, append-only;
//   GATE   run → 409 TWIN_NO_MODEL_REGISTERED + ONE refused twin_runs row (no outputs, no inference, a 64-hex input hash) + audit; a
//          replay is the same row; kv_app cannot write a done row or update a refusal; results print "too few runs — no model";
//   B1     devices register (serial unique per tenant), `last_reading_at` NULL; retire needs a reason;
//   B3     boundary `{}` refused; a valid polygon counted "1 of 2 mapped";
//   B5     a tenant mandi price is forced tenant_manual + tenant-scoped; kv_app cannot write a platform row; a typed band is refused;
//   B6     the advisory job runs through kv_app, emits with recipients (parcel owners under the region, severe-only honoured), once;
//          its SQL PREPAREs;
//   B9     actual yield last full season prints only where yield unit AND area unit convert, over ≥ min_group_size members;
//   B10    parcels and scenarios written in ONE millisecond page exactly once (µs cursor); land writes audited with ip / reason;
//   B7/B4/B8 kv_app probes: INSERT ai_models / plan_features / NULL-tenant mandi_prices / NULL-tenant crop_calendars refused;
//          tenant_admin reads its own tenant's inferences only (ai.inference.read);
//   RLS    tenant B sees none of A's twin rows.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { Reflector } from '@nestjs/core';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { QuotaService } from '../../../core/quota/quota.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { TwinRepository } from '../repositories/twin.repository';
import { TwinFactsReadModel } from '../read-models/twin-facts.read-model';
import { TwinActor, TwinService } from '../services/twin.service';
import { TwinDevicesService } from '../services/twin-devices.service';
import { TwinAccessService } from '../services/twin-access.service';
import { TwinController } from '../controllers/v1/twin.controller';
import { LandParcelRepository } from '../../land-soil-weather/repositories/land-parcel.repository';
import { CropSeasonRepository } from '../../land-soil-weather/repositories/crop-season.repository';
import { SoilTestRepository } from '../../land-soil-weather/repositories/soil-test.repository';
import { LandParcelService, LandActor } from '../../land-soil-weather/services/land-parcel.service';
import { CropSeasonService } from '../../land-soil-weather/services/crop-season.service';
import { SoilTestService } from '../../land-soil-weather/services/soil-test.service';
import { WeatherAdvisoryPushJob, DUE_ALERTS_SQL } from '../../land-soil-weather/jobs/weather-advisory-push.job';
import { MandiPriceRepository } from '../../market-intel/repositories/mandi-price.repository';
import { PriceAlertRepository } from '../../market-intel/repositories/price-alert.repository';
import { PricePredictionRepository } from '../../market-intel/repositories/price-prediction.repository';
import { MarketNamesReadModel } from '../../market-intel/read-models/market-names.read-model';
import { MarketSettingsReadModel } from '../../market-intel/read-models/market-settings.read-model';
import { MandiPriceService } from '../../market-intel/services/mandi-price.service';
import { PricePredictionService } from '../../market-intel/services/price-prediction.service';
import { AiInferenceService } from '../../ai-governance/services/ai-inference.service';
import { AiGovernancePublisher } from '../../ai-governance/events/ai-governance.publisher';
import { AiInferenceRepository } from '../../ai-governance/repositories/ai-inference.repository';
import { AiReviewRepository } from '../../ai-governance/repositories/ai-review.repository';
import { AiModelRepository } from '../../ai-governance/repositories/ai-model.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }
const key = () => `idem-${randomUUID()}`;
const IP = '10.0.12.12';
const GUJARAT = '11111111-0000-7000-8000-000000000001';
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const CITE = 'IMD district rainfall statement, Junagadh, June 2026';
const CITE2 = 'FPO member census 2026, median holding size';
const poly = (dx = 0) => ({ type: 'Polygon', coordinates: [[[70.1 + dx, 21.1], [70.2 + dx, 21.1], [70.2 + dx, 21.2], [70.1 + dx, 21.1]]] });

run('PC-56 TENANT-12 · the digital twin — honest frame, no model; device registry only; licensed by flag (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let replica: PgReadReplicaProvider; let config: AppConfig;
  let twin: TwinService; let devices: TwinDevicesService; let access: TwinAccessService; let flags: FlagsService;
  let parcels: LandParcelService; let seasons: CropSeasonService; let soil: SoilTestService; let prices: MandiPriceService; let predictions: PricePredictionService;
  let job: WeatherAdvisoryPushJob; let inferences: AiInferenceService; let outbox: PgOutboxWriter; let ui: UiMessageRepository; let audit: AuditWriter; let idem: PgIdempotencyService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminU = randomUUID(); const coord = randomUUID(); const staff = randomUUID(); const adminB = randomUUID();
  const farmers = Array.from({ length: 6 }, () => randomUUID());
  const actors: Record<string, TwinActor> = {};
  let productId = ''; let product2 = ''; let S1 = ''; let alertId = ''; let severeId = '';

  const auditOf = async (entityId: string, action: string) => (await admin.query(`SELECT * FROM audit_log WHERE entity_id=$1 AND action=$2 ORDER BY created_at`, [entityId, action])).rows;
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
  const errOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; details?: any; httpStatus?: number }) => e);
  const refusals = (e: any) => (e?.details?.refusals ?? []).map((r: { field: string | null; code: string }) => `${r.field ?? '*'}:${r.code}`);
  const permsOf = async (role: string) => new Set((await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code=$1`, [role])).rows.map((x: { permission_code: string }) => x.permission_code));
  const addRole = async (u: string, role: string, tenant = tenantA) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code=$1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  const farmerActor = (u: string): LandActor => ({ userId: u, canManage: true, isAdmin: false, ip: IP, requestId: null });
  /** A kv_app session under a tenant: each probe in its own SAVEPOINT, so one refusal does not end the transaction. */
  async function asApp<T>(tenantId: string, fn: (c: PoolClient, probe: (sql: string, p?: unknown[]) => Promise<string>) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); return (e as { code?: string }).code ?? 'error'; }
      };
      return await fn(c, probe);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'Junagadh Groundnut FPO'); await makeTenant(admin, tenantB, 'B');
    const names: Record<string, string> = { [adminU]: 'Hetal Ben Admin', [coord]: 'Rakesh Solanki', [staff]: 'Staff Desk', [adminB]: 'Other Admin' };
    farmers.forEach((f, i) => { names[f] = `Farmer ${String.fromCharCode(65 + i)} Patel`; });
    for (const [u, n] of Object.entries(names)) { await makeUser(admin, u as ReturnType<typeof randomUUID>); await admin.query(`UPDATE users SET full_name=$2 WHERE id=$1`, [u, n]); }
    await addRole(adminU, 'tenant_admin'); await addRole(coord, 'fpo_coordinator'); await addRole(staff, 'tenant_staff'); await addRole(adminB, 'tenant_admin', tenantB);
    for (const f of farmers) await addRole(f, 'farmer');
    await ensureUnitCurrency(admin, 'quintal');
    // (inline, not makeCategory/makeProduct: those carry the known `inconsistent types deduced for parameter $2` fixture bug)
    const cat = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Oilseeds',$3::ltree,1,true)`, [cat, code, code]);
    productId = randomUUID(); product2 = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Groundnut GG-20','quintal',NULL,true, to_tsvector('simple','groundnut'))`, [productId, cat]);
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Cumin','quintal',NULL,true, to_tsvector('simple','cumin'))`, [product2, cat]);
    for (const [u, role] of [[adminU, 'tenant_admin'], [coord, 'fpo_coordinator'], [staff, 'tenant_staff'], [adminB, 'tenant_admin']] as const) {
      actors[u] = { userId: u, permissions: await permsOf(role), ip: IP, requestId: null };
    }

    config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    replica = new PgReadReplicaProvider(pools, shards);
    outbox = new PgOutboxWriter(); idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); audit = new AuditWriter(pools);
    flags = new FlagsService(pools, new InMemoryCacheService()); ui = new UiMessageRepository(replica as never);
    const repo = new TwinRepository(replica as never); const facts = new TwinFactsReadModel(replica as never);
    twin = new TwinService(uow, idem, repo, facts, audit, config);
    devices = new TwinDevicesService(uow, idem, repo, audit);
    access = new TwinAccessService(uow, idem, repo, audit, flags);
    const parcelRepo = new LandParcelRepository(replica as never);
    parcels = new LandParcelService(uow, outbox, idem, new AllowAllQuota(), metrics, parcelRepo, audit);
    seasons = new CropSeasonService(uow, outbox, idem, metrics, new CropSeasonRepository(replica as never), parcelRepo, audit);
    soil = new SoilTestService(uow, outbox, idem, metrics, new SoilTestRepository(replica as never), parcelRepo, audit);
    const priceRepo = new MandiPriceRepository(replica as never);
    prices = new MandiPriceService(uow, outbox, idem, metrics, priceRepo, new PriceAlertRepository(replica as never), new MarketNamesReadModel(replica as never), new MarketSettingsReadModel(pools));
    predictions = new PricePredictionService(uow, outbox, metrics, new PricePredictionRepository(replica as never), priceRepo);
    job = new WeatherAdvisoryPushJob(60_000, uow, outbox, flags, ui);
    inferences = new AiInferenceService(uow, new AiGovernancePublisher(outbox), idem, metrics, new AiInferenceRepository(replica as never), new AiReviewRepository(replica as never), new AiModelRepository(replica as never));
  }, 120_000);

  afterAll(async () => {
    // the flag goes back to its seeded state (OFF, 100 %, no rules) — this spec is re-runnable on one built database
    await admin?.query(`UPDATE feature_flags SET is_enabled=false, rollout_pct=100, rules='{}'::jsonb WHERE key='digital_twin'`).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  it('FLAG · `digital_twin` is seeded OFF → the twin routes answer 404; the Locked page reads its state; "ask your account desk" is ONE row', async () => {
    const flag = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key='digital_twin'`)).rows[0];
    expect(flag).toMatchObject({ is_enabled: false });
    const guard = new FeatureFlagGuard(new Reflector(), flags);
    const ctx = { getClass: () => TwinController, getHandler: () => TwinController.prototype.overview } as never;
    expect(await codeOf(guard.canActivate(ctx))).toBe('NOT_FOUND');
    expect(await flags.isEnabled('digital_twin', { tenantId: tenantA })).toBe(false);

    const s0 = await access.state(tenantA, actors[staff]);
    expect(s0).toEqual({ enabled: false, request: null, canRequest: true });
    const k = key();
    const first = await access.request(tenantA, actors[staff], k);
    expect(first).toMatchObject({ enabled: false, written: true });
    expect(await access.request(tenantA, actors[staff], k)).toEqual(first);                      // the same key replays
    const second = await access.request(tenantA, actors[adminU], key());                          // another person, another key
    expect(second).toMatchObject({ enabled: false, written: false, request: { id: first.request!.id, requestedAt: first.request!.requestedAt } });
    const rows = (await admin.query(`SELECT * FROM twin_access_requests WHERE tenant_id=$1`, [tenantA])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].requested_by).toBe(staff);
    expect(await auditOf(rows[0].id, 'twin.access_requested')).toHaveLength(1);
    expect((await access.state(tenantA, actors[adminU]))).toMatchObject({ enabled: false, canRequest: false, request: { requestedBy: 'Staff D.' } });
    expect(await codeOf(access.state(tenantA, { userId: farmers[0], permissions: await permsOf('farmer'), ip: IP, requestId: null }))).toBe('TWIN_FORBIDDEN');
    // kv_app cannot remove or rewrite the request
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`UPDATE twin_access_requests SET requested_by=$1`, [adminU])).toBe('42501'); });

    // licensed per tenant through the flag engine (admin-plane rules.tenant_ids): A on, B still off
    // (rollout_pct 0: the allowlist is the ONLY way in — a flag at 100 % would license every tenant the allowlist does not name)
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=0, rules='{"tenant_ids":["${tenantA}"]}'::jsonb WHERE key='digital_twin'`);
    const fresh = new FlagsService(pools, new InMemoryCacheService());
    expect(await fresh.isEnabled('digital_twin', { tenantId: tenantA })).toBe(true);
    expect(await fresh.isEnabled('digital_twin', { tenantId: tenantB })).toBe(false);
  });

  it('A/B1 · a scenario from a template; assumptions need a CITATION and an AS-OF (missing → refused, nothing written); history by trigger', async () => {
    const cat = await twin.catalogue(tenantA, actors[coord]);
    expect(cat.templates.find((t) => t.code === 'rainfall_shock')).toEqual({ code: 'rainfall_shock', keys: ['rainfall_delta_pct', 'member_profile_area_ha'] });
    expect(cat).toMatchObject({ minGroupSize: 5, canRun: true, model: { code: 'twin.scenario', registered: false } });
    expect(refusals(await errOf(twin.createScenario(tenantA, actors[staff], key(), { name: 'Monsoon −20%', templateCode: 'rainfall_shock' })))).toEqual(['*:NO_PERMISSION']);
    expect(refusals(await errOf(twin.createScenario(tenantA, actors[coord], key(), { name: 'x', templateCode: 'nope' })))).toEqual(['name:NAME_TOO_SHORT', 'templateCode:TEMPLATE_UNKNOWN']);
    const k = key();
    const s = await twin.createScenario(tenantA, actors[coord], k, { name: 'Monsoon −20% · rainfall shock', templateCode: 'rainfall_shock', productId });
    expect(await twin.createScenario(tenantA, actors[coord], k, { name: 'Monsoon −20% · rainfall shock', templateCode: 'rainfall_shock', productId })).toEqual(s);
    S1 = s.id;
    expect(s).toMatchObject({ status: 'draft', templateKeys: ['rainfall_delta_pct', 'member_profile_area_ha'] });
    expect((await auditOf(S1, 'twin.scenario.created'))[0]).toMatchObject({ actor_user_id: coord, ip: IP });

    // a value with no citation / no as-of: refused by name, at preview AND at save — and nothing is written
    const bare = [{ key: 'rainfall_delta_pct', value: '-20' }];
    const p = await twin.previewAssumptions(tenantA, actors[coord], S1, bare);
    expect(p.ready).toBe(false);
    expect(p.refusals.map((r) => `${r.field}:${r.code}`)).toEqual(['rainfall_delta_pct.citation:CITATION_REQUIRED', 'rainfall_delta_pct.asOf:ASOF_REQUIRED']);
    expect(refusals(await errOf(twin.saveAssumptions(tenantA, actors[coord], S1, key(), bare)))).toEqual(['rainfall_delta_pct.citation:CITATION_REQUIRED', 'rainfall_delta_pct.asOf:ASOF_REQUIRED']);
    expect((await admin.query(`SELECT count(*)::int n FROM twin_assumptions WHERE scenario_id=$1`, [S1])).rows[0].n).toBe(0);
    // the DB is the floor under the review: kv_app cannot store a value without a citation
    await asApp(tenantA, async (_c, probe) => {
      expect(await probe(`INSERT INTO twin_assumptions (tenant_id, scenario_id, key_code, value, unit_code, source_citation, source_asof, set_by) VALUES ($1,$2,'rainfall_delta_pct',-20,'pct','',current_date,$3)`, [tenantA, S1, coord])).toBe('23514');
      expect(await probe(`INSERT INTO twin_assumptions (tenant_id, scenario_id, key_code, value, unit_code, source_citation, source_asof, set_by) VALUES ($1,$2,'rainfall_delta_pct',-20,'pct',$4,NULL,$3)`, [tenantA, S1, coord, CITE])).toBe('23502');
    });

    const set = [{ key: 'rainfall_delta_pct', value: '-20', citation: CITE, asOf: '2026-06-30' }, { key: 'member_profile_area_ha', value: '1.2', citation: CITE2, asOf: '2026-04-01' }];
    const preview = await twin.previewAssumptions(tenantA, actors[coord], S1, set);
    expect(preview).toMatchObject({ ready: true, statusAfter: 'ready' });
    const saved = await twin.saveAssumptions(tenantA, actors[coord], S1, key(), set);
    expect(saved).toEqual({ id: S1, status: 'ready', changed: 2 });
    const au = await auditOf(S1, 'twin.assumptions.saved');
    expect(au[0]).toMatchObject({ actor_user_id: coord, ip: IP });
    expect(au[0].old_value).toMatchObject({ status: 'draft', assumptions: [null, null] });
    expect(au[0].new_value.assumptions[0]).toMatchObject({ key: 'rainfall_delta_pct', value: '-20', citation: CITE, asOf: '2026-06-30' });

    // an edit: history keeps the old value, its citation and as-of
    await twin.saveAssumptions(tenantA, actors[adminU], S1, key(), [{ key: 'rainfall_delta_pct', value: '-25', citation: 'IMD revised statement, Junagadh, 10 July 2026', asOf: '2026-07-10' }]);
    const d = await twin.scenario(tenantA, actors[staff], S1);
    expect(d.assumptions.find((a) => a.key === 'rainfall_delta_pct')).toMatchObject({ value: '-25', asOf: '2026-07-10', setBy: 'Hetal A.' });
    expect(d.history).toHaveLength(3);
    expect(d.history[0]).toMatchObject({ key: 'rainfall_delta_pct', oldValue: '-20.0000', newValue: '-25.0000', oldCitation: CITE, oldAsOf: '2026-06-30', setBy: 'Hetal A.' });
    expect(d.history.slice(1).map((h) => [h.key, h.oldValue, h.newValue, h.setBy]).sort()).toEqual([['member_profile_area_ha', null, '1.2000', 'Rakesh S.'], ['rainfall_delta_pct', null, '-20.0000', 'Rakesh S.']]);
    expect(d.missingKeys).toEqual([]);
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`UPDATE twin_assumption_history SET new_value = 0 WHERE scenario_id=$1`, [S1])).toBe('42501'); });
  });

  it('GATE · run → 409 TWIN_NO_MODEL_REGISTERED, ONE refused row (no outputs, no inference, input hash) + audit; replay = same row; no band anywhere', async () => {
    expect((await admin.query(`SELECT count(*)::int n FROM ai_models WHERE code='twin.scenario'`)).rows[0].n).toBe(0);
    const pre = await twin.previewAct(tenantA, actors[coord], S1, 'run');
    expect(pre).toMatchObject({ allowed: true, gate: { code: 'TWIN_NO_MODEL_REGISTERED', willBeRefused: true }, assumptions: 2 });
    expect(refusals(await errOf(twin.run(tenantA, actors[staff], S1, key())))).toEqual(['*:NO_PERMISSION']);
    const k = key();
    const e = await errOf(twin.run(tenantA, actors[coord], S1, k));
    expect(e).toMatchObject({ code: 'TWIN_NO_MODEL_REGISTERED', httpStatus: 409, details: { gate: 'ai_models', modelCode: 'twin.scenario', scenarioId: S1, recorded: true } });
    const runId = e!.details.runId as string;
    const row = (await admin.query(`SELECT * FROM twin_runs WHERE id=$1`, [runId])).rows[0];
    expect(row).toMatchObject({ tenant_id: tenantA, scenario_id: S1, status: 'refused', refusal_code: 'TWIN_NO_MODEL_REGISTERED', outputs: null, ai_inference_id: null, seed: null,
      model_code: null, model_version: null, requested_by: coord });
    expect(row.input_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.assumption_snapshot).toEqual([
      { key: 'member_profile_area_ha', value: '1.2', unit: 'hectare', citation: CITE2, asOf: '2026-04-01' },
      { key: 'rainfall_delta_pct', value: '-25', unit: 'pct', citation: 'IMD revised statement, Junagadh, 10 July 2026', asOf: '2026-07-10' }]);
    const au = await auditOf(runId, 'twin.run.refused');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: coord, ip: IP, reason: 'TWIN_NO_MODEL_REGISTERED' });
    expect(au[0].new_value).toMatchObject({ status: 'refused', modelRegistered: false, inputSnapshotHash: row.input_snapshot_hash, assumptions: 2 });
    // replay with the same key: the same recorded refusal, one row
    const again = await errOf(twin.run(tenantA, actors[coord], S1, k));
    expect(again).toMatchObject({ code: 'TWIN_NO_MODEL_REGISTERED', details: { runId } });
    expect((await admin.query(`SELECT count(*)::int n FROM twin_runs WHERE scenario_id=$1`, [S1])).rows[0].n).toBe(1);
    // a second, deliberate attempt is a second record (the honest count of asks)
    await errOf(twin.run(tenantA, actors[adminU], S1, key()));
    expect((await admin.query(`SELECT count(*)::int n FROM twin_runs WHERE scenario_id=$1 AND status='refused'`, [S1])).rows[0].n).toBe(2);

    // the DB refuses every band-shaped write the tenant role could attempt
    await asApp(tenantA, async (_c, probe) => {
      expect(await probe(`UPDATE twin_runs SET status='done', outputs='{"p50":16.1}' WHERE id=$1`, [runId])).toBe('42501');
      expect(await probe(`INSERT INTO twin_runs (tenant_id, scenario_id, status, input_snapshot_hash, assumption_snapshot, requested_by, refusal_code, outputs, idempotency_key)
                          VALUES ($1,$2,'refused',$3,'[]',$4,'TWIN_NO_MODEL_REGISTERED','{"p50":16.1}','x1')`, [tenantA, S1, 'c'.repeat(64), coord])).toBe('23514');
      expect(await probe(`INSERT INTO twin_runs (tenant_id, scenario_id, status, model_code, model_version, model_id, input_snapshot_hash, assumption_snapshot, seed, requested_by, outputs, ai_inference_id, idempotency_key)
                          VALUES ($1,$2,'done','twin.scenario','0.9',$5,$3,'[]',7,$4,'{"p50":16.1}',1,'x2')`, [tenantA, S1, 'd'.repeat(64), coord, randomUUID()])).toMatch(/23503|23514/);
    });

    const list = await twin.listScenarios(tenantA, actors[staff], { limit: 10 });
    const item = list.items.find((x) => x.id === S1)!;
    expect(item).toMatchObject({ status: 'ready', attempts: 2, cell: { state: 'too_few_runs_no_model' }, lastAttempt: { status: 'refused', refusalCode: 'TWIN_NO_MODEL_REGISTERED', modelCode: null, modelVersion: null } });
    expect(JSON.stringify(list)).not.toMatch(/p10|p50|p90|outputs|inputSnapshotHash/i);
    const r = await twin.results(tenantA, actors[staff], S1);
    expect(r.pair[0].cells).toEqual({ yield: { state: 'too_few_runs_no_model' }, income: { state: 'too_few_runs_no_model' } });
    expect(r.proposal).toEqual({ available: false, reason: 'no_run_to_cite' });
    expect(r.model).toEqual({ code: 'twin.scenario', registered: false });
    // F-14: a governance draft cannot cite a refused attempt — even the admin realm is refused by the trigger; kv_app holds no grant
    const resId = randomUUID();
    await admin.query(`INSERT INTO coop_resolutions (id, tenant_id, title, resolution_type, status) VALUES ($1,$2,'Proposal from Monsoon −20%','agm_vote','draft')`, [resId, tenantA]);
    expect(await codeOf(admin.query(`UPDATE coop_resolutions SET source_ref=$1::jsonb WHERE id=$2`, [JSON.stringify({ kind: 'twin_run', id: runId }), resId]))).toBe('23514');
    expect(await codeOf(admin.query(`UPDATE coop_resolutions SET source_ref='{"kind":"twin_run","id":"x"}'::jsonb WHERE id=$1`, [resId]))).toBe('23514');
    await asApp(tenantA, async (_c, probe) => {
      expect(await probe(`UPDATE coop_resolutions SET source_ref = $1::jsonb WHERE id=$2`, [JSON.stringify({ kind: 'twin_run', id: runId }), resId])).toBe('42501');
    });
  });

  it('B1 · devices: registry only — serial unique per tenant, last_reading_at NULL, retire needs a reason; readings refused by name', async () => {
    expect(refusals(await errOf(devices.register(tenantA, actors[coord], key(), { kind: 'soil_pod', serial: 'SP-0031' })))).toEqual(['*:NO_PERMISSION']);
    expect(refusals(await errOf(devices.register(tenantA, actors[adminU], key(), { kind: 'drone', serial: 'x' })))).toEqual(['kind:KIND_UNKNOWN', 'serial:SERIAL_INVALID']);
    const d1 = await devices.register(tenantA, actors[adminU], key(), { kind: 'soil_pod', serial: 'SP-0031', label: 'North field pod' });
    expect(d1).toEqual({ id: expect.any(String), status: 'registered', lastReadingAt: null });
    await devices.register(tenantA, actors[adminU], key(), { kind: 'weather_mast', serial: 'WM-005' });
    expect(refusals(await errOf(devices.register(tenantA, actors[adminU], key(), { kind: 'soil_pod', serial: 'SP-0031' })))).toEqual(['serial:SERIAL_TAKEN']);
    expect(await devices.register(tenantB, actors[adminB], key(), { kind: 'soil_pod', serial: 'SP-0031' })).toMatchObject({ status: 'registered' });   // per tenant
    const row = (await admin.query(`SELECT * FROM twin_devices WHERE id=$1`, [d1.id])).rows[0];
    expect(row).toMatchObject({ tenant_id: tenantA, kind_code: 'soil_pod', serial: 'SP-0031', last_reading_at: null, registered_by: adminU });
    expect((await auditOf(d1.id, 'twin.device.registered'))[0]).toMatchObject({ actor_user_id: adminU, ip: IP });
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`UPDATE twin_devices SET last_reading_at = now() WHERE id=$1`, [d1.id])).toBe('42501'); });
    expect(refusals(await errOf(devices.retire(tenantA, actors[adminU], d1.id, key(), '')))).toEqual(['reason:REASON_REQUIRED']);
    const page = await devices.list(tenantA, actors[staff], { limit: 10 });
    expect(page).toMatchObject({ canManage: false, ingestion: 'not_built' });
    expect(page.items.every((x) => x.readings === 'none' && x.lastReadingAt === null)).toBe(true);
    const ov = await twin.overview(tenantA, actors[staff]);
    expect(ov.devices).toMatchObject({ soilPods: 1, weatherMasts: 1, withReading: 0, readings: 'none', ingestion: 'not_built' });
    expect(ov.feeds.find((f) => f.code === 'devices')).toMatchObject({ state: 'not_connected', detail: { soilPods: 1, weatherMasts: 1, readings: 0, ingestion: 'not_built' } });
  });

  it('B3 · a boundary `{}` is refused; a valid polygon is counted — "1 of 2 mapped (2 = parcels registered in this tenant)"', async () => {
    expect(await codeOf(parcels.register(tenantA, farmerActor(farmers[0]), key(), { areaValue: '1', areaUnit: 'hectare', isTenantFarmed: false, boundaryGeojson: {} } as never))).toBe('PARCEL_BOUNDARY_INVALID');
    const open = { type: 'Polygon', coordinates: [[[70.1, 21.1], [70.2, 21.1], [70.2, 21.2], [70.1, 21.3]]] };
    const e = await errOf(parcels.register(tenantA, farmerActor(farmers[0]), key(), { areaValue: '1', areaUnit: 'hectare', isTenantFarmed: false, boundaryGeojson: open } as never));
    expect(e).toMatchObject({ code: 'PARCEL_BOUNDARY_INVALID', details: { refusal: 'RING_NOT_CLOSED' } });
    const pA = await parcels.register(tenantA, farmerActor(farmers[0]), key(), { areaValue: '1', areaUnit: 'hectare', regionId: JUNAGADH, isTenantFarmed: false, boundaryGeojson: poly() } as never);
    await parcels.register(tenantA, farmerActor(farmers[1]), key(), { areaValue: '2.4711', areaUnit: 'acre', regionId: JUNAGADH, isTenantFarmed: false } as never);
    expect((await auditOf(pA.id, 'land.parcel.registered'))[0]).toMatchObject({ actor_user_id: farmers[0], ip: IP });
    expect((await auditOf(pA.id, 'land.parcel.registered'))[0].new_value).toMatchObject({ boundary: 'Polygon', area: '1.0000', areaUnit: 'hectare' });
    // the DB floor: kv_app cannot store `{}` either
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`UPDATE land_parcels SET boundary_geojson='{}'::jsonb WHERE id=$1`, [pA.id])).toBe('23514'); });
    const ov = await twin.overview(tenantA, actors[staff]);
    expect(ov.parcels).toMatchObject({ registered: 2, mapped: 1, unmapped: 1 });
    expect(ov.parcels.asOf).not.toBeNull();
    expect(ov.herd).toEqual({ linked: false, reason: 'no_bmc_link' });
  });

  it('B10 · land writes are audited; the desk corrects another member\'s parcel only with a reason; soil tests are keyed; abandon needs a reason', async () => {
    const mine = await parcels.list(tenantA, farmerActor(farmers[0]), { box: 'mine', limit: 10 });
    const pA = mine.items[0];
    const desk: LandActor = { userId: coord, canManage: false, isAdmin: (await permsOf('fpo_coordinator')).has('land.admin'), ip: IP };
    expect(desk.isAdmin).toBe(true);
    expect(await codeOf(parcels.list(tenantA, farmerActor(farmers[0]), { box: 'all', limit: 10 }))).toBe('LAND_FORBIDDEN');
    expect(await codeOf(parcels.update(tenantA, desk, pA.id, { surveyNo: '123/4' } as never))).toBe('PARCEL_REASON_REQUIRED');
    await parcels.update(tenantA, desk, pA.id, { surveyNo: '123/4', reason: 'survey number from the 7/12 extract' } as never);
    const au = await auditOf(pA.id, 'land.parcel.corrected_by_desk');
    expect(au[0]).toMatchObject({ actor_user_id: coord, reason: 'survey number from the 7/12 extract', ip: IP });
    expect(au[0].old_value).toMatchObject({ surveyNo: null }); expect(au[0].new_value).toMatchObject({ surveyNo: '123/4', ownerUserId: farmers[0] });

    const k = key();
    const t1 = await soil.record(tenantA, farmerActor(farmers[0]), k, { parcelId: pA.id, sampledOn: '2026-05-01', results: { ph: 6.8, n: 280 }, recommendations: {} } as never);
    const t2 = await soil.record(tenantA, farmerActor(farmers[0]), k, { parcelId: pA.id, sampledOn: '2026-05-01', results: { ph: 6.8, n: 280 }, recommendations: {} } as never);
    expect(t2.id).toBe(t1.id);
    expect((await admin.query(`SELECT count(*)::int n FROM soil_tests WHERE parcel_id=$1`, [pA.id])).rows[0].n).toBe(1);
    expect(t1.sampledOn).toBe('2026-05-01');                                        // pg-date: never a day early (TZ=Asia/Kolkata)
    expect((await auditOf(t1.id, 'land.soil_test.recorded'))[0]).toMatchObject({ actor_user_id: farmers[0], ip: IP });
    const ov = await twin.overview(tenantA, actors[staff]);
    expect(ov.soil).toMatchObject({ tests: 1, parcelsTested: 1, latestSampledOn: '2026-05-01' });
    expect(ov.feeds.find((f) => f.code === 'soil_tests')).toMatchObject({ state: 'recorded', asOf: '2026-05-01' });

    const c = await seasons.plan(tenantA, farmerActor(farmers[0]), key(), { parcelId: pA.id, productId: product2, season: 'rabi', year: 2026 } as never);
    expect(await codeOf(seasons.abandon(tenantA, farmerActor(farmers[0]), c.id, { reason: '' } as never))).toBe('CROP_SEASON_INVALID');
    await seasons.abandon(tenantA, farmerActor(farmers[0]), c.id, { reason: 'hailstorm flattened the crop' } as never);
    expect((await auditOf(c.id, 'land.crop_season.abandoned'))[0]).toMatchObject({ reason: 'hailstorm flattened the crop', ip: IP });
    expect((await auditOf(c.id, 'land.crop_season.planned'))).toHaveLength(1);
  });

  it('B9 · actual yield, last full season, qtl/ha — only where the yield unit AND the area unit convert, over ≥ 5 members', async () => {
    // a harvest without a unit, or in a non-mass unit, is refused by the service (and 0190's CHECK is the floor)
    const p0 = (await parcels.list(tenantA, farmerActor(farmers[0]), { box: 'mine', limit: 1 })).items[0];
    const c = await seasons.plan(tenantA, farmerActor(farmers[0]), key(), { parcelId: p0.id, productId, season: 'kharif', year: 2025 } as never);
    await seasons.sow(tenantA, farmerActor(farmers[0]), c.id, { sownOn: '2025-06-20' });
    expect(await codeOf(seasons.harvest(tenantA, farmerActor(farmers[0]), c.id, { actualYield: '20' }))).toBe('YIELD_UNIT_REQUIRED');
    expect(await codeOf(seasons.harvest(tenantA, farmerActor(farmers[0]), c.id, { actualYield: '20', yieldUnitCode: 'litre' }))).toBe('YIELD_UNIT_NOT_MASS');
    const h = await seasons.harvest(tenantA, farmerActor(farmers[0]), c.id, { actualYield: '20', yieldUnitCode: 'quintal' });
    expect(h).toMatchObject({ status: 'harvested', actualYield: '20.000', yieldUnitCode: 'quintal' });
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`UPDATE crop_seasons SET yield_unit_code=NULL WHERE id=$1`, [c.id])).toBe('23514'); });

    // with only one member's harvest the fact is below the floor (aggregate-only)
    expect((await twin.results(tenantA, actors[staff], S1)).pair[0].fact).toEqual({ state: 'below_group_floor', year: 2025, season: 'kharif', members: 1, floor: 5 });

    // four more members: 18 qtl (in kg, on an acre parcel), 20, 19, 20 → Σ 97 qtl over 5 ha = 19.4 qtl/ha
    const p1 = (await parcels.list(tenantA, farmerActor(farmers[1]), { box: 'mine', limit: 1 })).items[0];   // 2.4711 acre ≈ 1 ha
    const c1 = await seasons.plan(tenantA, farmerActor(farmers[1]), key(), { parcelId: p1.id, productId, season: 'kharif', year: 2025 } as never);
    await seasons.sow(tenantA, farmerActor(farmers[1]), c1.id, { sownOn: '2025-06-20' });
    await seasons.harvest(tenantA, farmerActor(farmers[1]), c1.id, { actualYield: '1800', yieldUnitCode: 'kg' });
    for (const [i, y] of [[2, '20'], [3, '19'], [4, '20']] as const) {
      const p = await parcels.register(tenantA, farmerActor(farmers[i]), key(), { areaValue: '1', areaUnit: 'hectare', regionId: JUNAGADH, isTenantFarmed: false } as never);
      const s = await seasons.plan(tenantA, farmerActor(farmers[i]), key(), { parcelId: p.id, productId, season: 'kharif', year: 2025, expectedYield: '21', yieldUnitCode: 'quintal' } as never);
      await seasons.sow(tenantA, farmerActor(farmers[i]), s.id, { sownOn: '2025-06-21' });
      await seasons.harvest(tenantA, farmerActor(farmers[i]), s.id, { actualYield: y });            // the season's own unit carries over
    }
    const r = await twin.results(tenantA, actors[staff], S1);
    expect(r.pair[0].fact).toEqual({ state: 'shown', qtlPerHa: '19.4', year: 2025, season: 'kharif', seasons: 5, members: 5, notComparable: 0 });
    expect(r.minGroupSize).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/AiBadge|aiDisclosure/);

    // a crop whose parcels carry an area unit with no conversion to hectare: "not comparable — unit missing", never guessed
    const S2 = (await twin.createScenario(tenantA, actors[coord], key(), { name: 'Cumin price shock', templateCode: 'price_shock', productId: product2 })).id;
    for (const i of [0, 1, 2, 3, 4]) {
      const p = await parcels.register(tenantA, farmerActor(farmers[i]), key(), { areaValue: '3', areaUnit: 'bag', isTenantFarmed: false } as never);
      const s = await seasons.plan(tenantA, farmerActor(farmers[i]), key(), { parcelId: p.id, productId: product2, season: 'rabi', year: 2025 } as never);
      await seasons.sow(tenantA, farmerActor(farmers[i]), s.id, { sownOn: '2025-11-20' });
      await seasons.harvest(tenantA, farmerActor(farmers[i]), s.id, { actualYield: '6', yieldUnitCode: 'quintal' });
    }
    const r2 = await twin.results(tenantA, actors[staff], S1, S2);
    expect(r2.pair[1].fact).toEqual({ state: 'not_comparable_unit_missing', year: 2025, season: 'rabi', seasons: 5 });
    expect(r2.pair.map((x) => x.cells.yield.state)).toEqual(['too_few_runs_no_model', 'too_few_runs_no_model']);
  });

  it('B5 · a tenant mandi price is forced tenant_manual + tenant-scoped; kv_app cannot write a platform row; a typed band is refused (409)', async () => {
    const adminLand = { userId: adminU, canManage: true };
    const out = await prices.ingest(tenantA, adminLand, key(), { productId, regionId: JUNAGADH, priceDate: '2026-10-01', modalMinor: '642000', unitCode: 'quintal', source: 'agmarknet' } as never);
    expect(out).toMatchObject({ source: 'tenant_manual', tenantObservation: true });
    const row = (await admin.query(`SELECT tenant_id, source, entered_by FROM mandi_prices WHERE id=$1`, [out.id])).rows[0];
    expect(row).toEqual({ tenant_id: tenantA, source: 'tenant_manual', entered_by: adminU });
    await asApp(tenantB, async (c) => { expect((await c.query(`SELECT count(*)::int n FROM mandi_prices WHERE id=$1`, [out.id])).rows[0].n).toBe(0); });
    await asApp(tenantA, async (c, probe) => {
      expect((await c.query(`SELECT count(*)::int n FROM mandi_prices WHERE id=$1`, [out.id])).rows[0].n).toBe(1);
      expect(await probe(`INSERT INTO mandi_prices (product_id, price_date, modal_minor, source) VALUES ($1, current_date, 100, 'agmarknet')`, [productId])).toBe('42501');
      expect(await probe(`INSERT INTO mandi_prices (product_id, price_date, modal_minor, source, tenant_id) VALUES ($1, current_date, 100, 'agmarknet', $2)`, [productId, tenantA])).toBe('23514');
      expect(await probe(`UPDATE mandi_prices SET modal_minor = 1 WHERE id=$1`, [out.id])).toBe('42501');
    });
    expect(await codeOf(predictions.generate(tenantA, adminLand, { productId, regionId: JUNAGADH, targetDate: '2026-10-10', lookbackDays: 90 }))).toBe('MARKET_PREDICTION_REFUSED');
    const ov = await twin.overview(tenantA, actors[staff]);
    expect(ov.mandi).toMatchObject({ tenantObservations: 1, tenantAsOf: '2026-10-01' });
    const feed = ov.feeds.find((f) => f.code === 'mandi_prices')!;
    // the twin cites PLATFORM rows only; a tenant observation is never presented as "the daily mandi feed"
    expect(feed.detail.tenantObservations).toBe(1);
    if (ov.mandi.platformRows === 0) expect(feed).toMatchObject({ state: 'none', asOf: null });
  });

  it('B6 · the advisory job runs through kv_app and emits WITH recipients (parcel owners under the region; severe-only honoured), once; its SQL PREPAREs', async () => {
    const heavy = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='weather_alert' AND code='heavy_rain' AND tenant_id IS NULL AND deleted_at IS NULL`)).rows;
    expect(heavy).toHaveLength(1);                                                   // F-16: one active platform row per code
    const cyclone = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='weather_alert' AND code='cyclone' AND tenant_id IS NULL AND deleted_at IS NULL`)).rows[0].id;
    // farmer B asks for severe alerts only
    await admin.query(`INSERT INTO weather_prefs (tenant_id, user_id, morning_advisory, weekly_outlook, severe_only) VALUES ($1,$2,true,true,true)`, [tenantA, farmers[1]]);
    alertId = (await admin.query(`INSERT INTO weather_alerts (region_id, alert_type_id, severity, valid_from, valid_to, source) VALUES ($1,$2,'warning', now() - interval '1 hour', now() + interval '6 hours', 'test-ingest') RETURNING id`, [GUJARAT, heavy[0].id])).rows[0].id;
    severeId = (await admin.query(`INSERT INTO weather_alerts (region_id, alert_type_id, severity, valid_from, valid_to, source) VALUES ($1,$2,'severe', now() - interval '10 minutes', now() + interval '12 hours', 'test-ingest') RETURNING id`, [JUNAGADH, cyclone])).rows[0].id;
    await asApp(tenantA, async (c) => { await c.query(`PREPARE t12_due AS ${DUE_ALERTS_SQL}`); await c.query(`EXECUTE t12_due('${tenantA}', 5)`); });   // F-6: parses + runs as kv_app

    await job.runForTenant(tenantA);
    const ev = (await admin.query(`SELECT event_type, payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_type='weather_alert' AND aggregate_id = ANY($2::uuid[]) ORDER BY id`, [tenantA, [alertId, severeId]])).rows;
    const warn = ev.find((x) => x.event_type === 'land.weather_advisory_active');
    const sev = ev.find((x) => x.event_type === 'land.weather_advisory_severe');
    expect(ev).toHaveLength(2);
    expect(warn.payload).toMatchObject({ v: 2, alertCode: 'heavy_rain', region: 'Gujarat', severity: 'warning', alertName: { en: 'Heavy rain', hi: 'भारी वर्षा', gu: 'ભારે વરસાદ' } });
    expect(warn.payload.validTo).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // every parcel owner under Gujarat (Junagadh is inside it) except farmer B, who asked for severe only
    expect(warn.payload.recipientUserIds).toEqual(expect.arrayContaining([farmers[0], farmers[2], farmers[3], farmers[4]]));
    expect(warn.payload.recipientUserIds).not.toContain(farmers[1]);
    expect(sev.payload.recipientUserIds).toEqual(expect.arrayContaining([farmers[0], farmers[1]]));
    // once: a second tick emits nothing for these alerts
    await job.runForTenant(tenantA);
    expect((await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND aggregate_id = ANY($2::uuid[])`, [tenantA, [alertId, severeId]])).rows[0].n).toBe(2);
    // the sweep: the runner's pool reads only tenants; the module's kill-switch (land_soil_weather) is honoured per tenant
    const relay = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await relay.query(`SET ROLE kv_relay`);
    const sw = await job.sweep(relay);
    expect(sw.failed).toBe(0);
    await relay.end();
    // the tenant role can no longer write the platform's advisories
    await asApp(tenantA, async (_c, probe) => { expect(await probe(`INSERT INTO weather_alerts (region_id, alert_type_id, severity, valid_from, valid_to, source) VALUES ($1,$2,'info', now(), now(), 'x')`, [GUJARAT, cyclone])).toBe('42501'); });
    const ov = await twin.overview(tenantA, actors[staff]);
    expect(ov.weather.alerts.recent).toBeGreaterThanOrEqual(2);
  });

  it('B10 · µs paging — parcels and scenarios written in ONE millisecond page exactly once', async () => {
    const owner = farmers[5];
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = randomUUID(); ids.push(id);
      await admin.query(`INSERT INTO land_parcels (id, tenant_id, owner_user_id, area_value, area_unit, created_at) VALUES ($1,$2,$3,1,'hectare', '2026-10-03 10:00:00.00010${i}+00')`, [id, tenantA, owner]);
    }
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const pg = await parcels.list(tenantA, farmerActor(owner), { box: 'mine', limit: 2, cursor: decodeKeyset(cursor, UUID_RE) });
      seen.push(...pg.items.map((x) => x.id)); cursor = pg.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual([...ids].sort());

    const sids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = randomUUID(); sids.push(id);
      await admin.query(`INSERT INTO twin_scenarios (id, tenant_id, name, status, created_by, created_at) VALUES ($1,$2,$3,'draft',$4,'2030-01-01 10:00:00.00020${i}+00')`, [id, tenantA, `Paging ${i}`, coord]);
    }
    const sSeen: string[] = []; let sc: string | null = null; let pages = 0;
    do {
      const pg = await twin.listScenarios(tenantA, actors[staff], { limit: 2, cursor: decodeKeyset(sc, UUID_RE) });
      sSeen.push(...pg.items.map((x) => x.id)); sc = pg.nextCursor; pages++;
    } while (sc && pages < 20);
    for (const id of sids) expect(sSeen.filter((x) => x === id)).toHaveLength(1);
  });

  it('B7/B4/B8 · kv_app probes: ai_models, plan_features, NULL-tenant mandi / crop_calendars refused; tenant_admin reads ONLY its own inferences', async () => {
    await asApp(tenantA, async (_c, probe) => {
      expect(await probe(`INSERT INTO ai_models (code, version, status) VALUES ('twin.scenario','0.9','production')`)).toBe('42501');
      expect(await probe(`UPDATE ai_models SET status='production'`)).toBe('42501');
      expect(await probe(`INSERT INTO plan_features (plan_id, feature_code) VALUES ($1,'digital_twin')`, [randomUUID()])).toBe('42501');
      expect(await probe(`INSERT INTO tenant_features (tenant_id, feature_code, is_enabled) VALUES ($1,'digital_twin',true)`, [tenantA])).toBe('42501');
      expect(await probe(`INSERT INTO mandi_prices (product_id, price_date, modal_minor, source) VALUES ($1, current_date, 100, 'enam')`, [productId])).toBe('42501');
      expect(await probe(`INSERT INTO crop_calendars (crop_name, season, duration_days_min, duration_days_max, stages, source) VALUES ('groundnut','kharif',100,120,'[{"s":1}]','test source')`)).toBe('42501');
      expect(await probe(`UPDATE crop_calendars SET is_active=false`)).toBe('42501');
      expect(await probe(`INSERT INTO price_predictions (product_id, region_id, target_date, p10_minor, p50_minor, p90_minor, model_version) VALUES ($1,$2,current_date,1,2,3,'x')`, [productId, JUNAGADH])).toBe('42501');
    });
    const model = (await admin.query(`INSERT INTO ai_models (code, version, status) VALUES ('t12.read_probe', $1, 'shadow') RETURNING id`, [randomUUID().slice(0, 8)])).rows[0].id;
    for (const [t, n] of [[tenantA, 2], [tenantB, 1]] as const) {
      for (let i = 0; i < n; i++) await admin.query(`INSERT INTO ai_inferences (tenant_id, model_id, subject_type, subject_id, output) VALUES ($1,$2,'listing',$3,'{}')`, [t, model, randomUUID()]);
    }
    await admin.query(`INSERT INTO ai_inferences (tenant_id, model_id, subject_type, subject_id, output) VALUES (NULL,$1,'listing',$2,'{}')`, [model, randomUUID()]);
    const perms = await permsOf('tenant_admin');
    expect(perms.has('ai.inference.read')).toBe(true); expect(perms.has('ai.review')).toBe(false);
    const mine = await inferences.list(tenantA, { userId: adminU, canReview: false, canModerate: false, canRead: true }, { limit: 50 });
    expect(mine.items.filter((x: any) => x.modelId === model)).toHaveLength(2);                 // never B's, never the NULL-tenant row
    expect(await codeOf(inferences.list(tenantA, { userId: staff, canReview: false, canModerate: false, canRead: false }, { limit: 5 }))).toBe('AI_FORBIDDEN');
  });

  it('RLS · tenant B sees none of A\'s twin rows', async () => {
    await asApp(tenantB, async (c) => {
      const n = async (t: string) => (await c.query(`SELECT count(*)::int n FROM ${t} WHERE tenant_id=$1`, [tenantA])).rows[0].n;
      expect({ s: await n('twin_scenarios'), a: await n('twin_assumptions'), h: await n('twin_assumption_history'), r: await n('twin_runs'), d: await n('twin_devices'), q: await n('twin_access_requests') })
        .toEqual({ s: 0, a: 0, h: 0, r: 0, d: 0, q: 0 });
      expect(await codeOf(twin.scenario(tenantB, actors[adminB], S1))).toBe('NOT_FOUND');
    });
  });
});
