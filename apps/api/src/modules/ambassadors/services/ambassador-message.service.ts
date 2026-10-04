// modules/ambassadors/services/ambassador-message.service.ts · PC-56 TENANT-SW-b · A2 — W160 "Message (Gujarati)", BUILT (small, real).
//
// A per-person message from the member desk to ONE ambassador, through the communication spine — never a side channel. The act
// writes, in one kv_app transaction: the outbox event `ambassadors.message` (mapped to the catalogued notification `ambassador.message`,
// push + in-app, templates en / hi / gu in seed core/0007 — the wrapper is in the ambassador's own language, the desk's words are
// delivered verbatim) and the audit row `ambassador.messaged` (actor · reason · the message). The relay fans it out as kv_relay
// (HOTFIX-2 gate: the `* → DomainEventFanoutHandler` case covers the new mapping). ambassador.manage at the controller; idempotent.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AMBASSADOR_MESSAGE_EVENT } from '../domain/ambassadors.events';
import { AmbassadorMessageInvalidError, AmbassadorNotFoundError, AmbassadorsForbiddenError } from '../domain/ambassadors.errors';
import { requireReason } from './ambassador-earning.service';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';

export const MIN_MESSAGE = 3;
export const MAX_MESSAGE = 500;

@Injectable()
export class AmbassadorMessageService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  async send(tenantId: string, actor: { userId: string }, ambassadorId: string, input: { message: string; reason: string }, idemKey: string, ip: string | null) {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a message is sent by a named person');
    const message = (input.message ?? '').trim();
    if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) throw new AmbassadorMessageInvalidError();
    const reason = requireReason(input.reason, 'message an ambassador');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.message', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.profiles.getById(tenantId, ambassadorId, tx);
        if (!p) throw new AmbassadorNotFoundError(ambassadorId);
        const userId = p.userId;
        await this.outbox.write(tx, { tenantId, aggregateType: 'ambassador_profile', aggregateId: ambassadorId, eventType: AMBASSADOR_MESSAGE_EVENT,
          payload: { v: 1, ambassadorId, recipientUserIds: [userId], message, sentBy: actor.userId } });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.messaged', entityType: 'ambassador_profile', entityId: ambassadorId, reason, ip,
          oldValue: null, newValue: { message, recipientUserId: userId, channel: 'notification:ambassador.message' } });
        return { ambassadorId, queued: true };
      }, { userId: actor.userId }));
  }
}
