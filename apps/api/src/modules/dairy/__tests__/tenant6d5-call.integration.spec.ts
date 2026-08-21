// modules/dairy/__tests__/tenant6d5-call.integration.spec.ts · PC-56 TENANT-6d-5, LIVE Postgres.
//
// SIX THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **A FIFTEEN-MINUTE SILENCE NOW FIRES.** The old evidence query floored the gap to whole hours, so a sensor quiet
//      for twenty minutes was `silent_hours = 0` and no rule could match it. Only a live `cold_chain_logs` row and a
//      live `now()` can show the rule matching — and the alert body saying *"20 min"* instead of *"~0h"*.
//   2. **THE ROW MIGRATION.** 0165 rewrites `{"silentHours": 12}` as `{"silentMinutes": 720}` for rules that already
//      exist. A migration's UPDATE is only real when it has run.
//   3. **THE CRITICAL ALERT IS CATALOGUED AND SERVABLE.** `ops.alert_critical` with priority `critical` (the thing that
//      bypasses quiet hours) and nine templates whose `serving_version_id` is not null — the send-time gate 0122 added
//      and TENANT-6c-2 found everybody failing.
//   4. **A RULE MAY NAME THE VOICE CHANNEL.** `channel_hint = 'ivr'` was refused by a CHECK constraint until 0165.
//   5. **THE CALL IS FILED AGAINST THE COOLER.** `masked_calls.context_type = 'bmc_unit'` with the unit's id — a column
//      with no CHECK, so only an insert proves the vocabulary is actually written.
//   6. **THE ACT'S REFUSALS ARE THE REVIEW'S REFUSALS**, against real custody rows: a centre nobody holds, and a caller
//      who holds it themselves.
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

