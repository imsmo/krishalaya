// apps/mobile/src/core/api/write-classify.ts · the ONE place an offline-first write decides "is this a real
// connectivity problem, or a real answer from the server?" Every offline-first mutation (listing.create,
// media.upload, …) should classify through here instead of re-deriving its own HTTP-status heuristic — that
// duplication is exactly how KV-MF-02 happened: apps/mobile/src/features/listings/listings.api.ts computed
// `(e as { status?: number }).status ?? 0` and treated status 0 (the default for ANY error without a `.status`
// property — which includes every non-SdkError exception, not just true network errors) as "queue it, offline".
// A founder saw "Saved. It will publish when you're back online" while FULLY ONLINE because a real failure (a
// 4xx/5xx SdkError, or an unrelated post-success throw) fell through that same catch-all. The fix is narrow and
// literal: only `SdkNetworkError` (and its subclass `SdkTimeoutError`) means "the request never reached the
// API" — that is the ONLY condition that should ever be silently queued instead of surfaced to the farmer.
import { SdkNetworkError } from '@krishalaya/sdk-js';

/** True only for a genuine connectivity failure (the request never reached the API / timed out waiting for a
 * response). Anything else — a real SdkError of ANY status (2xx never throws; so this means 3xx/4xx/5xx), or an
 * unrelated unexpected exception — is NOT a connectivity failure and must be surfaced, never silently queued. */
export function isConnectivityFailure(e: unknown): boolean {
  return e instanceof SdkNetworkError;
}

/** Maps a replay failure to an OfflineQueue `ReplayResult`. Only a true connectivity failure is 'retry' — every
 * other failure (validation, permission, a real 5xx, an unexpected bug) will fail IDENTICALLY on every future
 * attempt (it is a poison op), so it must dead-letter immediately rather than being hammered at the API up to
 * the queue's attempt cap while the farmer keeps seeing failure toasts (KV-MF-02 bug 2). */
export function classifyReplayFailure(e: unknown): 'retry' | 'permanent-fail' {
  return isConnectivityFailure(e) ? 'retry' : 'permanent-fail';
}
