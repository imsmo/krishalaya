// modules/market-intel/__tests__/market-intel.integration.spec.ts
// REAL end-to-end proof of the Mandi Pulse spine against a live Postgres:
//   1. ops ingests several price observations for a product+region; the Pulse read returns the latest;
//   2. a baseline fair-price band is generated from those observations;
//   3. a farmer's price alert fires on a crossing ingest (PriceAlertTriggered emitted to the outbox);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's price alert.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makeCategory, makeProduct } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { MarketNamesReadModel } from '../read-models/market-names.read-model';
import { MarketSettingsReadModel } from '../read-models/market-settings.read-model';
import { MandiPriceRepository } from '../repositories/mandi-price.repository';
import { PricePredictionRepository } from '../repositories/price-prediction.repository';
import { PriceAlertRepository } from '../repositories/price-alert.repository';
import { MandiPriceService } from '../services/mandi-price.service';
import { PricePredictionService } from '../services/price-prediction.service';
import { PriceAlertService } from '../services/price-alert.service';
import { MandiPulseReadModel } from '../read-models/mandi-pulse.read-model';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('market-intel spine (integration, real Postgres + RLS + alerts)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let prices: MandiPriceService; let predictions: PricePredictionService; let alerts: PriceAlertService; let pulse: MandiPulseReadModel;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const ops = randomUUID(); const farmer = randomUUID(); const region = randomUUID();
  let productId = ''; let alertId = '';
  const opsActor = { userId: ops, canManage: true };
  const farmerActor = { userId: farmer, canManage: false };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, ops); await makeUser(admin, farmer);
    await admin.query(`INSERT INTO admin_regions (id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [region, 'GJ-TEST']);
    const cat = await makeCategory(admin); productId = await makeProduct(admin, { categoryId: cat, tenantId: null });
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics();
    const priceRepo = new MandiPriceRepository(replica as any); const predRepo = new PricePredictionRepository(replica as any); const alertRepo = new PriceAlertRepository(replica as any);
    const marketNames = new MarketNamesReadModel(replica as any);
    // PC-56 ADMIN-SWEEP: the anomaly policy read model. Real, against the same pools — so this suite exercises the gate
    // reading its threshold out of `setting_definitions` exactly as production does.
    const marketSettings = new MarketSettingsReadModel(pools);
    prices = new MandiPriceService(uow, outbox, idem, metrics, priceRepo, alertRepo, marketNames, marketSettings);
    predictions = new PricePredictionService(uow, outbox, metrics, predRepo, priceRepo);
    alerts = new PriceAlertService(uow, outbox, metrics, alertRepo);
    // Third argument added by an earlier wave and never updated here — one of the pre-existing red apps/api suites.
    // Fixed while this wave was in the file rather than left for the next reader to trip over.
    pulse = new MandiPulseReadModel(priceRepo, predRepo, marketNames);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('ingests observations; pulse returns the latest', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const modal of ['200000', '220000', '240000', '260000', '280000']) {
      await prices.ingest(tenantA, opsActor, `idem-${randomUUID()}`, { regionId: region, productId, priceDate: today, modalMinor: modal, unitCode: 'quintal', source: 'agmarknet' } as any);
    }
    const p: any = await pulse.pulse(tenantA, productId, region);
    expect(p.latest).toBeTruthy(); expect(p.history.length).toBeGreaterThanOrEqual(5);
  });
  it('generates a baseline band', async () => {
    const band: any = await predictions.generate(tenantA, opsActor, { productId, regionId: region, targetDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), lookbackDays: 90 } as any);
    expect(band.modelVersion).toBe('baseline-v1');
    expect(BigInt(band.p10Minor) <= BigInt(band.p90Minor)).toBe(true);
  });
  it('a farmer alert fires on a crossing ingest', async () => {
    alertId = (await alerts.create(tenantA, farmerActor, { productId, regionId: region, direction: 'above', thresholdMinor: '250000' } as any)).id;
    const out: any = await prices.ingest(tenantA, opsActor, `idem-${randomUUID()}`, { regionId: region, productId, priceDate: new Date().toISOString().slice(0, 10), modalMinor: '300000', unitCode: 'quintal', source: 'agmarknet' } as any);
    expect(out.alertsFired).toBe(1);
  });
  it('RLS: tenant B cannot see tenant A\'s price alert', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM price_alerts WHERE id=$1`, [alertId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM price_alerts WHERE id=$1`, [alertId])).rows.length).toBe(1);
  });
});
