// core/bulk/domain/bulk-import.events.ts · integration events (via outbox) + shared vocab.
export const BulkImportEventType = {
  Created:   'bulk.import_created',
  Completed: 'bulk.import_completed',   // payload carries succeeded/failed counts + final status
} as const;
export type BulkImportEventType = (typeof BulkImportEventType)[keyof typeof BulkImportEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };

// bulk_import_jobs.status enum (db/migrations/0030).
export const BULK_STATUSES = ['pending', 'validating', 'validated', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled'] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];
