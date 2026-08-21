// modules/communication/services/broadcast.service.ts · tenant→audience broadcast (PRD §14).
// create(): a tenant admin (notification.manage) composes a message; we record it 'queued' and emit ONE outbox
// event (communication.broadcast_requested) — the actual per-recipient fan-out happens ASYNC in the handler via
// the notification spine (no synchronous blast; Law 4/8). Idempotent on the caller's key (Law 3). No money.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Broadcast } from '../domain/broadcast.entity';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import { CommForbiddenError } from '../domain/communication.errors';
import { CreateBroadcastDto } from '../dto/create-broadcast.dto';

export const BROADCAST_REQUESTED = 'communication.broadcast_requested';
export interface CommActor { userId: string; canManage: boolean; }

@Injectable()
export class BroadcastService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: BroadcastRepository,
  ) {}

  async create(tenantId: string, actor: CommActor, idemKey: string, dto: CreateBroadcastDto) {
    if (!actor.canManage) throw new CommForbiddenError('requires notification.manage');
    return this.idem.remember(idemKey, actor.userId, 'communication.broadcast.create', () =>
      timed(this.metrics, 'communication.broadcast.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const b = Broadcast.create({ id: uuidv7(), tenantId, createdByUserId: actor.userId, audienceRoleCode: dto.audienceRoleCode ?? null, title: dto.title, body: dto.body });
          await this.repo.insert(tx, b);
          // hand off to the async fan-out (the handler resolves recipients + dispatches via the notification spine)
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BROADCAST_REQUESTED, payload: { v: 1, broadcastId: b.id } });
          return b.toJSON();
        }, { userId: actor.userId })));
  }

  async list(tenantId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listForTenant(tenantId, q);
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
}
