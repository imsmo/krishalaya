// apps/web-storefront/src/features/store6/paths.ts · PC-56 STORE-6a · C3 — where the three policy pages live under each chrome. PURE.
// /offline (W313, also the worker's fallback), /queued (W314), /app (W319) on the platform; /<slug>/offline, /<slug>/queued, /<slug>/app under
// an organisation (on its own host the middleware maps the host-root paths there — brand-theme.ts `hostRewritePath`). The offline form chain
// (W3127–W3130, DECOR) is ONE route with a state: `/offline?form=error|review|success|failure`.
import type { AccountChrome } from '../store4a/account';

export type Store6Page = 'offline' | 'queued' | 'app';
export type OfflineFormState = 'error' | 'review' | 'success' | 'failure';
export const OFFLINE_FORM_STATES: readonly OfflineFormState[] = Object.freeze(['error', 'review', 'success', 'failure'] as OfflineFormState[]);

export function store6Href(c: AccountChrome, page: Store6Page, form?: OfflineFormState): string {
  const base = c.kind === 'tenant' ? `/${c.slug}/${page}` : `/${page}`;
  return form ? `${base}?form=${form}` : base;
}
/** The store's home (or the platform's) — "Try again" when the page itself was asked for. */
export function homeHref(c: AccountChrome): string { return c.kind === 'tenant' ? `/${c.slug}` : '/'; }
/** The chain state named in the query, or null (anything else is the policy page itself). */
export function offlineFormState(raw: string | string[] | undefined): OfflineFormState | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OFFLINE_FORM_STATES as readonly string[]).includes(String(v ?? '')) ? (v as OfflineFormState) : null;
}
