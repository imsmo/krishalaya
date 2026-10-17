// apps/mobile/src/core/offline/scope.ts · the CURRENT cache scope = the signed-in user id (or 'anon'). The auth
// store sets it on sign-in and clears it on sign-out, so every cached read is namespaced to its owner and one
// account can never read another's cached data (anti-IDOR, guide §4). On sign-out we also wipe the old scope's
// cache. Module-level (mirrors how the API client reads the in-memory token getter).
// PC-56 HOTFIX-8 · D2: the scope also carries the session's ORGANISATION (the access token's `tid`) — the offline write queue stamps both
// on every op and replays only the signed-in owner's (core/offline/sync-queue.ts). The auth store now sets the scope from the token at
// sign-in and at boot restore (core/offline/owner.ts says why), as well as from the profile. Signing out resets both — the queue is NOT
// cleared (a farmer who signs out keeps their queued listing), it is simply held until its owner signs in again.
import { cache } from './sqlite.db';

let scope = 'anon';
let tenant: string | null = null;

export function currentScope(): string { return scope; }
/** HOTFIX-8: the session's organisation (null when unknown / signed out). */
export function currentTenant(): string | null { return tenant; }

/** Set the active cache scope (the user id) and, when known, the session's organisation. Idempotent. A different user without an
 *  organisation resets it (never another person's organisation carried over). */
export function setCacheScope(userId: string | undefined | null, tenantId?: string | null): void {
  const next = userId || 'anon';
  if (tenantId !== undefined) tenant = next === 'anon' ? null : tenantId;
  else if (next !== scope) tenant = null;
  scope = next;
}

/** Clear the cache for the current scope and reset to anonymous (call on sign-out). */
export async function clearCacheScope(): Promise<void> {
  const prev = scope;
  scope = 'anon';
  tenant = null;
  await cache.clearScope(prev);
}
