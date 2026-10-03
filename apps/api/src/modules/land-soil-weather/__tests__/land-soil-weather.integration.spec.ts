// modules/land-soil-weather/__tests__/land-soil-weather.integration.spec.ts
// REAL end-to-end proof of the land-soil-weather spine against a live Postgres:
//   1. a farmer registers a 2.5-acre parcel (irrigation resolved from the seeded 'irrigation' lookup);
//   2. plans a kharif crop season → sows → harvests (records actual yield);
//   3. records a Soil Health Card result; reads a region's weather advisories (admin-seeded);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's parcel.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makeProduct, makeCategory, ensureUnitCurrency } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { QuotaService } from '../../../core/quota/quota.service';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { LandParcelRepository } from '../repositories/land-parcel.repository';
import { CropSeasonRepository } from '../repositories/crop-season.repository';
import { SoilTestRepository } from '../repositories/soil-test.repository';
import { WeatherAlertRepository } from '../repositories/weather-alert.repository';
import { LandParcelService } from '../services/land-parcel.service';
import { CropSeasonService } from '../services/crop-season.service';
import { SoilTestService } from '../services/soil-test.service';
import { WeatherAlertService } from '../services/weather-alert.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

run('land-soil-weather spine (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let parcels: LandParcelService; let crops: CropSeasonService; let soil: SoilTestService; let weather: WeatherAlertService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const farmer = randomUUID(); const region = '11111111-0000-7000-8000-000000000001'; // seeded GJ region
  let productId = ''; let parcelId = ''; let cropId = '';
  const actor = { userId: farmer, canManage: true, isAdmin: false };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, farmer);
    await ensureUnitCurrency(admin, 'quintal'); // ensure currency; 'acre' is seeded in 0003
    productId = await makeProduct(admin, { categoryId: await makeCategory(admin), tenantId: tenantA, unit: 'quintal' });
    // seed a global weather alert for the region (normally ingested by the platform pipeline)
    await admin.query(
      `INSERT INTO weather_alerts (id, region_id, alert_type_id, severity, valid_from, valid_to, source)
       VALUES (gen_random_uuid(), $1, (SELECT id FROM lookup_values WHERE type_code='weather_alert' AND code='heavy_rain' AND tenant_id IS NULL), 'warning', now() - interval '1 hour', now() + interval '2 days', 'IMD')`, [region]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics();
    const pRepo = new LandParcelRepository(replica as any); const cRepo = new CropSeasonRepository(replica as any); const sRepo = new SoilTestRepository(replica as any); const wRepo = new WeatherAlertRepository(replica as any);
    // PC-56 TENANT-12 (F-11): every land write is audited — the services take the AuditWriter; soil tests are keyed.
    const audit = new AuditWriter(pools);
    parcels = new LandParcelService(uow, outbox, idem, new AllowAllQuota(), metrics, pRepo, audit);
    crops = new CropSeasonService(uow, outbox, idem, metrics, cRepo, pRepo, audit);
    soil = new SoilTestService(uow, outbox, idem, metrics, sRepo, pRepo, audit);
    weather = new WeatherAlertService(wRepo);

    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('farmer registers a 2.5-acre parcel (irrigation resolved from the lookup)', async () => {
    const p = await parcels.register(tenantA, actor, `idem-${randomUUID()}`, { areaValue: '2.5000', areaUnit: 'acre', surveyNo: '123/4', regionId: region, irrigationTypeCode: 'drip', isTenantFarmed: false } as any);
    parcelId = p.id; expect(p.area).toBe('2.5000'); expect(p.irrigationTypeId).toBeTruthy();
  });

  it('plans → sows → harvests a kharif crop season', async () => {
    const c = await crops.plan(tenantA, actor, `idem-${randomUUID()}`, { parcelId, productId, season: 'kharif', year: 2026, expectedYield: '30.000' } as any);
    cropId = c.id; expect(c.status).toBe('planned');
    expect((await crops.sow(tenantA, actor, cropId, { sownOn: '2026-06-15' } as any)).status).toBe('sown');
    const harvested = await crops.harvest(tenantA, actor, cropId, { actualYield: '28.500', yieldUnitCode: 'quintal' } as any);   // F-9: with its unit
    expect(harvested.status).toBe('harvested'); expect(harvested.actualYield).toBe('28.500');
  });

  it('records a soil test + reads the region weather advisory', async () => {
    const t = await soil.record(tenantA, actor, `idem-${randomUUID()}`, { parcelId, labName: 'SHC Lab', shcCardNo: 'SHC-77', sampledOn: '2026-05-01', results: { ph: 6.8, n: 280, p: 22, k: 180 }, recommendations: { urea_kg_per_acre: 50 } } as any);
    expect(t.results.ph).toBe(6.8);
    const alerts = await weather.listForRegion(tenantA, region, true, 50);
    expect(alerts.length).toBeGreaterThanOrEqual(1); expect(alerts[0].severity).toBe('warning');
  });

  it('cross-owner read is denied (404, no IDOR) + RLS denies tenant B', async () => {
    const stranger = { userId: randomUUID(), canManage: true, isAdmin: false };
    await expect(parcels.getById(tenantA, stranger, parcelId)).rejects.toThrow();
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM land_parcels WHERE id=$1`, [parcelId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM land_parcels WHERE id=$1`, [parcelId])).rows.length).toBe(1);
  });
});
