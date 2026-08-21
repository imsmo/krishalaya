// modules/dairy/__tests__/tenant6d4-forms.integration.spec.ts · PC-56 TENANT-6d-4, LIVE Postgres.
//
// The wave's promise is a claim about TWO CODE PATHS AGREEING, and only a real database can settle it:
//
//   1. **READY MEANS THE WRITE SUCCEEDS.** Every body in the table below goes through `preview` and then through the
//      act. Where the review said `ready`, the act must succeed; where it refused, the act must throw. A review
//      computed from stale or different facts passes every unit test and fails here.
//   2. **THE FACTS ONLY THE DATABASE HAS.** `CODE_EXISTS`, `DEVICE_REF_TAKEN` and `OPERATOR_NOT_IN_TENANT` are
//      questions about rows — a duplicate code, a sensor reference already in use, a person with no role in this
//      cooperative. A unit test can only assert that the flag was honoured; this asserts it was ASKED, correctly.
//   3. **THE REVIEW WRITES NOTHING.** No row, no audit entry, no outbox message — asserted by counting all three
//      before and after. A maker-checker step with a side effect is not a maker-checker step.
//   4. **A TYPO IS NOT A 500.** `mccId: 'MCC-AND-03'` is a `22P02` if it reaches Postgres. The review must answer
//      *"no centre of this cooperative has that id"* instead, because the review is the screen that explains entries.
//   5. **A REVIEW IS NOT AN ACT.** It takes no idempotency key, so asking twice must answer twice — a cached answer to
//      a question whose facts have moved on is worse than no review at all.
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

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { BmcUnitService } from '../services/bmc-unit.service';
import { DairyForbiddenError } from '../domain/dairy.errors';
import { CreateMccSchema } from '../dto/create-mcc-centre.dto';
import { RegisterBmcSchema } from '../dto/bmc.dto';
import { submittedValues } from '../dto/dairy-form-preview.dto';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-4 · the review and the act, in agreement (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let units: BmcUnitService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const desk = randomUUID();
  const raju = randomUUID();
  const outsider = randomUUID();          // a real user, of tenant B only
  const actor = { userId: desk, canManage: true };
  const clerk = { userId: raju, canManage: false };

  let centreId = '';

  const roleIn = (userId: string, tenantId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantId]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [desk, raju, outsider]) await makeUser(admin, u);
    await roleIn(desk, tenantA); await roleIn(raju, tenantA); await roleIn(outsider, tenantB);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);

    const mccRepo = new MccCentreRepository(replica as never);
    const unitRepo = new BmcUnitRepository(replica as never);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    units = new BmcUnitService(uow, outbox, idem, metrics, audit, unitRepo, mccRepo);

    const created: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, {
      code: 'MCC-D4-01', defaultName: 'Vanthali', capacityLitresShift: '1200',
    } as never, null);
    centreId = created.id;
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE REVIEW WRITES NOTHING', () => {
    const counts = async () => {
      const q = await admin.query(
        `SELECT (SELECT count(*) FROM mcc_centres WHERE tenant_id=$1) centres,
                (SELECT count(*) FROM bmc_units WHERE tenant_id=$1) units,
                (SELECT count(*) FROM audit_log WHERE tenant_id=$1) audits,
                (SELECT count(*) FROM outbox_events WHERE tenant_id=$1) events`, [tenantA]);
      return q.rows[0];
    };

    it('leaves no row, no audit entry and no event behind — for a ready review or a refused one', async () => {
      const before = await counts();
      await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-99', defaultName: 'Nowhere' } as never);
      await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-01', defaultName: 'Vanthali' } as never);
      await units.previewRegister(tenantA, actor as never, { mccId: centreId, capacityLitres: '2000' } as never);
      await units.previewRegister(tenantA, actor as never, { mccId: 'MCC-AND-03', capacityLitres: 'lots' } as never);
      expect(await counts()).toEqual(before);
    });

    it('answers the same question twice, because a review is not an act', async () => {
      // No idempotency key: the second ask must be answered from the CURRENT rows, not replayed. A cached review is
      // how an operator confirms against facts that changed while they were reading.
      const first: any = await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-TWICE', defaultName: 'Twice' } as never);
      expect(first.ready).toBe(true);
      await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D4-TWICE', defaultName: 'Twice' } as never, null);
      const second: any = await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-TWICE', defaultName: 'Twice' } as never);
      expect(second.ready).toBe(false);
      expect(second.refusals).toEqual([{ field: 'code', code: 'CODE_EXISTS' }]);
    });

    it('refuses to review at all without dairy.manage', async () => {
      // The permission is checked BEFORE any lookup: a clerk must not be able to probe which codes are taken.
      await expect(mccs.previewCreate(tenantA, clerk as never, { code: 'X', defaultName: 'Y' } as never))
        .rejects.toBeInstanceOf(DairyForbiddenError);
      await expect(units.previewRegister(tenantA, clerk as never, { mccId: centreId, capacityLitres: '1' } as never))
        .rejects.toBeInstanceOf(DairyForbiddenError);
    });
  });

  /* ======================================================================================================= */
  describe('THE FACTS ONLY THE DATABASE HAS', () => {
    it('sees a code already used by this cooperative — and not one used by another', async () => {
      const mine: any = await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-01', defaultName: 'Again' } as never);
      expect(mine.refusals).toEqual([{ field: 'code', code: 'CODE_EXISTS' }]);
      // Tenant B may hold the same code. A review that saw across tenants would leak the fact that it exists.
      const theirs: any = await mccs.previewCreate(tenantB, actor as never, { code: 'MCC-D4-01', defaultName: 'Elsewhere' } as never);
      expect(theirs.ready).toBe(true);
    });

    it('names the person who holds no role in this cooperative', async () => {
      const r: any = await mccs.previewCreate(tenantA, actor as never, {
        code: 'MCC-D4-02', defaultName: 'Bhesan', operatorUserId: outsider, operatorReason: 'runs the counter',
      } as never);
      expect(r.refusals).toEqual([{ field: 'operatorUserId', code: 'OPERATOR_NOT_IN_TENANT' }]);
      // And the same body with somebody who DOES hold a role is ready — the gate is about membership, not about ids.
      const ok: any = await mccs.previewCreate(tenantA, actor as never, {
        code: 'MCC-D4-02', defaultName: 'Bhesan', operatorUserId: raju, operatorReason: 'runs the counter',
      } as never);
      expect(ok.ready).toBe(true);
    });

    it('sees a sensor reference already carrying another tank\'s readings', async () => {
      await units.register(tenantA, actor as never, `idem-${randomUUID()}`, {
        mccId: centreId, capacityLitres: '1500', iotDeviceRef: 'dev-d4-1',
      } as never);
      const r: any = await units.previewRegister(tenantA, actor as never, {
        mccId: centreId, capacityLitres: '2000', iotDeviceRef: 'dev-d4-1',
      } as never);
      expect(r.refusals).toEqual([{ field: 'iotDeviceRef', code: 'DEVICE_REF_TAKEN' }]);
    });

    it('answers a typo with a reason instead of a 22P02', async () => {
      // `MCC-AND-03` is what an operator types when they mean the centre they know by its code. Handing it to Postgres
      // is an invalid-input-syntax error — a 500 on the one screen whose job is to explain what is wrong.
      const r: any = await units.previewRegister(tenantA, actor as never, { mccId: 'MCC-AND-03', capacityLitres: '2000' } as never);
      expect(r.refusals).toEqual([{ field: 'mccId', code: 'MCC_NOT_FOUND' }]);
      const c: any = await mccs.previewCreate(tenantA, actor as never, { code: 'MCC-D4-03', defaultName: 'Typo', operatorUserId: 'raju' } as never);
      expect(c.refusals).toEqual([{ field: 'operatorUserId', code: 'OPERATOR_NOT_IN_TENANT' }]);
    });

    it('shows the resolved centre and the band the register will actually apply', async () => {
      const r: any = await units.previewRegister(tenantA, actor as never, { mccId: centreId, capacityLitres: '2000' } as never);
      const stored = (n: string) => r.fields.find((f: any) => f.name === n)?.stored;
      expect(stored('mccId')).toBe('MCC-D4-01 · Vanthali');
      expect([stored('minTempC'), stored('targetTempC'), stored('toleranceC'), stored('bandMaxC')])
        .toEqual(['0.0', '4.0', '0.5', '4.5']);
      expect(stored('capacityLitres')).toBe('2000.00');
      // And what it says will be stored IS what is stored.
      const made: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, { mccId: centreId, capacityLitres: '2000' } as never);
      const row = await admin.query(
        `SELECT capacity_litres::text, min_temp_c::text, target_temp_c::text, tolerance_c::text FROM bmc_units WHERE id=$1`, [made.id]);
      expect(row.rows[0]).toEqual({ capacity_litres: '2000.00', min_temp_c: '0.0', target_temp_c: '4.0', tolerance_c: '0.5' });
    });
  });

  /* ======================================================================================================= */
  describe('READY MEANS THE WRITE SUCCEEDS', () => {
    it('agrees with the centre act on every body, ready or refused', async () => {
      const bodies: Array<Record<string, string>> = [
        { code: 'MCC-D4-A1', defaultName: 'One' },
        { code: 'MCC-D4-A2', defaultName: 'Two', capacityLitresShift: '1200', morningOpensAt: '06:00', morningClosesAt: '09:30' },
        { code: 'MCC-D4-A3', defaultName: 'Three', operatorUserId: raju, operatorReason: 'holds the centre' },
        { code: 'MCC-D4-01', defaultName: 'Duplicate' },
        { code: '', defaultName: 'Nameless code' },
        { code: 'MCC-D4-A4', defaultName: 'Half a window', morningOpensAt: '06:00' },
        { code: 'MCC-D4-A5', defaultName: 'Reason alone', operatorReason: 'nobody to be about' },
        { code: 'MCC-D4-A6', defaultName: 'Outsider', operatorUserId: outsider },
        { code: 'C'.repeat(41), defaultName: 'Too long' },
        { code: 'MCC-D4-A7', defaultName: 'Bad clock', morningOpensAt: '06:00:30', morningClosesAt: '09:00' },
      ];
      for (const body of bodies) {
        const review: any = await mccs.previewCreate(tenantA, actor as never, body as never);
        const attempt = mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, submittedValues(body) as never, null)
          .then(() => 'wrote' as const, (e: Error) => e);
        const outcome = await attempt;
        if (review.ready) {
          // A review that says ready and is followed by a failure is the defect this wave exists to prevent.
          expect({ body, outcome: outcome === 'wrote' ? 'wrote' : `THREW: ${String(outcome)}` }).toEqual({ body, outcome: 'wrote' });
        } else {
          expect({ body, wrote: outcome === 'wrote' }).toEqual({ body, wrote: false });
        }
      }
    });

    it('agrees with the register on every body, ready or refused', async () => {
      const bodies: Array<Record<string, string>> = [
        { mccId: centreId, capacityLitres: '900' },
        { mccId: centreId, capacityLitres: '900', minTempC: '0.0', targetTempC: '4.0', toleranceC: '0.5', model: 'Fx' },
        { mccId: centreId, capacityLitres: '900', iotDeviceRef: 'dev-d4-1' },     // taken
        { mccId: 'MCC-AND-03', capacityLitres: '900' },                            // not an id
        { mccId: randomUUID(), capacityLitres: '900' },                            // an id, but not a centre here
        { mccId: centreId, capacityLitres: '0' },                                  // holds nothing
        { mccId: centreId, capacityLitres: '900', toleranceC: '-0.5' },
        { mccId: centreId, capacityLitres: '900', minTempC: '2.0', targetTempC: '1.0' },
        { mccId: centreId, capacityLitres: '900', serialNo: 'S'.repeat(101) },
      ];
      for (const body of bodies) {
        const review: any = await units.previewRegister(tenantA, actor as never, body as never);
        // The act is guarded by its own strict schema, so a body the schema refuses never reaches it — which is
        // exactly what the review has to predict. Both gates count as "did not write".
        const parsed = RegisterBmcSchema.safeParse(submittedValues(body));
        const outcome = parsed.success
          ? await units.register(tenantA, actor as never, `idem-${randomUUID()}`, parsed.data as never)
            .then(() => 'wrote' as const, (e: Error) => e)
          : new Error('refused by the create schema');
        if (review.ready) {
          expect({ body, outcome: outcome === 'wrote' ? 'wrote' : `THREW: ${String(outcome)}` }).toEqual({ body, outcome: 'wrote' });
        } else {
          expect({ body, wrote: outcome === 'wrote' }).toEqual({ body, wrote: false });
        }
      }
    });

    it('never says ready for a body the create schema itself would refuse', async () => {
      // The belt, live: the review reports the writer's own validator as refusals, so `ready` cannot outrun it.
      for (const body of [
        { code: 'MCC-D4-B1', defaultName: 'N'.repeat(151) },
        { code: 'MCC-D4-B2', defaultName: 'Fine', capacityLitresShift: '1.234' },
      ]) {
        const review: any = await mccs.previewCreate(tenantA, actor as never, body as never);
        expect({ body, ready: review.ready, schema: CreateMccSchema.safeParse(submittedValues(body)).success })
          .toEqual({ body, ready: false, schema: false });
      }
    });
  });
});
