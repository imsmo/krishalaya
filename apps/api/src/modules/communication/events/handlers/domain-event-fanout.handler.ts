// modules/communication/events/handlers/domain-event-fanout.handler.ts · ONE consumer per mapped outbox event
// type (the registry keys handlers by a single eventType). Runs inside the relay's per-event tx with the tenant
// context already set, so notifications are recorded + dispatched atomically with marking the event published.
// IDEMPOTENT: NotificationService derives a deterministic notification id from the outbox event id, so a relay
// re-delivery never double-records or double-sends. Money-free.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { NotificationService } from '../../services/notification.service';
import { NotificationMapEntry } from '../notification-event-map';

export class DomainEventFanoutHandler implements OutboxHandler {
  readonly eventType: string;
  constructor(private readonly entry: NotificationMapEntry, private readonly service: NotificationService) {
    this.eventType = entry.outboxType;
  }
  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    // PC-56 STORE-4c · B2: a row scoped to one kind of payload (the ORDER payment) stays silent for the others — when the key is present
    const only = this.entry.onlyWhen;
    if (only) { const v = event.payload[only.key]; if (typeof v === 'string' && !only.values.includes(v)) return; }
    const recipients: string[] = [];
    for (const key of this.entry.recipientKeys) {
      const v = event.payload[key];
      if (typeof v === 'string' && v) recipients.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x) recipients.push(x);   // fan-out events (e.g. chat) carry a recipient array
    }
    if (recipients.length === 0) return;   // nothing to notify (fail-closed: never invent a recipient)
    const languageCode = typeof event.payload.languageCode === 'string' ? (event.payload.languageCode as string) : undefined;
    await this.service.fanout(tx, { tenantId: event.tenantId, eventCode: this.entry.eventCode, recipients, payload: event.payload, dedupeKey: event.id, languageCode });
  }
}
