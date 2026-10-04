// modules/logistics/__tests__/zones-routing.integration.spec.ts
// REAL Postgres proof of API-W3-04. Proves: (1) a zone/route persists with the caller tenant_id + an outbox event,
// all in one tx — a zone now on the PC-56 TENANT-SW-a model: PROPOSED by a lead, live only once a DIFFERENT tenant_admin confirms; (2) a
// cold-chain MANUAL reading is appended with the band COPIED from the threshold store (PC-56 TENANT-SW-e — the body can no longer carry
// one) and is flagged out of band, yet opens no breach and alerts no one (a breach is two consecutive DEVICE readings; the unregistered
// watermark job that alerted per manual excursion is gone — tenant-swe-logistics-ops.integration.spec proves the device path); (3) the Village-Run job emits one due-event per active route scheduled for
// the weekday and is idempotent per date; (4) ROW-LEVEL SECURITY: tenant B cannot see tenant A's zone.
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
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { DeliveryZoneRepository } from '../repositories/delivery-zone.repository';
import { DeliveryZoneProposalRepository } from '../repositories/delivery-zone-proposal.repository';
import type { OrderService } from '../../orders/services/order.service';
import { DeliveryRouteRepository } from '../repositories/delivery-route.repository';
import { ColdChainLogRepository } from '../repositories/cold-chain-log.repository';
import { DeliveryZoneService } from '../services/delivery-zone.service';
import { DeliveryRouteService } from '../services/delivery-route.service';
import { ColdChainService } from '../services/cold-chain.service';
import { ColdChainOpsRepository } from '../repositories/cold-chain-ops.repository';
import { VillageRunConsolidationJob } from '../jobs/village-run-consolidation.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('logistics zones-routing (integration, real Postgres + RLS + jobs)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let zones: DeliveryZoneService;
  let routes: DeliveryRouteService;
  let coldChain: ColdChainService;
  let villageJob: VillageRunConsolidationJob;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const manager = () => ({ userId: randomUUID(), canManage: true });
  const lead = randomUUID(); const checker = randomUUID();
  const key = () => randomUUID();
  const subjectId = randomUUID();
  let zoneId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const [u, role] of [[lead, 'fpo_coordinator'], [checker, 'tenant_admin']] as const) {
      await makeUser(admin, u as ReturnType<typeof randomUUID>);
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, tenantA, role]);
    }

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const zoneRepo = new DeliveryZoneRepository(replica as any);
    const routeRepo = new DeliveryRouteRepository(replica as any);
    const coldRepo = new ColdChainLogRepository(replica as any);
    // the order read (Orders 30d) is only used by the list / detail reads, which this spec does not call
    const orderCounts = { ordersByZoneSince: async () => new Map<string, number>() } as unknown as OrderService;
    zones = new DeliveryZoneService(uow, outbox, idem, metrics, audit, zoneRepo, new DeliveryZoneProposalRepository(replica as any), orderCounts);
    routes = new DeliveryRouteService(uow, outbox, idem, metrics, audit, routeRepo);
    coldChain = new ColdChainService(uow, metrics, coldRepo, new ColdChainOpsRepository(replica as any), idem, outbox, audit, config, {} as any, {} as any);
    villageJob = new VillageRunConsolidationJob(admin, routeRepo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('a zone is proposed by a lead and lives only once a DIFFERENT tenant_admin confirms: caller tenant_id + an outbox event', async () => {
    const p = await zones.propose(tenantA, { userId: lead, canPropose: true }, key(), { kind: 'create', defaultName: 'Pune Metro', pincodes: ['411001', '411002'], regionIds: [],
      chargeDefinitionId: null, reason: 'Pune metro pincodes served by our vans' } as any, null);
    zoneId = p.zoneId;
    expect((await admin.query(`SELECT 1 FROM delivery_zones WHERE id=$1`, [zoneId])).rowCount).toBe(0);   // nothing live yet
    await expect(zones.confirm(tenantA, { userId: lead, canPropose: true }, key(), p.id, null)).rejects.toBeTruthy();   // the proposer is not the checker
    await zones.confirm(tenantA, { userId: checker, canPropose: true }, key(), p.id, null);
    const row = await admin.query(`SELECT tenant_id, pincodes FROM delivery_zones WHERE id=$1`, [zoneId]);
    expect(row.rows[0].tenant_id).toBe(tenantA);
    expect(row.rows[0].pincodes).toEqual(['411001', '411002']);
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='logistics.delivery_zone_changed'`, [zoneId]);
    expect(ev.rows[0].c).toBe(1);
  });

  it('cold-chain: a manual reading copies the band from the store, is flagged out of band, and opens no breach', async () => {
    await admin.query(`INSERT INTO cold_chain_thresholds (tenant_id, subject_type, subject_id, min_c, max_c, set_by, reason) VALUES ($1,'vaccine_box',$2,2,8,$3,'vaccine box band per the label')`, [tenantA, subjectId, checker]);
    const r = await coldChain.record(tenantA, manager(), { subjectType: 'vaccine_box', subjectId, tempC: 14, humidityPct: 40, deviceRef: 'dev-1' } as any);
    expect(r.band).toEqual({ minC: 2, maxC: 8 });
    const stored = await admin.query(`SELECT is_breach, source, band_min_c::float8 AS mn, band_max_c::float8 AS mx, server_recorded_at IS NOT NULL AS stamped FROM cold_chain_logs WHERE subject_id=$1 ORDER BY recorded_at DESC LIMIT 1`, [subjectId]);
    expect(stored.rows[0]).toEqual({ is_breach: true, source: 'manual', mn: 2, mx: 8, stamped: true });
    await coldChain.record(tenantA, manager(), { subjectType: 'vaccine_box', subjectId, tempC: 15 } as any);   // a second manual excursion: still no breach
    expect((await admin.query(`SELECT count(*)::int c FROM cold_chain_breaches WHERE subject_id=$1`, [subjectId])).rows[0].c).toBe(0);
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='logistics.cold_chain_breach'`, [subjectId]);
    expect(ev.rows[0].c).toBe(0);
  });

  it('village-run job emits one due-event per scheduled route and is idempotent per date', async () => {
    const today = new Date();
    const r = await routes.create(tenantA, manager(), key(), { defaultName: 'Run X', runWeekday: today.getUTCDay(), villageRegionIds: [] } as any, null);
    const first = await villageJob.run(1000, today);
    expect(first.emitted).toBeGreaterThanOrEqual(1);
    const again = await villageJob.run(1000, today);   // same date → skipped
    expect(again.skipped).toBe(true);
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='logistics.village_run_due'`, [r.id]);
    expect(ev.rows[0].c).toBe(1);
  });

  it('RLS: tenant B cannot see tenant A\'s zone', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM delivery_zones WHERE id=$1`, [zoneId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[zones] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