import { OpsAlertRepository } from '../../logistics/repositories/ops-alert.repository';
import { OpsAlertService } from '../../logistics/services/ops-alert.service';
import { ColdChainLogRepository } from '../../logistics/repositories/cold-chain-log.repository';
import { ColdChainService } from '../../logistics/services/cold-chain.service';
import { MaskedCallRepository } from '../../communication/repositories/masked-call.repository';
import { MaskedCallService } from '../../communication/services/masked-call.service';
import { NoopMaskingGateway } from '../../communication/gateway/noop-masking.gateway';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { BmcUnitService } from '../services/bmc-unit.service';
import { BmcReadingService } from '../services/bmc-reading.service';
import { BmcCallService } from '../services/bmc-call.service';
import { BmcCallRefusedError } from '../domain/dairy.errors';
import { OPS_ALERT_CRITICAL_OUTBOX_TYPE, silentMinutesOf } from '../../logistics/domain/ops-alert.rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-5 · the call and the fifteen minutes (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let units: BmcUnitService; let readings: BmcReadingService;
  let callSvc: BmcCallService; let alerts: OpsAlertService; let alertRepo: OpsAlertRepository;

  const tenantA = randomUUID();
  const desk = randomUUID();
  const raju = randomUUID();
  const actor = { userId: desk, canManage: true };
  const alertActor = { userId: desk, canManage: true };

  let centreHeld = ''; let centreVacant = '';
  let unitHeld = ''; let unitVacant = '';

  const roleIn = (userId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantA]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [desk, raju]) await makeUser(admin, u);
    await roleIn(desk); await roleIn(raju);

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
    void flags;

    const mccRepo = new MccCentreRepository(replica as never);
    const unitRepo = new BmcUnitRepository(replica as never);
    const custody = new MccOperatorAssignmentRepository(replica as never);
    alertRepo = new OpsAlertRepository(replica as never);
    alerts = new OpsAlertService(uow, outbox, alertRepo);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, custody);
    units = new BmcUnitService(uow, outbox, idem, metrics, audit, unitRepo, mccRepo);
    readings = new BmcReadingService(uow, metrics, unitRepo, new ColdChainService(uow, metrics, new ColdChainLogRepository(replica as never)));
    // The NOOP masking provider: in a non-production config it returns a synthetic call ref, which is exactly what
    // makes the whole path exercisable without a telco. In production it returns ok:false and nothing is recorded.
    const masked = new MaskedCallService(uow, outbox, idem, metrics, new NoopMaskingGateway(config), new MaskedCallRepository(replica as never));
    callSvc = new BmcCallService(uow, outbox, metrics, audit, unitRepo, masked);

    const held: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, {
      code: 'MCC-D5-01', defaultName: 'Keshod', operatorUserId: raju, operatorReason: 'runs the counter',
    } as never, null);
    centreHeld = held.id;
    const vacant: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, {
      code: 'MCC-D5-02', defaultName: 'Vanthali',
    } as never, null);
    centreVacant = vacant.id;
    const u1: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, {
      mccId: centreHeld, capacityLitres: '1500', iotDeviceRef: 'dev-d5-held',
    } as never);
    unitHeld = u1.id;
    const u2: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, {
      mccId: centreVacant, capacityLitres: '2000',
    } as never);
    unitVacant = u2.id;
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE FIFTEEN MINUTES', () => {
    it('MATCHES a sensor quiet for twenty minutes against a fifteen-minute rule', async () => {
      // The thing that was impossible. `FLOOR(epoch / 3600)` made this gap `0`, below `silentHours >= 1`, so no rule
      // could ever fire on W170's own number.
      await readings.record(tenantA, actor as never, { unitId: unitHeld, tempC: '4.0' });
      await admin.query(
        `UPDATE cold_chain_logs SET recorded_at = now() - interval '20 minutes'
          WHERE tenant_id=$1 AND subject_id=$2`, [tenantA, unitHeld]);

      const rows = await alertRepo.silentDevices(tenantA, 15);
      const mine = rows.find((r) => r.deviceRef === 'dev-d5-held');
      expect(mine).toBeDefined();
      // Twenty whole minutes, not zero hours.
      expect(mine!.silentMinutes).toBeGreaterThanOrEqual(19);
      expect(mine!.silentMinutes).toBeLessThanOrEqual(21);
      // And a threshold ABOVE the gap still matches nothing, which is the other half of the same query being right.
      expect((await alertRepo.silentDevices(tenantA, 60)).find((r) => r.deviceRef === 'dev-d5-held')).toBeUndefined();
    });

    it('accepts a fifteen-minute rule and says the gap in minutes when it fires', async () => {
      const rule: any = await alerts.createRule(tenantA, alertActor as never, {
        kind: 'device_silent', ruleName: 'BMC silence 15 min',
        threshold: { silentMinutes: 15 }, recipientUserIds: [raju], channelHint: 'ivr', cooldownMinutes: 5,
      });
      expect(silentMinutesOf(rule.threshold)).toBe(15);
      // `channel_hint = 'ivr'` — refused by 0086's CHECK until 0165 widened it, and it is the channel W170's
      // *"operator called"* is actually about.
      const stored = await admin.query(`SELECT threshold, channel_hint FROM ops_alert_rules WHERE id=$1`, [rule.id]);
      expect(stored.rows[0].threshold).toEqual({ silentMinutes: 15 });
      expect(stored.rows[0].channel_hint).toBe('ivr');

      const res = await alerts.evaluateTenant(tenantA);
      expect(res.fired).toBeGreaterThanOrEqual(1);
      const fired = await admin.query(
        `SELECT kind, severity, detail FROM ops_fired_alerts WHERE tenant_id=$1 AND kind='device_silent'
          ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(fired.rows[0].kind).toBe('device_silent');
      // Twenty minutes is a WARNING; two days would be critical. The unit changed, the meaning did not.
      expect(fired.rows[0].severity).toBe('warning');
      expect(fired.rows[0].detail).toMatchObject({ thresholdMinutes: 15 });
      expect(Number(fired.rows[0].detail.silentMinutes)).toBeGreaterThanOrEqual(19);

      const ev = await admin.query(
        `SELECT event_type, payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_type='ops_alert'
          ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(ev.rows[0].event_type).toBe('ops.alert_fired');
      // The body a village operator would read. *"~0h"* is what it used to have said.
      expect(String(ev.rows[0].payload.body)).toMatch(/has not reported for \d+ min/);
    });

    it('REFUSES a rule carrying both units, live at the edge', async () => {
      await expect(alerts.createRule(tenantA, alertActor as never, {
        kind: 'device_silent', ruleName: 'both units', threshold: { silentMinutes: 15, silentHours: 12 }, recipientUserIds: [raju],
      })).rejects.toThrow();
    });

    it('migrated the rows that already existed', async () => {
      // 0165's UPDATE. A rule written in hours before the migration reads as minutes now — one unit in the table.
      const legacy = await admin.query(
        `SELECT count(*)::int AS n FROM ops_alert_rules
          WHERE kind='device_silent' AND threshold ? 'silentHours'`);
      expect(legacy.rows[0].n).toBe(0);
      // And a hand-written legacy row is still READ correctly, because 0165 could only convert what existed then.
      await admin.query(
        `INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, created_by)
         VALUES ($1,'device_silent','legacy hours','{"silentHours": 12}'::jsonb, $2::jsonb, $3)`,
        [tenantA, JSON.stringify([raju]), desk]);
      const rules = await alertRepo.activeRulesForTenant(tenantA);
      const legacyRule = rules.find((r) => r.ruleName === 'legacy hours');
      expect(silentMinutesOf(legacyRule!.threshold as Record<string, unknown>)).toBe(720);
    });
  });

  /* ======================================================================================================= */
  describe('THE ALERT THAT MAY WAKE SOMEBODY', () => {
    it('catalogues ops.alert_critical as critical and unmutable', async () => {
      const r = await admin.query(
        `SELECT priority, default_channels, user_can_opt_out, batchable FROM notification_events WHERE code='ops.alert_critical'`);
      expect(r.rows).toHaveLength(1);
      // `critical` is the ONLY priority `resolveChannels()` lets past quiet hours; `important` was the old value and
      // the reason a warm tank at 2am reached nobody.
      expect(r.rows[0].priority).toBe('critical');
      expect(r.rows[0].user_can_opt_out).toBe(false);
      expect(r.rows[0].batchable).toBe(false);
      expect(r.rows[0].default_channels).toEqual(['push', 'sms', 'ivr']);
    });

    it('has nine SERVABLE templates for it — the send-time gate, not just a row', async () => {
      const r = await admin.query(
        `SELECT channel, language_code, serving_version_id IS NOT NULL AS servable
           FROM notification_templates
          WHERE event_code='ops.alert_critical' AND tenant_id IS NULL AND deleted_at IS NULL
          ORDER BY channel, language_code`);
      expect(r.rows).toHaveLength(9);
      // 0122's gate INNER JOINs the serving version: a template with none resolves to nothing and every send is
      // recorded as `no_template`, silently. That is what TENANT-6c-2 found and TENANT-6d-1 hit again.
      expect(r.rows.every((x: any) => x.servable === true)).toBe(true);
      expect(r.rows.filter((x: any) => x.channel === 'ivr')).toHaveLength(3);
    });

    it('sends a CRITICAL verdict on the critical outbox type', async () => {
      // Five breaches in the window is `severityFor`'s own critical threshold. Before this wave the event type was the
      // same for every severity, so this alert was catalogued `important` and suppressed on every phone channel
      // overnight.
      await alerts.createRule(tenantA, alertActor as never, {
        kind: 'cold_chain_breach', ruleName: 'BMC breaches', threshold: { windowHours: 6, minBreaches: 5 },
        recipientUserIds: [raju], cooldownMinutes: 5,
      });
      for (let i = 0; i < 5; i++) {
        await readings.record(tenantA, actor as never, { unitId: unitHeld, tempC: '9.0' });
      }
      await alerts.evaluateTenant(tenantA);
      const ev = await admin.query(
        `SELECT event_type, payload FROM outbox_events
          WHERE tenant_id=$1 AND event_type=$2 ORDER BY created_at DESC LIMIT 1`,
        [tenantA, OPS_ALERT_CRITICAL_OUTBOX_TYPE]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].payload.severity).toBe('critical');
      expect(ev.rows[0].payload.recipientUserIds).toEqual([raju]);
    });
  });

  /* ======================================================================================================= */
  describe('THE CALL', () => {
    it('places a masked call and files it against the COOLER', async () => {
      const r = await callSvc.place(tenantA, actor as never, `idem-${randomUUID()}`, unitHeld, 'tank at 9.0 and rising', '10.0.0.1');
      expect(r.calleeUserId).toBe(raju);

      const call = await admin.query(
        `SELECT caller_user_id, callee_user_id, context_type, context_id, provider_call_ref
           FROM masked_calls WHERE id=$1`, [r.maskedCallId]);
      expect(call.rows[0]).toMatchObject({
        caller_user_id: desk, callee_user_id: raju, context_type: 'bmc_unit', context_id: unitHeld,
      });
      // `context_type` has no CHECK, so only a live insert proves the vocabulary is written rather than assumed.
      expect(String(call.rows[0].provider_call_ref).length).toBeGreaterThan(0);

      const audit = await admin.query(
        `SELECT action, entity_type, entity_id, reason, new_value, actor_user_id FROM audit_log
          WHERE tenant_id=$1 AND action='dairy.bmc.operator_called' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(audit.rows[0]).toMatchObject({
        action: 'dairy.bmc.operator_called', entity_type: 'bmc_unit', entity_id: unitHeld,
        reason: 'tank at 9.0 and rising', actor_user_id: desk,
      });
      expect(audit.rows[0].new_value).toMatchObject({ maskedCallId: r.maskedCallId, calleeUserId: raju });
      // NO PHONE NUMBER on the trail, because the platform never had one.
      expect(JSON.stringify(audit.rows[0])).not.toMatch(/\+91|phone/i);
    });

    it('rings the operator ONCE for one idempotency key', async () => {
      const key = `idem-${randomUUID()}`;
      const before = await admin.query(`SELECT count(*)::int n FROM masked_calls WHERE tenant_id=$1`, [tenantA]);
      const a = await callSvc.place(tenantA, actor as never, key, unitHeld, 'checking the DG fuel', null);
      const b = await callSvc.place(tenantA, actor as never, key, unitHeld, 'checking the DG fuel', null);
      expect(b.maskedCallId).toBe(a.maskedCallId);
      const after = await admin.query(`SELECT count(*)::int n FROM masked_calls WHERE tenant_id=$1`, [tenantA]);
      // A village tablet retrying a dropped request must not ring somebody twice.
      expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    });

    it('REFUSES to call a centre nobody holds, and writes nothing', async () => {
      const before = await admin.query(
        `SELECT (SELECT count(*) FROM masked_calls WHERE tenant_id=$1) c,
                (SELECT count(*) FROM audit_log WHERE tenant_id=$1 AND action='dairy.bmc.operator_called') a`, [tenantA]);
      await expect(callSvc.place(tenantA, actor as never, `idem-${randomUUID()}`, unitVacant, 'nobody there', null))
        .rejects.toBeInstanceOf(BmcCallRefusedError);
      const after = await admin.query(
        `SELECT (SELECT count(*) FROM masked_calls WHERE tenant_id=$1) c,
                (SELECT count(*) FROM audit_log WHERE tenant_id=$1 AND action='dairy.bmc.operator_called') a`, [tenantA]);
      expect(after.rows[0]).toEqual(before.rows[0]);
      // And the confirm step says the same thing, from the same facts.
      const p = await callSvc.preview(tenantA, actor as never, unitVacant, 'nobody there');
      expect(p.allowed).toBe(false);
      expect(p.refusals).toEqual(['NOBODY_HOLDS_CENTRE']);
      expect(p.object.operatorName).toBeNull();
    });

    it('REFUSES to bridge the holder to their own phone', async () => {
      const asRaju = { userId: raju, canManage: true };
      await expect(callSvc.place(tenantA, asRaju as never, `idem-${randomUUID()}`, unitHeld, 'calling myself', null))
        .rejects.toBeInstanceOf(BmcCallRefusedError);
      const p = await callSvc.preview(tenantA, asRaju as never, unitHeld, 'calling myself');
      expect(p.refusals).toEqual(['CALLING_YOURSELF']);
    });

    it('shows the object from real rows, with the reading\'s own currency', async () => {
      const p = await callSvc.preview(tenantA, actor as never, unitHeld, 'tank at 9.0');
      expect(p.object.mccCode).toBe('MCC-D5-01');
      expect(p.object.mccName).toBe('Keshod');
      // Raju holds this centre AND holds a role in this cooperative, so the name is verifiable and printed.
      expect(p.object.operatorUnnamed).toBe(false);
      expect(p.object.heldSince).not.toBeNull();
      // The reading was written moments ago by this suite, so it IS the tank's condition.
      expect(p.object.tempC).toBe('9.0');
      expect(p.object.tempIsCurrent).toBe(true);
      expect(p.allowed).toBe(true);
    });

    it('previews a cooler that is not this cooperative\'s without leaking that it exists', async () => {
      const p = await callSvc.preview(tenantA, actor as never, randomUUID(), 'somebody else\'s tank');
      expect(p.refusals).toEqual(['UNIT_NOT_FOUND']);
      expect(p.object.mccCode).toBe('');
      expect(p.object.operatorName).toBeNull();
    });
  });
});
