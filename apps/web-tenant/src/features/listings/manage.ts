// apps/web-tenant/src/features/listings/manage.ts · PURE helpers for the owner listing-detail page. They mirror
// the API's listing state machine (db/migrations/0005 + listings/domain/listing.state.ts) so the console only
// OFFERS legal actions — but the API is always the authority and re-checks every transition (we reflect, never
// grant; an illegal/raced action degrades to a message). No framework, no I/O → unit-tested.

export const LISTING_STATUSES = [
  'draft', 'pending_approval', 'published', 'paused', 'sold_out', 'expired', 'rejected', 'hidden', 'archived',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

// Statuses from which the bare publish VERB is offered. pending_approval is deliberately ABSENT since
// PC-56 TENANT-2b: once a listing is in the QC queue a REVIEWER decides it — the server refuses the bare verb
// there (LISTING_IN_QC), so offering the button would be a door drawn on a wall.
const PUBLISHABLE_FROM: ReadonlySet<string> = new Set(['draft', 'paused', 'sold_out', 'expired', 'hidden']);

/** Can the owner attempt to publish from this status? (Server re-validates the transition.) */
export function canPublish(status: string | undefined | null): boolean {
  return !!status && PUBLISHABLE_FROM.has(status);
}

/** Can the owner attempt a price change? Allowed unless the listing is archived (terminal). */
export function canChangePrice(status: string | undefined | null): boolean {
  return status !== 'archived';
}

/** Draft → QC: the submit button (the waiting clock starts server-side). */
export function canSubmitQc(status: string | undefined | null): boolean {
  return status === 'draft';
}

/** The way back (TENANT-2b): rejected → draft (fix-and-relist) and pending_approval → draft (withdraw). */
export function canRedraft(status: string | undefined | null): boolean {
  return status === 'rejected' || status === 'pending_approval';
}

/** The seller's own hand on their own sale (published → paused). */
export function canPause(status: string | undefined | null): boolean {
  return status === 'published';
}

/** Archive is terminal and offered from any non-terminal status (the server's machine re-validates). */
export function canArchive(status: string | undefined | null): boolean {
  return !!status && status !== 'archived';
}

/** Map an SDK error code from changePrice to a UI reason key (optimistic-concurrency conflict vs generic). */
export function priceErrorKey(code: string | undefined): 'conflict' | 'failed' {
  const c = (code ?? '').toUpperCase();
  return c.includes('VERSION') || c.includes('CONFLICT') || c === '409' ? 'conflict' : 'failed';
}
