// modules/warehousing/services/warehouse.service.ts · warehouse listing use-cases (operator-admin).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create (Law 3), authz THROWS (Law 6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Warehouse } from '../domain/warehouse.entity';
import { DomainEvent } from '../domain/warehousing.events';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { WarehouseNotFoundError, WarehousingForbiddenError, WarehouseOperatorNotAMemberError } from '../domain/warehousing.errors';

const QUOTA_METRIC = 'warehouses';
export interface WhActor { userId: string; canManage: boolean; canStore: boolean; isAdmin: boolean; }
const big = (s?: string) => (s == null ? null : BigInt(s));

@Injectable()
export class WarehouseService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: WarehouseRepository,
  ) {}

  async register(tenantId: string, actor: WhActor, idemKey: string, dto: CreateWarehouseDto, ip: string | null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    return this.idem.remember(idemKey, actor.userId, 'warehousing.warehouse.create', () =>
      timed(this.metrics, 'warehousing.warehouse.create', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        return this.uow.run(tenantId, async (tx) => {
          // PC-56 OPS-2c · OPS2-B6: a NAMED operator must be an active member of this organisation — refused by name before the insert (the
          // idempotency claim is released on the throw, so nothing is written). The default operator is the caller, who is.
          if (dto.operatorUserId !== undefined && !(await this.repo.isActiveTenantMember(tx, tenantId, dto.operatorUserId))) throw new WarehouseOperatorNotAMemberError();
          const w = Warehouse.list({ id: uuidv7(), tenantId, operatorUserId: dto.operatorUserId ?? actor.userId, defaultName: dto.defaultName, wdraRegNo: dto.wdraRegNo ?? null,
            addressId: dto.addressId ?? null, capacityMt: dto.capacityMt ?? null, storageKinds: dto.storageKinds, commoditiesAccepted: dto.commoditiesAccepted,
            ratePerQtlMonthMinor: big(dto.ratePerQtlMonthMinor), insurancePolicyRef: dto.insurancePolicyRef ?? null });
          await this.repo.insert(tx, w);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.warehouse.listed', entityType: 'warehouse', entityId: w.id, newValue: { name: dto.defaultName }, ip });
          await this.flush(tx, tenantId, w.id, w.pullEvents());
          return w.toJSON();
        }, { userId: actor.userId });
      }));
  }

  /**
   * PC-56 OPS-2c · OPS2-B4 / B6 (founder Q1-A, Q2-A, 2026-11-06). The update can change THE RATE the storage fee is computed from and THE OPERATOR
   * whose own wallet would receive it. Now:
   *   • a named operator who is not an active member of this organisation is refused BY NAME, before any write (B6);
   *   • every update writes EXACTLY ONE audit row (`warehousing.warehouse.updated`) in the same transaction, carrying the before/after of
   *     `ratePerQtlMonthMinor` and `operatorUserId` — only the ones that changed — and the names of the fields the request set (B4).
   * The operator-only check (and its `booking.manage` escape, survey F-5) is NOT changed here: that is OPS-2a's first commit (founder Q11-A).
   */
  async update(tenantId: string, actor: WhActor, id: string, dto: UpdateWarehouseDto, ip: string | null = null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    return this.uow.run(tenantId, async (tx) => {
      const w = await this.repo.getForUpdate(tx, tenantId, id);
      if (!w) throw new WarehouseNotFoundError(id);
      if (w.operatorUserId !== actor.userId && !actor.isAdmin) throw new WarehousingForbiddenError('only the operator may edit this warehouse');
      if (dto.operatorUserId !== undefined && !(await this.repo.isActiveTenantMember(tx, tenantId, dto.operatorUserId))) throw new WarehouseOperatorNotAMemberError();
      const before = { ratePerQtlMonthMinor: w.ratePerQtlMonthMinor?.toString() ?? null, operatorUserId: w.operatorUserId };
      w.update({ ...dto, ratePerQtlMonthMinor: dto.ratePerQtlMonthMinor !== undefined ? BigInt(dto.ratePerQtlMonthMinor) : undefined });
      const after = { ratePerQtlMonthMinor: w.ratePerQtlMonthMinor?.toString() ?? null, operatorUserId: w.operatorUserId };
      await this.repo.update(tx, w);
      const oldValue: Record<string, unknown> = {}; const newValue: Record<string, unknown> = { fields: Object.keys(dto).sort() };
      for (const k of ['ratePerQtlMonthMinor', 'operatorUserId'] as const) if (before[k] !== after[k]) { oldValue[k] = before[k]; newValue[k] = after[k]; }
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.warehouse.updated', entityType: 'warehouse', entityId: w.id, oldValue, newValue, ip });
      await this.flush(tx, tenantId, w.id, w.pullEvents());
      return w.toJSON();
    }, { userId: actor.userId });
  }
  async getById(tenantId: string, id: string) { const w = await this.repo.getBookable(tenantId, id); if (!w) throw new WarehouseNotFoundError(id); return w.toJSON(); }
  async list(tenantId: string, actor: WhActor, q: { box: 'mine' | 'browse' | 'all'; activeOnly: boolean; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.isAdmin) throw new WarehousingForbiddenError('requires booking.manage');
    const rows = await this.repo.listFor(tenantId, { box: q.box, ownerUserId: actor.userId, activeOnly: q.activeOnly, cursor: q.cursor, limit: q.limit });
    const items = rows.map((w) => w.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'warehouse', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
