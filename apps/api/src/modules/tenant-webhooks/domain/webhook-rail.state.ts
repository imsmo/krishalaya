// webhook-rail.state.ts · THE DELIVERY CONTRACT AND THE TWO STATE MACHINES — PC-56 TENANT-13a (§B, adjudicated platform defaults).
// Byte-identical in apps/api/src/modules/tenant-webhooks/domain/webhook-rail.state.ts and apps/worker/src/jobs/webhook/
// webhook-rail.state.ts (parity spec). The worker SENDS by these numbers and the console PRINTS these numbers (GET /webhooks returns
// `contract`), so the promise on W188 is the behaviour, by construction rather than by copy-editing (Law 5: transitions live here).
//
// THE CONTRACT
//   • the first attempt goes as soon as the worker sees the delivery; then the canon's ladder 1m · 5m · 30m · 2h · 12h — five
//     retries, six attempts in a cycle;
//   • 2xx = delivered; anything else (another status, a timeout, a refused redirect, a reset) = failed and retried;
//   • after the sixth failure the delivery is `exhausted` and the ENDPOINT is paused (`paused_reason = exhausted`); its other
//     queued deliveries become `held`, and the developer contact is told through the communication outbox;
//   • a paused or disabled endpoint still RECEIVES events — each is recorded as `held`, not sent; on resume every held and exhausted
//     delivery is re-queued in creation order and signed afresh at send time;
//   • a send-time guard refusal (the host now resolves to a private address) DISABLES the endpoint (`paused_reason =
//     unsafe_target`) instead of retrying — nothing is sent, the delivery is held, resume re-runs the guard;
//   • every attempt is its own append-only row; deliveries and attempts are kept 90 days;
//   • a send has 10 s and reads at most 64 KiB of the response; the rotated-out secret keeps signing for 24 h.

export const RETRY_LADDER_SECONDS = [60, 300, 1800, 7200, 43200] as const;
export const RETRY_LADDER_LABELS = ['1m', '5m', '30m', '2h', '12h'] as const;
/** Attempts in one cycle: the first plus one per ladder step. */
export const MAX_ATTEMPTS = 1 + RETRY_LADDER_SECONDS.length;
export const ROTATION_OVERLAP_HOURS = 24;
export const RETENTION_DAYS = 90;
export const SEND_TIMEOUT_MS = 10_000;
export const RESPONSE_BODY_CAP_BYTES = 64 * 1024;
export const PAYLOAD_VERSION = 1;

export const DELIVERY_STATES = ['pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export const ENDPOINT_STATUSES = ['active', 'paused', 'disabled'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];
export const PAUSE_REASONS = ['exhausted', 'manual', 'unsafe_target'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** 2xx and nothing else. */
export function isDelivered(statusCode: number | null): boolean {
  return typeof statusCode === 'number' && statusCode >= 200 && statusCode <= 299;
}

/**
 * What happens after a FAILED attempt, given how many attempts of this cycle have now failed (1 … MAX_ATTEMPTS).
 * failures 1..5 → retry after ladder[failures-1]; failures ≥ 6 → exhaust (and pause a tenant endpoint).
 */
export type AfterFailure =
  | { action: 'retry'; step: number; delaySec: number; label: (typeof RETRY_LADDER_LABELS)[number] }
  | { action: 'exhaust' };
export function afterFailure(failuresInCycle: number): AfterFailure {
  const i = Math.trunc(failuresInCycle) - 1;
  if (i < 0) throw new Error(`afterFailure: ${failuresInCycle} is not a failure count`);
  if (i >= RETRY_LADDER_SECONDS.length) return { action: 'exhaust' };
  return { action: 'retry', step: i + 1, delaySec: RETRY_LADDER_SECONDS[i], label: RETRY_LADDER_LABELS[i] };
}

/** The ladder step a retrying delivery is waiting on (retry_step 1..5), named for the console's "Next retry" column. */
export function ladderLabel(retryStep: number): (typeof RETRY_LADDER_LABELS)[number] | null {
  return retryStep >= 1 && retryStep <= RETRY_LADDER_LABELS.length ? RETRY_LADDER_LABELS[retryStep - 1] : null;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* THE DELIVERY MACHINE                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */
//   pending   → delivered | retrying | exhausted | held | cancelled
//   retrying  → delivered | retrying | exhausted | held | cancelled | pending (replay)
//   held      → pending (resume) | cancelled (endpoint deleted)
//   exhausted → pending (resume / replay) | cancelled
//   delivered → pending (replay — the original payload, a fresh signature)
//   cancelled → (final)
const DELIVERY_NEXT: Readonly<Record<DeliveryState, readonly DeliveryState[]>> = {
  pending: ['delivered', 'retrying', 'exhausted', 'held', 'cancelled'],
  retrying: ['delivered', 'retrying', 'exhausted', 'held', 'cancelled', 'pending'],
  held: ['pending', 'cancelled'],
  exhausted: ['pending', 'cancelled'],
  delivered: ['pending'],
  cancelled: [],
};
export function canDeliveryMove(from: DeliveryState, to: DeliveryState): boolean {
  return (DELIVERY_NEXT[from] ?? []).includes(to);
}
/** States the worker sends from. */
export const DUE_STATES: readonly DeliveryState[] = ['pending', 'retrying'];
/** States the console calls "failed" (the last attempt was not 2xx). */
export const FAILED_STATES: readonly DeliveryState[] = ['retrying', 'exhausted'];
/** States a person may replay one by one (original payload, fresh signature). */
export const REPLAYABLE_STATES: readonly DeliveryState[] = ['retrying', 'exhausted', 'delivered'];
/** States a resume re-queues. */
export const RESUMABLE_STATES: readonly DeliveryState[] = ['held', 'exhausted'];

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* THE ENDPOINT MACHINE                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */
//   active   → paused (manual | exhausted) | disabled (unsafe_target)
//   paused   → active (resume)
//   disabled → active (resume, only when the guard passes again)
export function canEndpointMove(from: EndpointStatus, to: EndpointStatus, reason: PauseReason | null): boolean {
  if (from === 'active' && to === 'paused') return reason === 'manual' || reason === 'exhausted';
  if (from === 'active' && to === 'disabled') return reason === 'unsafe_target';
  if ((from === 'paused' || from === 'disabled') && to === 'active') return reason === null;
  return false;
}
/** A new event for an endpoint in this status is queued (`pending`) or recorded and held (`held`). */
export function initialDeliveryState(endpointStatus: EndpointStatus): 'pending' | 'held' {
  return endpointStatus === 'active' ? 'pending' : 'held';
}
