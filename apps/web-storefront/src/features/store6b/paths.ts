// apps/web-storefront/src/features/store6b/paths.ts · PC-56 STORE-6b · C1 — where "On this phone" (W315, rebuilt) and its discard chain
// (W3151–W3153, a REAL device act) live, and the install page's outcome states (W3137–W3140). PURE.
//   /sync                      the list (platform: every store on this host; a store: its own drafts only) — `/<slug>/sync` under an organisation
//   /sync?discard=<id>         W3151 "Discard this draft? Nothing on the server changes" (Proceed = a client act; Cancel → the list)
//   /sync?done=discarded       W3152 "Discarded from this phone"
//   /sync?done=failed&discard=<id>   W3153 "This phone's storage could not be written — the draft is kept" (Retry → the confirm again)
//   /app?install=success|failure|error   W3139 / W3140 / W3137 (the sheet's outcomes, printed on the install page)
import type { AccountChrome } from '../store4a/account';
import { isDraftId } from './drafts';
import type { InstallPageState } from './install';

export type SyncState = { kind: 'list' } | { kind: 'confirm'; id: string } | { kind: 'discarded' } | { kind: 'failed'; id: string };

const base = (c: AccountChrome) => (c.kind === 'tenant' ? `/${c.slug}/sync` : '/sync');

export function syncHref(c: AccountChrome, s: SyncState = { kind: 'list' }): string {
  const b = base(c);
  if (s.kind === 'confirm') return `${b}?discard=${encodeURIComponent(s.id)}`;
  if (s.kind === 'discarded') return `${b}?done=discarded`;
  if (s.kind === 'failed') return `${b}?done=failed&discard=${encodeURIComponent(s.id)}`;
  return b;
}

/** The chain state named in the query (a malformed id is the plain list — never an error page). */
export function readSyncState(sp: Record<string, string | string[] | undefined>): SyncState {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const done = one(sp.done); const id = one(sp.discard);
  if (done === 'discarded') return { kind: 'discarded' };
  if (done === 'failed' && isDraftId(id)) return { kind: 'failed', id };
  if (isDraftId(id)) return { kind: 'confirm', id };
  return { kind: 'list' };
}

export function appHref(c: AccountChrome, state?: InstallPageState): string {
  const b = c.kind === 'tenant' ? `/${c.slug}/app` : '/app';
  return state ? `${b}?install=${state}` : b;
}
