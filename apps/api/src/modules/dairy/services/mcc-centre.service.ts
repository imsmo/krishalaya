// modules/dairy/services/mcc-centre.service.ts · MCC infrastructure use-cases (cooperative-admin).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create (Law 3), authz THROWS (Law 6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MccCentre } from '../domain/mcc-centre.entity';
import { DomainEvent } from '../domain/dairy.events';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { CreateMccDto } from '../dto/create-mcc-centre.dto';
import { MccNotFoundError, MccCodeExistsError, DairyForbiddenError } from '../domain/dairy.errors';

export interface DairyActor {
  userId: string;
  canManage: boolean;
  /**
   * [PC-56 TENANT-6c-3] Holds `settlement.close` — the SECOND key W169 names on preview and approve. Optional so that
   * every existing construction site still compiles, and absent therefore means FALSE: a caller that does not set it
   * cannot approve a cycle. Fail-closed is the only safe default for a key that guards 312 families' milk money.
   */
  canCloseSettlement?: boolean;
}

@Injectable()
export class MccCentreService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: MccCentreRepository,
  ) {}

  async create(tenantId: string, actor: DairyActor, idemKey: string, dto: CreateMccDto, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.mcc.create', () =>
      timed(this.metrics, 'dairy.mcc.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const mcc = MccCentre.create({ id: uuidv7(), tenantId, code: dto.code, defaultName: dto.defaultName, regionId: dto.regionId ?? null,
            lat: dto.lat ?? null, lng: dto.lng ?? null, operatorUserId: dto.operatorUserId ?? actor.userId,
            capacityLitresShift: dto.capacityLitresShift ?? null, analyzerModel: dto.analyzerModel ?? null, analyzerSerial: dto.analyzerSerial ?? null });
          try { await this.repo.insert(tx, mcc); } catch (e: any) { if (e?.code === '23505') throw new MccCodeExistsError(); throw e; }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.created', entityType: 'mcc_centre', entityId: mcc.id, newValue: { code: dto.code }, ip });
          await this.flush(tx, tenantId, mcc.id, mcc.pullEvents());
          return mcc.toJSON();
        }, { userId: actor.userId })));
  }

  async setActive(tenantId: string, actor: DairyActor, id: string, isActive: boolean, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const mcc = await this.repo.getForUpdate(tx, tenantId, id);
      if (!mcc) throw new MccNotFoundError(id);
      mcc.setActive(isActive);
      await this.repo.update(tx, mcc);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.set_active', entityType: 'mcc_centre', entityId: id, newValue: { isActive }, ip });
      return mcc.toJSON();
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, id: string) { const m = await this.repo.getById(tenantId, id); if (!m) throw new MccNotFoundError(id); return m.toJSON(); }
  async list(tenantId: string, q: { activeOnly: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((m) => m.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'mcc_centre', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
