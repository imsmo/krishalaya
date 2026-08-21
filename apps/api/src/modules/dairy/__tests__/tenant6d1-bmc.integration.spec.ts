// modules/dairy/__tests__/tenant6d1-bmc.integration.spec.ts · PC-56 TENANT-6d-1, LIVE Postgres.
//
// SEVEN THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **A `bmc_unit` COLD-CHAIN READING EXISTS AT ALL.** No reading has ever been written for that subject type on this
//      platform; only a live insert proves the whole path — dairy permission, band from the unit, logistics' writer.
//   2. **`is_breach` COMES FROM THE TANK'S BAND.** The row is judged by 0162's band, not by anything a caller supplies,
//      and the boundary (4.5 in range, 4.6 not) is decided by Postgres' `numeric`, not by a JS float.
//   3. **ONE SENSOR, ONE COOLER** — `uq_bmc_device_ref` is a PARTIAL unique index, so only a live insert can show that a
//      second tank cannot claim a sensor while two sensorless tanks remain legal (6c-4's NULL trap, applied).
//   4. **THE CONSTRAINTS SAY WHAT THE AGGREGATE SAYS**: an inverted band, a level above capacity, a compressor claim
//      with no author, a retired flag with no stamp — all four refused by the database as well as by the entity.
//   5. **`cold_chain_logs.subject_type` IS NOW A CLOSED VOCABULARY** (162.4), which is only testable by trying to insert
//      outside it.
//   6. **THE NOTIFICATION SEED THAT DUPLICATED ITSELF.** 162.6 de-duplicates platform templates and adds a partial
//      unique index; re-running the seed must now leave the count unchanged, which is the whole point.
//   7. **`ops.alert_fired` IS CATALOGUED**, so an ops alert can finally be delivered — it had a map row and no event
//      from PC-55 until this wave.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { ColdChainLogRepository } from '../../logistics/repositories/cold-chain-log.repository';
import { ColdChainService } from '../../logistics/services/cold-chain.service';
import { OpsAlertRepository } from '../../logistics/repositories/ops-alert.repository';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
// PC-56 TENANT-6d-2: the custody register the centre service writes in the same transaction as the column.
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { BmcUnitService } from '../services/bmc-unit.service';
import { BmcReadingService } from '../services/bmc-reading.service';
import { DairyBmcReadModel } from '../read-models/dairy-bmc.read-model';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-1 · W170 the tank (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let units: BmcUnitService; let readings: BmcReadingService;
  let rm: DairyBmcReadModel; let unitRepo: BmcUnitRepository;

  const tenantA = randomUUID();
  const desk = randomUUID();
  const actor = { userId: desk, canManage: true };
  let mccId = ''; let unitId = ''; let handUnitId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, desk);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    const mccRepo = new MccCentreRepository(replica as never);
    unitRepo = new BmcUnitRepository(replica as never);
    const coldChain = new ColdChainService(uow, metrics, new ColdChainLogRepository(replica as never));

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    units = new BmcUnitService(uow, outbox, idem, metrics, audit, unitRepo, mccRepo);
    readings = new BmcReadingService(uow, metrics, unitRepo, coldChain);
    rm = new DairyBmcReadModel(replica as never, unitRepo, new OpsAlertRepository(replica as never), flags, metrics);

    mccId = (await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D1-01', defaultName: 'Vanthali' } as never, null)).id;
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE COOLER — the first code `bmc_units` has ever had', () => {
    it('registers with W170\'s own band and an UNKNOWN compressor', async () => {
      const u: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, {
        mccId, capacityLitres: '2000', iotDeviceRef: 'DEV-D1-01', model: 'IceCool 2000', serialNo: 'IC-0001',
      });
      unitId = u.id;
      expect(u).toMatchObject({ targetDeci: 40, minDeci: 0, toleranceDeci: 5, compressorState: 'unknown', isActive: true });
      const row = await admin.query(`SELECT target_temp_c::text t, tolerance_c::text tol, capacity_litres::text cap FROM bmc_units WHERE id=$1`, [unitId]);
      expect(row.rows[0]).toEqual({ t: '4.0', tol: '0.5', cap: '2000.00' });
    });

    it('refuses a SECOND cooler on the same sensor, and allows two with none', async () => {
      await expect(units.register(tenantA, actor as never, `idem-${randomUUID()}`, {
        mccId, capacityLitres: '1500', iotDeviceRef: 'DEV-D1-01',
      })).rejects.toBeDefined();
      // Two sensorless tanks are legal — the index is PARTIAL, which is the whole reason it is an index and not a
      // constraint (6c-4's NULL-distinct trap, applied deliberately this time).
      handUnitId = (await units.register(tenantA, actor as never, `idem-${randomUUID()}`, { mccId, capacityLitres: '1000' }) as any).id;
      const second: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, { mccId, capacityLitres: '800' });
      expect(second.iotDeviceRef).toBeNull();
      expect(handUnitId).not.toBe(second.id);
    });

    it('the DATABASE refuses an inverted band, an impossible level and an unattributed compressor claim', async () => {
      await expect(admin.query(`UPDATE bmc_units SET target_temp_c = -3.0 WHERE id=$1`, [unitId])).rejects.toMatchObject({ constraint: 'ck_bmc_band' });
      await expect(admin.query(`UPDATE bmc_units SET volume_litres = 9999.00, volume_at = now() WHERE id=$1`, [unitId])).rejects.toMatchObject({ constraint: 'ck_bmc_volume' });
      await expect(admin.query(`UPDATE bmc_units SET volume_litres = 100.00, volume_at = NULL WHERE id=$1`, [unitId])).rejects.toMatchObject({ constraint: 'ck_bmc_volume' });
      await expect(admin.query(`UPDATE bmc_units SET compressor_state='healthy' WHERE id=$1`, [unitId])).rejects.toMatchObject({ constraint: 'ck_bmc_compressor' });
      await expect(admin.query(`UPDATE bmc_units SET is_active=false WHERE id=$1`, [unitId])).rejects.toMatchObject({ constraint: 'ck_bmc_retired' });
    });

    it('records a level and a compressor statement, both attributed', async () => {
      await units.reportLevel(tenantA, actor as never, unitId, `idem-${randomUUID()}`, { volumeLitres: '820' });
      await units.stateCompressor(tenantA, actor as never, unitId, { state: 'healthy' });
      const r = await admin.query(`SELECT volume_litres::text v, volume_by, compressor_state, compressor_state_by FROM bmc_units WHERE id=$1`, [unitId]);
      expect(r.rows[0]).toMatchObject({ v: '820.00', volume_by: desk, compressor_state: 'healthy', compressor_state_by: desk });
    });
  });

  /* ======================================================================================================= */
  describe('THE STREAM — the first `bmc_unit` reading on this platform', () => {
    it('writes a reading judged by the TANK\'s band, by sensor reference', async () => {
      const r: any = await readings.record(tenantA, actor as never, { deviceRef: 'DEV-D1-01', tempC: '3.8' });
      expect(r).toMatchObject({ unitId, isBreach: false, verdict: 'in_range', tempC: '3.8' });
      const row = await admin.query(
        `SELECT subject_type, subject_id, temp_c::text t, is_breach, device_ref FROM cold_chain_logs WHERE id=$1 AND recorded_at >= now() - interval '1 hour'`, [r.id]);
      expect(row.rows[0]).toMatchObject({ subject_type: 'bmc_unit', subject_id: unitId, t: '3.80', is_breach: false, device_ref: 'DEV-D1-01' });
    });

    it('decides the boundary the way the band does: 4.5 in range, 4.6 a breach', async () => {
      const at = await readings.record(tenantA, actor as never, { unitId, tempC: '4.5' });
      const over = await readings.record(tenantA, actor as never, { unitId, tempC: '4.6' });
      expect(at.isBreach).toBe(false);
      expect(over.isBreach).toBe(true);
      expect(over.verdict).toBe('above_band');
      // ...and the row's own `is_breach` agrees, which is what the alert rules read.
      const rows = await admin.query(`SELECT temp_c::text t, is_breach FROM cold_chain_logs WHERE subject_id=$1 AND temp_c IN (4.5, 4.6) ORDER BY temp_c`, [unitId]);
      expect(rows.rows).toEqual([{ t: '4.50', is_breach: false }, { t: '4.60', is_breach: true }]);
    });

    it('treats freezing as a breach too', async () => {
      const r = await readings.record(tenantA, actor as never, { unitId, tempC: '-0.5' });
      expect(r.verdict).toBe('below_min');
      expect(r.isBreach).toBe(true);
    });

    it('refuses a reading for an unknown sensor, and one that names two tanks', async () => {
      await expect(readings.record(tenantA, actor as never, { deviceRef: 'DEV-NOBODY', tempC: '4.0' }))
        .rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
      await expect(readings.record(tenantA, actor as never, { deviceRef: 'DEV-D1-01', unitId, tempC: '4.0' }))
        .rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
      await expect(readings.record(tenantA, actor as never, {} as never)).rejects.toBeDefined();
    });

    it('refuses a reading from a RETIRED cooler — the sensor is on the wrong tank', async () => {
      const doomed: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, { mccId, capacityLitres: '500', iotDeviceRef: 'DEV-GONE' });
      await units.retire(tenantA, actor as never, doomed.id);
      await expect(readings.record(tenantA, actor as never, { deviceRef: 'DEV-GONE', tempC: '4.0' }))
        .rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
      // The retired unit's own readings stay; it simply stops being watched.
      const seen = await admin.query(`SELECT count(*)::int c FROM bmc_units WHERE id=$1 AND is_active=false AND retired_by=$2`, [doomed.id, desk]);
      expect(seen.rows[0].c).toBe(1);
    });

    it('refuses the stream without the dairy desk', async () => {
      await expect(readings.record(tenantA, { userId: desk, canManage: false } as never, { unitId, tempC: '4.0' }))
        .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    });
  });

  /* ======================================================================================================= */
  describe('THE VOCABULARY THAT LIVED IN A COMMENT (162.4)', () => {
    it('the database now refuses a subject type outside the four', async () => {
      await expect(admin.query(
        `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, is_breach)
         VALUES ($1, 'milk_tanker_typo', $2, 4.0, now(), false)`, [tenantA, unitId]))
        .rejects.toMatchObject({ constraint: 'ck_cold_chain_subject' });
      // ...and still accepts every one that IS in the entity's vocabulary.
      for (const s of ['shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box']) {
        await admin.query(
          `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, is_breach)
           VALUES ($1, $2, $3, 4.0, now(), false)`, [tenantA, s, unitId]);
      }
    });
  });

  /* ======================================================================================================= */
  describe('THE MONITOR', () => {
    it('composes W170 from real readings, and opens on the warm tank', async () => {
      const v = await rm.view(tenantA, actor as never, {});
      expect(v.units.length).toBeGreaterThanOrEqual(3);
      const watched = v.units.find((u) => u.unitId === unitId)!;
      expect(watched.mccCode).toBe('MCC-D1-01');
      expect(watched.band).toEqual({ minC: '0.0', targetC: '4.0', maxC: '4.5' });
      expect(watched.fillPct).toBe(41);                    // 820 of 2,000 L
      expect(watched.compressor.state).toBe('healthy');
      expect(watched.readings24h).toBeGreaterThanOrEqual(4);
      expect(watched.breaches24h).toBeGreaterThanOrEqual(2);
      // A tank with no readings says so rather than showing a temperature it does not have.
      const byHand = v.units.find((u) => u.unitId === handUnitId)!;
      expect(byHand.tempC).toBeNull();
      expect(byHand.telemetry.state).toBe('never');
      expect(byHand.deviceRef).toBeNull();
      // The chart is drawn for the tank that needs looking at, from real rows.
      expect(v.focus?.points.length).toBeGreaterThanOrEqual(2);
      expect(v.thresholds).toEqual({ divertC: '7.5', condemnC: '8.0', silenceMinutes: 15 });
    });

    it('reports the quarter from measured readings, and never claims litres', async () => {
      const v = await rm.view(tenantA, actor as never, { unitId });
      expect(v.quarter.readings).toBeGreaterThanOrEqual(4);
      expect(v.quarter.timeInRangeBp).not.toBeNull();
      expect(v.quarter.litresLost.kind).toBe('not_measurable');
    });

    it('says the operator can now be TEXTED — the PC-55 defect this wave closed', async () => {
      const v = await rm.view(tenantA, actor as never, {});
      expect(v.alerting.eventCatalogued).toBe(true);
      expect(v.alerting.smsDeliverable).toBe(true);
      // 0086 catalogued the event with SMS in its default channels...
      const ev = await admin.query(`SELECT default_channels, user_can_opt_out FROM notification_events WHERE code='ops.alert_fired'`);
      expect(JSON.stringify(ev.rows[0].default_channels)).toContain('sms');
      // ...and `user_can_opt_out` is STILL true, which this wave names rather than flips: it governs every ops alert on
      // the platform (fleet, warehouse, dairy), not just a warm tank.
      expect(ev.rows[0].user_can_opt_out).toBe(true);
      // The SMS wording now exists in all three launch languages, which is what makes the text sendable at all.
      const t = await admin.query(
        `SELECT count(DISTINCT language_code)::int langs FROM notification_templates
          WHERE event_code='ops.alert_fired' AND channel='sms' AND tenant_id IS NULL AND is_active = true`);
      expect(t.rows[0].langs).toBe(3);
    });

    it('a tank cannot be seen by another cooperative', async () => {
      const tenantB = randomUUID();
      await makeTenant(admin, tenantB, 'B');
      const v = await rm.view(tenantB, actor as never, {});
      expect(v.units).toEqual([]);
      expect(v.focus).toBeNull();
    });
  });

  /* ======================================================================================================= */
  describe('THE SEED THAT DUPLICATED ITSELF (162.6)', () => {
    it('one PLATFORM template per event, channel and language — enforced, not hoped for', async () => {
      const dup = await admin.query(
        `SELECT count(*)::int c FROM (
           SELECT event_code, channel, language_code FROM notification_templates
            WHERE tenant_id IS NULL AND deleted_at IS NULL
            GROUP BY 1,2,3 HAVING count(*) > 1) d`);
      expect(dup.rows[0].c).toBe(0);
      // The index is what makes a re-run safe: a second identical platform row is refused outright now, where before it
      // was accepted because the table's own unique key includes a NULL tenant_id.
      const one = await admin.query(
        `SELECT event_code, channel, language_code FROM notification_templates WHERE tenant_id IS NULL LIMIT 1`);
      const { event_code: e, channel: c, language_code: l } = one.rows[0];
      await expect(admin.query(
        `INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, body, is_active)
         VALUES ($1,$2,$3,NULL,'duplicate',true)`, [e, c, l]))
        .rejects.toMatchObject({ constraint: 'uq_notification_templates_platform' });
    });
  });
});
