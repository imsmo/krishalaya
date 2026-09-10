// core/exports-plane/domain/export-plane.events.ts · the plane's outbox event types (Law 4: written in the same
// transaction as the state they describe).
export const ExportEventType = Object.freeze({
  /** A job was enqueued. Carries the dataset and the requester; consumed by nothing yet, emitted so the queue has a trail. */
  Queued: 'exports.export_queued',
  /**
   * The file exists. `NOTIFICATION_EVENT_MAP` bridges this to the catalogued `exports.export_ready` (0169.4) with the
   * requester as the recipient — `userId` is IN the payload rather than assumed, ADMIN-6b's lesson: a map row over a
   * payload with no recipient looks like a fix and sends nothing. `dataset` is a per-language map (seed 0017) so the
   * Gujarati notice does not carry the platform code; `rows` and `file` are the receipt's own values.
   */
  Ready: 'exports.export_ready',
  /** A reason code, never a stack trace. Not catalogued as a notification — the ready page says it. */
  Failed: 'exports.export_failed',
  Expired: 'exports.export_expired',
});
export type ExportEventTypeValue = (typeof ExportEventType)[keyof typeof ExportEventType];

export interface ExportDomainEvent { type: ExportEventTypeValue; payload: Record<string, unknown> }
