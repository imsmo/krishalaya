// modules/logistics/services/pickup-slot.service.ts · a seller's own weekly pickup windows. Ownership is the
// authorization: a seller only ever creates/reads/edits slots where seller_user_id = caller (enforced in every
// query). Every write: one ACID tx (UoW) + outbox event in the SAME tx + audit + idempotency on create. Reads on
// the replica, keyset, bounded. No money, no cross-seller visibility.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { PickupSlot } from '../domain/pickup-slot.entity';
import { DomainEvent } from '../domain/logistics.events';
import { PickupSlotNotFoundError } from '../domain/logistics.errors';
import { PickupSlotRepository } from '../repositories/pickup-slot.repository';
import { CreatePickupSlotDto, UpdatePickupSlotDto, QueryPickupSlotDto } from '../dto/create-pickup-slot.dto';
import { encodeFleetCursor } from './logistics-partner.service';

@Injectable()
export class PickupSlotService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: PickupSlotRepository,
  ) {}

  async create(tenantId: string, sellerUserId: string, idemKey: string, dto: CreatePickupSlotDto, ip: string | null) {
    return this.idem.remember(idemKey, sellerUserId, 'logistics.pickup_slot_create', () =>
      timed(this.metrics, 'logistics.pickup_slot_create', { tenant: tenantId }, async () => {
        const slot = PickupSlot.create({ id: uuidv7(), tenantId, sellerUserId, weekday: dto.weekday, startTime: dto.startTime, endTime: dto.endTime });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, slot);
          const p = slot.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: sellerUserId, action: 'logistics.pickup_slot_created', entityType: 'pickup_slot', entityId: p.id, newValue: { weekday: p.weekday, startTime: p.startTime, endTime: p.endTime }, ip });
          await this.flush(tx, tenantId, p.id, slot.pullEvents());
          return this.serialize(p);
        }, { userId: sellerUserId });
      }));
  }

  async update(tenantId: string, sellerUserId: string, id: string, dto: UpdatePickupSlotDto, ip: string | null) {
    return timed(this.metrics, 'logistics.pickup_slot_update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const slot = await this.repo.getForUpdate(tx, tenantId, sellerUserId, id);
        if (!slot) throw new PickupSlotNotFoundError(id);
        const diff = slot.update({ weekday: dto.weekday, startTime: dto.startTime, endTime: dto.endTime });
        await this.repo.update(tx, slot);
        await this.audit.write(tx, { tenantId, actorUserId: sellerUserId, action: 'logistics.pickup_slot_updated', entityType: 'pickup_slot', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(slot.toProps());
      }, { userId: sellerUserId }));
  }

  async setActive(tenantId: string, sellerUserId: string, id: string, isActive: boolean, ip: string | null) {
    return timed(this.metrics, 'logistics.pickup_slot_set_active', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const slot = await this.repo.getForUpdate(tx, tenantId, sellerUserId, id);
        if (!slot) throw new PickupSlotNotFoundError(id);
        const diff = slot.setActive(isActive);
        await this.repo.update(tx, slot);
        await this.audit.write(tx, { tenantId, actorUserId: sellerUserId, action: `logistics.pickup_slot_${diff.action}`, entityType: 'pickup_slot', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(slot.toProps());
      }, { userId: sellerUserId }));
  }

  async getById(tenantId: string, sellerUserId: string, id: string) {
    const slot = await this.repo.getById(tenantId, sellerUserId, id);
    if (!slot) throw new PickupSlotNotFoundError(id);
    return this.serialize(slot.toProps());
  }

  async list(tenantId: string, sellerUserId: string, q: Omit<QueryPickupSlotDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.list(tenantId, { sellerUserId, weekday: q.weekday, activeOnly: q.activeOnly, cursor: q.cursor, limit: q.limit });
    const items = rows.map((s) => this.serialize(s.toProps()));
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last ? encodeFleetCursor(last.createdUs, last.id) : null;
    return { items, nextCursor };
  }

  private serialize(p: ReturnType<PickupSlot['toProps']>) {
    return { id: p.id, weekday: p.weekday, startTime: p.startTime, endTime: p.endTime, isActive: p.isActive, createdAt: p.createdAt ?? null };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'pickup_slot', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
