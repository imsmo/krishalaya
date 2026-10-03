// modules/tenant-webhooks/events/handlers/webhook-fanout.handler.ts · PC-56 TENANT-13a (F-1). On a relayed outbox event of an INTERNAL
// type the public catalogue maps (domain/webhook-catalog.ts), enqueue one delivery per live tenant endpoint subscribed to the PUBLIC
// name — IN THE RELAY'S TRANSACTION, so the enqueue commits atomically with marking the event published (never lost, never fanned twice
// by one relay pass).
//   • One instance per distinct internal type (the dispatcher keys handlers by the exact `outbox_events.event_type`).
//   • The body is the catalogue's envelope: `{ id, type: <public name>, payloadVersion, createdAt, data: <whitelist projection> }` —
//     never the raw outbox payload (which can carry a free-text reason, a bank fragment, an OTP).
//   • An endpoint that is paused or disabled still RECEIVES the event: the delivery is recorded `held` (not sent) and replays on resume
//     — "events are never lost" (W188). A deleted endpoint receives nothing.
//   • `endpoint_kind = 'tenant'` (F-19). The HTTP POST is the worker's job; this only durably records the intent.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { WebhookRepository } from '../../repositories/webhook.repository';
import { envelopeFor, publicNamesFor } from '../../domain/webhook-catalog';
import { initialDeliveryState } from '../../domain/webhook-rail.state';

export class WebhookFanoutHandler implements OutboxHandler {
  constructor(public readonly eventType: string, private readonly repo: WebhookRepository, private readonly now: () => Date = () => new Date()) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    if (!event.tenantId) return;                                  // a platform-global event belongs to no tenant's endpoints
    const names = publicNamesFor(event.eventType);
    if (names.length === 0) return;
    const createdAt = this.now().toISOString();
    for (const name of names) {
      const endpoints = await this.repo.endpointsForEvent(tx, event.tenantId, name);
      if (endpoints.length === 0) continue;
      const body = envelopeFor(name, { id: event.id, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload ?? {} }, createdAt);
      for (const ep of endpoints) {
        await this.repo.enqueue(tx, {
          tenantId: event.tenantId, endpointId: ep.id, kind: 'tenant', eventType: name, payload: body, state: initialDeliveryState(ep.status),
          payloadVersion: body.payloadVersion, internalType: event.eventType, sourceEventId: event.id,
        });
      }
    }
  }
}
