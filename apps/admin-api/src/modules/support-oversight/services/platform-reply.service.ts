// apps/admin-api/src/modules/support-oversight/services/platform-reply.service.ts · ENQUEUES a platform reply to a
// farmer (PC-56 ADMIN-2d, closes ADMIN-2-Q3's reply half).
//
// THIS SERVICE DELIBERATELY DOES NOT SEND ANYTHING. It writes a `queued` row in `support_platform_replies` (0101) with
// its audit row in the same transaction, and returns. The delivery happens in apps/api's
// `PlatformReplyDeliveryCadenceJob`, which is where the notification spine lives.
//
// THAT SPLIT IS THE POINT OF THE WAVE. ADMIN-2b refused to build a reply here at all, and its docblock said why: writing
// a message row from this realm would leave the ticket looking answered to everybody except the person waiting for it.
// The split keeps that true while making the reply possible — this realm records the INTENT, the other realm reports
// what actually happened, and the console shows the difference rather than assuming success.
//
// TWO CONSEQUENCES AN OPERATOR CAN SEE:
//   • THE RESPONSE SAYS "queued", NOT "sent". Every surface downstream repeats that. A reply is `delivered` only once
//     the spine has written per-recipient notifications, and the console shows `queued` / `delivered` / `refused` /
//     `failed` with the reason. This is the same law ADMIN-1e applied to scheduled reports and ADMIN-2b to escalation
//     steps: never claim a delivery the platform cannot perform.
//   • THE TENANT'S DESK CAN READ IT. 0101 grants the tenant API SELECT on this table. The platform talking to a tenant's
//     farmer behind that tenant's back would be a trust incident whatever the message said, so this is not a leak — it
//     is the design.
//
// The reply is NOT a conversation message. See 0101's header: `conversation_participants.user_id` references a tenant
// `users` row and a platform operator has none, so a message would require inventing a platform account inside every
// tenant's user table. The reply travels the notification spine attributed to the platform, which is who is speaking.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { TicketNotFoundError, InvalidPlatformReplyError } from '../domain/support-oversight.errors';
import { assertReply, REPLY_STATUSES, describeReplyState, type ReplyRow } from '../domain/platform-reply';
import type { ReplyToFarmerDto } from '../dto/support-oversight.dto';

@Injectable()
export class PlatformReplyService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: SupportOversightRepository,
  ) {}

  /**
   * Queue a reply. One transaction: the row and its audit entry land together (Law 4), because a message sent to a
   * person about their money must never exist without a record of who authorised it.
   *
   * The ticket is checked first so an operator gets a 404 they can read rather than a foreign-key 500.
   */
  async queue(actor: AdminRequestContext, ticketId: string, dto: ReplyToFarmerDto) {
    const ticket = await this.repo.getTicket(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);
    // A ticket with no tenant cannot be replied to through this rail: 0101's tenant_id is NOT NULL, and the notification
    // spine's own writes are RLS-scoped. This is a real state for a platform-level ticket, so it is refused with a
    // sentence rather than allowed to fail as a constraint violation.
    // Narrowed into a const: TypeScript will not carry a property narrowing across the closure below, and asserting
    // non-null there would be the assertion outliving the check.
    const tenantId = ticket.tenantId;
    if (!tenantId) {
      throw new InvalidPlatformReplyError('this ticket has no tenant, so there is no farmer-facing notification rail to send on');
    }
    const ticketNo = String((ticket.toJSON() as { ticketNo?: string }).ticketNo ?? ticketId);

    const reply = assertReply({ body: dto.body, languageCode: dto.languageCode });

    // A deterministic key per (ticket, author, body) would dedupe an accidental double-submit — but it would also
    // silently swallow a DELIBERATE second reply saying the same short thing ("Refund issued today."), which is a real
    // thing an operator does on a long ticket. So the key is random per request and the CONSOLE guards the double-click;
    // 0101's unique index then exists to make the executor's retries safe rather than to police the operator.
    const idempotencyKey = `platform-reply:${randomUUID()}`;

    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertPlatformReply(client, {
        tenantId,
        ticketId,
        authorAdminId: actor.userId,
        body: reply.body,
        languageCode: reply.languageCode,
        idempotencyKey,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.platform_reply_queued', entityType: 'support_platform_reply', entityId: created.id,
        oldValue: null,
        newValue: {
          ticketId, tenantId, languageCode: reply.languageCode,
          // the words themselves go in the audit record: this is a message to a person about their money, and "a reply
          // was sent" without its content is not an auditable fact
          body: reply.body,
          status: 'queued',
        },
        reason: `platform reply to ${ticketNo}`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id: created.id,
        // NOT "sent". The word matters: nothing has reached anybody yet.
        status: 'queued' as const,
        queuedNote: 'Recorded. Delivery is attempted within a minute by the tenant realm, which owns the notification fan-out — this endpoint has not contacted anybody. Watch the status on the ticket.',
      };
    });
  }

  /** Every platform reply on a ticket, with what actually happened to each. */
  async forTicket(ticketId: string) {
    const ticket = await this.repo.getTicket(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);
    const items = (await this.repo.platformRepliesFor(ticketId)) as unknown as ReplyRow[];
    return {
      items: items.map((r) => ({ ...r, stateNote: describeReplyState(r) })),
      statuses: REPLY_STATUSES,
      // said on the payload as well as the screen, because a consumer that only reads JSON must not conclude otherwise
      deliveryNote: 'A reply is "delivered" only once the notification spine has written per-recipient notifications. Until then it is queued and nobody has been contacted. SMS is registered but INACTIVE pending DLT ids, so delivery today means in-app and push.',
      // the tenant can read these rows (0101 grants their API SELECT) — stated so nobody writes something here in the
      // belief that the tenant will never see it
      visibleToTenant: true,
    };
  }

  /** Replies that are stuck — for the oversight console's own health view. A queue nobody watches is a queue. */
  async stuck() {
    const items = await this.repo.stuckPlatformReplies();
    return {
      items,
      note: items.length === 0
        ? null
        : 'These replies were written by an operator and have NOT reached the farmer. Each carries the reason.',
    };
  }
}
