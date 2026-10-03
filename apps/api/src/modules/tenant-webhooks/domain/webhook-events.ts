// modules/tenant-webhooks/domain/webhook-events.ts · the public event names a webhook endpoint may subscribe to. PC-56 TENANT-13a (F-1):
// DERIVED from the catalogue (webhook-catalog.ts), which maps each public name to the internal outbox type(s) that really fire it —
// the old hand-typed list named nine events nothing emitted. Kept as a module so existing imports keep their meaning.
import { WEBHOOK_EVENT_NAMES, isKnownWebhookEvent as known } from './webhook-catalog';

export const WEBHOOK_EVENT_TYPES: readonly string[] = WEBHOOK_EVENT_NAMES;
export type WebhookEventType = string;

export function isKnownWebhookEvent(code: string): boolean {
  return known(code);
}
