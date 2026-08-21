// modules/logistics/services/cold-chain.service.ts · record + read reefer/vaccine temperature telemetry. Writes
// are APPEND-ONLY (one INSERT per reading, in a UoW tx) — no per-reading outbox (volume); breach alerting is the
// worker job's role (it scans is_breach rows). Authorization THROWS (logistics.manage). Reads on the replica,
// keyset, bounded. Temperatures are decimals, not money.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { ColdChainLog, ColdChainSubject } from '../domain/cold-chain-log.entity';
import { ShipmentForbiddenError } from '../domain/logistics.errors';
import { ColdChainLogRepository } from '../repositories/cold-chain-log.repository';
import { RecordColdChainDto, QueryColdChainDto } from '../dto/cold-chain.dto';
import { FleetActor, encodeFleetCursor } from './logistics-partner.service';

@Injectable()
export class ColdChainService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: ColdChainLogRepository,
  ) {}

  private assertManager(a: FleetActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  /** Append a temperature reading; is_breach is computed against the supplied allowed band. */
  async record(tenantId: string, actor: FleetActor, dto: RecordColdChainDto) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.cold_chain_record', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const log = ColdChainLog.record({
          tenantId, subjectType: dto.subjectType, subjectId: dto.subjectId, tempC: dto.tempC,
          humidityPct: dto.humidityPct ?? null, deviceRef: dto.deviceRef ?? null, recordedAt: new Date(dto.recordedAt),
          allowedMinC: dto.allowedMinC, allowedMaxC: dto.allowedMaxC,
        });
        const id = await this.repo.insert(tx, log);
        const p = log.toProps();
        return { id, subjectType: p.subjectType, subjectId: p.subjectId, tempC: p.tempC, isBreach: p.isBreach, recordedAt: p.recordedAt };
      }, { userId: actor.userId }));
  }

  /**
   * APPEND A READING ON BEHALF OF THE MODULE THAT OWNS THE SUBJECT (PC-56 TENANT-6d-1).
   *
   * `record()` above is the LOGISTICS route's door: it demands `logistics.manage` and takes the allowed band from the
   * caller's DTO. Neither is right for a dairy's bulk milk cooler:
   *
   *   • a dairy secretary is not a fleet manager, and requiring `logistics.manage` to write the temperature of your own
   *     cooperative's tank is a permission granted to the wrong role — this programme's own defect list;
   *   • a band supplied by whoever is writing means an IoT stream can declare its own definition of "cold enough" and
   *     never breach. A cooler's band belongs to the cooler (`bmc_units`, 0162), and only the module that owns that
   *     row can read it.
   *
   * So the seam is: LOGISTICS owns `cold_chain_logs` and the breach arithmetic (one writer, one `is_breach` rule), and
   * the SUBJECT's module owns who may write about it and what its band is. The caller has authorised this write before
   * it gets here — `DairyBmcReadingService` checks `dairy.manage` and resolves the band from the unit — which is why
   * this method takes no actor to check and says so out loud rather than looking like an oversight.
   *
   * Not a public route. Reachable only through a module that imports `LogisticsModule` and calls this service, which is
   * exactly what CLAUDE.md's module rule allows (public service, never another module's repository).
   */
  async appendForOwner(tenantId: string, input: {
    subjectType: ColdChainSubject; subjectId: string; tempC: number; humidityPct?: number | null;
    deviceRef?: string | null; recordedAt: Date; allowedMinC: number; allowedMaxC: number; byUserId?: string | null;
  }) {
    return timed(this.metrics, 'logistics.cold_chain_append_for_owner', { tenant: tenantId, subject: input.subjectType }, () =>
      this.uow.run(tenantId, async (tx) => {
        const log = ColdChainLog.record({
          tenantId, subjectType: input.subjectType, subjectId: input.subjectId, tempC: input.tempC,
          humidityPct: input.humidityPct ?? null, deviceRef: input.deviceRef ?? null, recordedAt: input.recordedAt,
          allowedMinC: input.allowedMinC, allowedMaxC: input.allowedMaxC,
        });
        const id = await this.repo.insert(tx, log);
        const p = log.toProps();
        return { id, subjectType: p.subjectType, subjectId: p.subjectId, tempC: p.tempC, isBreach: p.isBreach, recordedAt: p.recordedAt };
      }, { userId: input.byUserId ?? undefined }));
  }

  async listForSubject(tenantId: string, q: Omit<QueryColdChainDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.listForSubject(tenantId, {
      subjectType: q.subjectType, subjectId: q.subjectId, breachOnly: q.breachOnly,
      since: q.since ? new Date(q.since) : undefined, cursor: q.cursor, limit: q.limit,
    });
    const items = rows.map((l) => { const p = l.toProps(); return { id: p.id, subjectType: p.subjectType, subjectId: p.subjectId, tempC: p.tempC, humidityPct: p.humidityPct, deviceRef: p.deviceRef, isBreach: p.isBreach, recordedAt: p.recordedAt }; });
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last && last.recordedAt && last.id ? encodeFleetCursor(last.recordedAt, last.id) : null;
    return { items, nextCursor };
  }

  /** PC-54 W54-12 fleet + alert reads (logistics.manage — enforced at the controller like the other reads). */
  deviceFleet(tenantId: string) { return this.repo.deviceFleet(tenantId); }
  breaches(tenantId: string, hours = 24, limit = 100) { return this.repo.breaches(tenantId, hours, limit); }
}
