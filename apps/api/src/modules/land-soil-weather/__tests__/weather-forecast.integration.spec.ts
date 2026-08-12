// modules/land-soil-weather/__tests__/weather-forecast.integration.spec.ts
// REAL Postgres proof for P0-12:
//   1. the geocoded forecast DEGRADES to a region's real ingested advisories when the provider is down (a stub
//      provider that throws) — proving "never fabricate, degrade to advisory" end-to-end against live data;
//   2. the advisory-push job emits exactly ONE 'land.weather_advisory_active' outbox row per newly-active alert
//      and is IDEMPOTENT (a second run emits nothing).
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { WeatherAlertRepository } from '../repositories/weather-alert.repository';
import { WeatherAlertService } from '../services/weather-alert.service';
import { ForecastService } from '../services/forecast.service';
import { WeatherAdvisoryPushJob } from '../jobs/weather-advisory-push.job';
import { NoopWeatherForecastProvider } from '../gateway/noop-weather-forecast.provider';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('weather forecast + advisory push (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let forecast: ForecastService; let pushJob: WeatherAdvisoryPushJob;
  const tenant = randomUUID();
  const region = randomUUID();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenant, 'WX');
    // a real ingested advisory for the region that just became active (so the push job picks it up)
    await admin.query(
      `INSERT INTO weather_alerts (id, region_id, alert_type_id, severity, valid_from, valid_to, source)
       VALUES (gen_random_uuid(), $1,
               (SELECT id FROM lookup_values WHERE type_code='weather_alert' AND code='heavy_rain' AND tenant_id IS NULL),
               'warning', now() - interval '5 minutes', now() + interval '2 days', 'IMD')`, [region]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const advisories = new WeatherAlertService(new WeatherAlertRepository(replica as any));
    // a provider that is "down" → forces the degrade-to-advisory path (never fabricates)
    forecast = new ForecastService(new NoopWeatherForecastProvider() as any, { reverse: async () => null } as any, new InMemoryCacheService(), config, advisories);   // TENANT-2a sweep: ctor gained the geocoder; a null-geocode stub keeps the degrade path under test
    pushJob = new WeatherAdvisoryPushJob(uow, new PgOutboxWriter());
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('degrades to the region\'s real advisories when the provider is down (never fabricates a forecast)', async () => {
    const r = await forecast.forecast(tenant, { lat: 19.076, lng: 72.877, regionId: region });
    expect(r.degraded).toBe(true);
    expect(r.source).toBe('advisory');
    expect(r.forecast).toBeNull();
    expect(r.advisories.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces 503 (no fabrication) when the provider is down and no region was given', async () => {
    await expect(forecast.forecast(tenant, { lat: 19.076, lng: 72.877 })).rejects.toMatchObject({ code: 'WEATHER_PROVIDER_UNAVAILABLE' });
  });

  it('advisory-push job emits one outbox event per newly-active alert and is idempotent', async () => {
    const first = await pushJob.runForTenant(tenant, 60);
    expect(first).toBeGreaterThanOrEqual(1);
    const cnt1 = await admin.query<{ n: string }>(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='land.weather_advisory_active'`, [tenant]);
    expect(Number(cnt1.rows[0].n)).toBe(first);
    // second run must emit NOTHING (dedup against the already-written outbox row)
    const second = await pushJob.runForTenant(tenant, 60);
    expect(second).toBe(0);
    const cnt2 = await admin.query<{ n: string }>(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='land.weather_advisory_active'`, [tenant]);
    expect(Number(cnt2.rows[0].n)).toBe(first);
  });
});
