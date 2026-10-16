// modules/disputes/services/dispute-message.service.ts
// Threaded evidence on a dispute (append-only). The dedicated owner of the message use-cases — post +
// list — extracted from DisputeService (which now delegates here). Every post: one ACID tx (UoW),
// outbox event in the SAME tx (Law 4). Only a PARTY (raiser/respondent) or a MODERATOR may post/read,
// and only while the dispute is ACTIVE (no piling on a resolved case). A non-party gets 404 on the
// dispute (no enumeration). Bodies are validated by the DisputeMessage value object.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DisputeMessage } from '../domain/dispute-message.entity';
import { DisputeEventType } from '../domain/disputes.events';
import { isActive } from '../domain/dispute.state';
import { DisputeNotFoundError, DisputeForbiddenError, DisputeNotActiveError } from '../domain/disputes.errors';
import { Dispute } from '../domain/dispute.entity';
import { DisputeRepository } from '../repositories/dispute.repository';
import { DisputeMessageRepository } from '../repositories/dispute-message.repository';
import { CreateDisputeMessageDto } from '../dto/create-dispute-message.dto';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';

export interface MessageActor { userId: string; canModerate: boolean; }

@Injectable()
export class DisputeMessageService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly disputes: DisputeRepository,
    private readonly messages: DisputeMessageRepository,
  ) {}

  async post(tenantId: string, actor: MessageActor, disputeId: string, dto: CreateDisputeMessageDto) {
    return timed(this.metrics, 'disputes.message', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const dispute = await this.disputes.getForUpdate(tx, tenantId, disputeId);
        if (!dispute) throw new DisputeNotFoundError(disputeId);
        this.assertParty(dispute, actor);
        if (!isActive(dispute.status)) throw new DisputeNotActiveError(dispute.status);
        const msg = DisputeMessage.create({ id: uuidv7(), disputeId, tenantId, authorUserId: actor.userId, body: dto.body });
        await this.messages.insert(tx, msg);
        await this.outbox.write(tx, { tenantId, aggregateType: 'dispute', aggregateId: disputeId, eventType: DisputeEventType.MessagePosted, payload: { v: 1, disputeId, authorUserId: actor.userId } });
        return { id: msg.props.id, authorUserId: actor.userId, body: msg.props.body, createdAt: msg.props.createdAt };
      }, { userId: actor.userId }));
  }

  async list(tenantId: string, actor: MessageActor, disputeId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const dispute = await this.disputes.getById(tenantId, disputeId);
    if (!dispute) throw new DisputeNotFoundError(disputeId);
    this.assertParty(dispute, actor);
    const rows = await this.messages.listFor(tenantId, disputeId, q);
    const last = rows[rows.length - 1];
    // PC-56 HOTFIX-7 · B24: the µs keyset (the cursor carries the instant as the database printed it)
    const nextCursor = rows.length === q.limit && last?.createdAtUs ? encodeKeyset(last.createdAtUs, last.id) : null;
    const items = rows.map(({ createdAtUs, ...m }) => { void createdAtUs; return m; });
    return { items, nextCursor };
  }

  private isParty(d: Dispute, actor: MessageActor): boolean { return actor.canModerate || d.raisedBy === actor.userId || d.againstUser === actor.userId; }
  private assertParty(d: Dispute, actor: MessageActor): void { if (!this.isParty(d, actor)) throw new DisputeForbiddenError(); }
}
