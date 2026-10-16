// modules/communication/events/handlers/dispute-resolved-lock.handler.ts · PC-56 STORE-4b · D2d — A DISPUTE DECISION LOCKS THE TRADE'S THREAD.
// Consumes `disputes.dispute_resolved` (emitted by disputes' `Dispute.resolve` for BOTH outcomes — `resolved` and `rejected` — with the payload
// keys `disputeId` and `orderId`, plus resolutionType / resolutionAmountMinor / raisedBy / againstUser, which this handler does not read).
// Runs INSIDE the relay's per-event transaction (as `kv_relay` in production: table-level SELECT/UPDATE on `conversations`, INSERT on
// `outbox_events` and `audit_log` — no grant was added). Every live conversation of this tenant with context (`order`, orderId) or (`dispute`,
// disputeId) is locked with kind `dispute` (canon W297/W298 "Resolved threads lock — readable forever, editable never"), so the owner can
// no longer lift it (only a moderator can). IDEMPOTENT: a thread already locked `dispute` is a no-op — no write, no event, no audit; an `owner`
// or `moderator` lock is raised to `dispute` (the stronger kind). Finding (named): no code opens a `dispute`-context thread today, so the ORDER
// thread (STORE-4b's buyer → organisation thread) is the one that locks.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { ConversationRepository } from '../../repositories/conversation.repository';

export const DISPUTE_RESOLVED_EVENT = 'disputes.dispute_resolved';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DisputeResolvedLockHandler implements OutboxHandler {
  readonly eventType = DISPUTE_RESOLVED_EVENT;
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    if (!tenantId) return;                                                   // malformed — fail closed
    const orderId = typeof event.payload.orderId === 'string' && UUID.test(event.payload.orderId) ? event.payload.orderId : null;
    const disputeId = typeof event.payload.disputeId === 'string' && UUID.test(event.payload.disputeId) ? event.payload.disputeId : null;
    const targets = [
      ...(orderId ? await this.conversations.lockableByContext(tx, tenantId, 'order', orderId) : []),
      ...(disputeId ? await this.conversations.lockableByContext(tx, tenantId, 'dispute', disputeId) : []),
    ];
    for (const convo of targets) {
      const was = convo.lockKind;
      if (!convo.lock('dispute')) continue;                                  // already locked `dispute` → no-op, no event
      await this.conversations.update(tx, convo);
      for (const e of convo.pullEvents()) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'conversation', aggregateId: convo.id, eventType: e.type, payload: { v: 1, ...e.payload, disputeId, orderId } });
      }
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'conversation.locked', entityType: 'conversation', entityId: convo.id,
        oldValue: { lockKind: was }, newValue: { lockKind: 'dispute', disputeId, orderId }, reason: 'dispute_resolved' });
    }
  }
}
