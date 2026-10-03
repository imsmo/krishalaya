// modules/partner-api/events/handlers/partner-webhook-fanout.handler.ts · PC-55 A10.
// On a relayed outbox event of an allow-listed type, enqueue ONE signed delivery per partner endpoint that both
// subscribes to that event AND owns the aggregate it concerns — IN THE RELAY'S TRANSACTION, so the enqueue commits
// atomically with marking the event published (no lost deliveries, no double fan-out). One instance is registered per
// PARTNER_WEBHOOK_EVENT_TYPE, mirroring the tenant WebhookFanoutHandler this deliberately sits beside.
//
// THE ORDER OF THE TWO QUESTIONS IS THE WHOLE SAFETY ARGUMENT:
//   1. WHO OWNS THIS? — resolved from the aggregate's own row (repo.resolveOwnerPartner), never from the event
//      payload. A payload field could be missing, stale, or wrong; a foreign key cannot.
//   2. DOES THAT PARTNER WANT IT? — only then are that ONE partner's endpoints loaded. We never enumerate all
//      partners' endpoints and filter, because a filter is something a future edit can weaken; a scoped query is not.
//   Ownership unresolvable ⇒ nothing is sent. Silence is the correct failure here: an unsent notification is a
//   support ticket, a misrouted one is a breach of a farmer's confidence.
//
// The HTTP POST itself is the existing worker's job (apps/worker webhook-delivery.job): same HMAC signature contract
// (`Krishalaya-Signature: t=…,v1=…`, with `X-KV-Signature` carrying the identical value for 0090-era receivers), same secret at rest,
// the same ladder (TENANT-13a). A partner endpoint is not paused by the worker on exhaustion (kv_relay holds no UPDATE on
// partner_webhook_endpoints — partner onboarding is a human-run step); the delivery is marked exhausted. Deliveries carry the
// ORIGINATING tenant_id so the platform can always answer "which of my events went to which partner?".
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { WebhookRepository } from '../../../tenant-webhooks/repositories/webhook.repository';
import { PartnerApiRepository } from '../../repositories/partner-api.repository';
import { deliverable, ownershipKindFor } from '../../domain/partner-webhook.rules';

export class PartnerWebhookFanoutHandler implements OutboxHandler {
  constructor(
    public readonly eventType: string,
    private readonly partners: PartnerApiRepository,
    private readonly webhooks: WebhookRepository,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const kind = ownershipKindFor(event.eventType);
    if (!kind) return;                       // not partner-shareable (defence: the registry already filtered)
    if (!event.aggregateId) return;          // nothing to prove ownership against ⇒ send nothing
    if (!event.tenantId) return;             // webhook_deliveries.tenant_id is NOT NULL: a platform-global event has
                                             // no originating tenant to disclose, so it is not deliverable at all

    const ownerPartnerId = await this.partners.resolveOwnerPartner(tx, kind, event.aggregateId);
    if (!ownerPartnerId) return;             // unresolvable ownership ⇒ silence, never a broadcast

    const endpoints = await this.partners.activeEndpointsForPartner(tx, ownerPartnerId);
    for (const endpoint of endpoints) {
      if (!deliverable(endpoint, event.eventType, ownerPartnerId)) continue;
      // PC-56 TENANT-13a (F-19): the delivery is marked as a PARTNER delivery. It still carries the originating tenant_id (the
      // platform must be able to answer "which of my events went to which partner?"), and the tenant realm's RLS admits only
      // endpoint_kind = 'tenant' rows — so a cooperative never reads what its bank or insurer was sent.
      await this.webhooks.enqueue(tx, {
        tenantId: event.tenantId, endpointId: endpoint.id, kind: 'partner', eventType: event.eventType, state: 'pending', internalType: event.eventType, sourceEventId: event.id,
        payload: { id: event.id, type: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, partnerId: ownerPartnerId, data: event.payload },
      });
    }
  }
}
