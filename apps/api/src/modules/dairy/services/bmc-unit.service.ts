// modules/dairy/services/bmc-unit.service.ts · PC-56 TENANT-6d-1 · registering and running a bulk milk cooler.
//
// The acts W170 and its chain screens (W2517–W2523) imply, and which had no implementation at all: register a cooler
// under an MCC, set the band it is judged against, report how full it is, say what the compressor is doing, retire it.
//
// All of them are `dairy.manage` — the cooperative's own desk, not the platform's fleet team. Every one is idempotent
// (Law 3) and audited (a cooler's band decides whose milk gets diverted), and every one writes its event through the
// outbox in the same transaction (Law 4).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { BmcUnit, CompressorState } from '../domain/bmc-unit.entity';
import { DomainEvent } from '../domain/dairy.events';
import { BmcUnitInvalidError, BmcUnitNotFoundError, DairyForbiddenError, MccNotFoundError } from '../domain/dairy.errors';
import { deciOfC } from '../domain/bmc';
import { DairyActor } from './mcc-centre.service';

@Injectable()
export class BmcUnitService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly units: BmcUnitRepository,
    private readonly mccs: MccCentreRepository,
  ) {}

  private assertDesk(actor: DairyActor) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
  }

  /**
   * Register a cooler under a centre — the act W170's *"No BMC units → Add BMC"* empty state points at.
   *
   * The CENTRE is checked first and by this tenant's own read, so a cooler cannot be hung off another cooperative's
   * centre by id. The sensor reference is optional: a cooler read by a thermometer and a notebook is a real cooler, and
   * refusing to record it would push the cooperative back to the notebook for everything.
   */
  async register(tenantId: string, actor: DairyActor, idemKey: string, dto: {
    mccId: string; capacityLitres: string; targetTempC?: string; minTempC?: string; toleranceC?: string;
    iotDeviceRef?: string | null; model?: string | null; serialNo?: string | null;
  }) {
    this.assertDesk(actor);
    return this.idem.remember(idemKey, actor.userId, 'dairy.bmc.register', () =>
      timed(this.metrics, 'dairy.bmc_register', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const mcc = await this.mccs.getById(tenantId, dto.mccId, tx);
          if (!mcc) throw new MccNotFoundError(dto.mccId);
          const unit = BmcUnit.register({
            id: uuidv7(), tenantId, mccId: dto.mccId,
            minDeci: deciOfC(dto.minTempC ?? '0.0'),
            targetDeci: deciOfC(dto.targetTempC ?? '4.0'),
            toleranceDeci: deciOfC(dto.toleranceC ?? '0.5'),
            capacityCenti: centiOfLitres(dto.capacityLitres),
            iotDeviceRef: dto.iotDeviceRef ?? null, model: dto.model ?? null, serialNo: dto.serialNo ?? null,
          });
          await this.units.insert(tx, unit);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.bmc.registered',
            entityType: 'bmc_unit', entityId: unit.id, newValue: unit.toJSON() as Record<string, unknown>,
          });
          await this.flush(tx, tenantId, unit.id, unit.pullEvents());
          return unit.toJSON();
        }, { userId: actor.userId })));
  }

  /** Change what "cold enough" means for this tank. Audited with the before AND after — it is a policy change. */
  async setBand(tenantId: string, actor: DairyActor, id: string, dto: { minTempC: string; targetTempC: string; toleranceC: string }) {
    this.assertDesk(actor);
    return this.mutate(tenantId, actor, id, (u) => {
      u.setBand(deciOfC(dto.minTempC), deciOfC(dto.targetTempC), deciOfC(dto.toleranceC), actor.userId);
    }, 'dairy.bmc.band_changed');
  }

  /**
   * *"41% full"*. Idempotency-keyed like every other write, because a level reported twice from a flaky counter tablet
   * is one level.
   */
  async reportLevel(tenantId: string, actor: DairyActor, id: string, idemKey: string, dto: { volumeLitres: string; at?: string }) {
    this.assertDesk(actor);
    return this.idem.remember(idemKey, actor.userId, 'dairy.bmc.level', () =>
      this.mutate(tenantId, actor, id, (u) => {
        u.reportLevel(centiOfLitres(dto.volumeLitres), dto.at ? new Date(dto.at) : new Date(), actor.userId);
      }, 'dairy.bmc.level_reported'));
  }

  /** Somebody's word about the machine, stamped and attributed. */
  async stateCompressor(tenantId: string, actor: DairyActor, id: string, dto: { state: CompressorState }) {
    this.assertDesk(actor);
    return this.mutate(tenantId, actor, id, (u) => {
      u.stateCompressor(dto.state, new Date(), actor.userId);
    }, 'dairy.bmc.compressor_stated');
  }

  /** The cooler is gone. Its readings stay; the monitor stops watching. */
  async retire(tenantId: string, actor: DairyActor, id: string) {
    this.assertDesk(actor);
    return this.mutate(tenantId, actor, id, (u) => u.retire(new Date(), actor.userId), 'dairy.bmc.retired');
  }

  async list(tenantId: string, actor: DairyActor, opts: { mccId?: string; includeRetired?: boolean } = {}) {
    this.assertDesk(actor);
    const rows = await this.units.listForTenant(tenantId, opts);
    return rows.map((u) => u.toJSON());
  }

  async getById(tenantId: string, actor: DairyActor, id: string) {
    this.assertDesk(actor);
    const u = await this.uow.run(tenantId, (tx) => this.units.byId(tx, tenantId, id), { userId: actor.userId });
    if (!u) throw new BmcUnitNotFoundError(id);
    return u.toJSON();
  }

  /** One shape for every act on a cooler: lock, mutate, write, audit, publish. */
  private async mutate(tenantId: string, actor: DairyActor, id: string, fn: (u: BmcUnit) => void, action: string) {
    return timed(this.metrics, 'dairy.bmc_mutate', { tenant: tenantId, action }, () =>
      this.uow.run(tenantId, async (tx) => {
        const unit = await this.units.getForUpdate(tx, tenantId, id);
        if (!unit) throw new BmcUnitNotFoundError(id);
        const before = unit.toJSON() as Record<string, unknown>;
        fn(unit);
        await this.units.update(tx, unit);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action,
          entityType: 'bmc_unit', entityId: id, oldValue: before, newValue: unit.toJSON() as Record<string, unknown>,
        });
        await this.flush(tx, tenantId, id, unit.pullEvents());
        return unit.toJSON();
      }, { userId: actor.userId }));
  }

  private async flush(tx: TxContext, tenantId: string, unitId: string, events: DomainEvent[]) {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'bmc_unit', aggregateId: unitId, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}

/**
 * Litres to hundredths, by string. `numeric(10,2)` is the column, and `Number('1500.5') * 100` is how a 2,000 L tank
 * comes to hold 199999 centilitres.
 */
export function centiOfLitres(s: string): bigint {
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(s).trim());
  if (!m) throw new BmcUnitInvalidError(`not a litre volume this platform can store to two decimals: ${JSON.stringify(s)}`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}
