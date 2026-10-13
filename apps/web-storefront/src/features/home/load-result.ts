// apps/web-storefront/src/features/home/load-result.ts · PC-56 STORE-1b (survey F-7) — ERROR IS NOT EMPTY. PURE (no React, no IO).
//
// Both homes used to `catch { items = [] }`: an API outage rendered "no listings yet" — a lie a buyer cannot tell from the truth, and the
// nine canon Retry pages (W3055–W3057, W2463–W2465, W3071–W3073) hung off an error state that did not exist. Every read on these pages now
// goes through `loadResult`, which keeps the three outcomes apart: the data (possibly an empty list), NOT FOUND (a real 404 — an unknown,
// non-live or trial organisation), and UNAVAILABLE (anything else: timeout, 5xx, network). A page then renders EMPTY only for a real,
// successful, empty answer.
import { gapRetryHref, gapRetryIsMutation } from '../mutate/chain';

export type LoadResult<T> = { ok: true; data: T } | { ok: false; kind: 'not_found' | 'unavailable' };

/** Run one read; a thrown 404 is `not_found`, every other failure is `unavailable` (never swallowed into an empty answer). */
export async function loadResult<T>(read: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (e) {
    const status = Number((e as { status?: unknown } | null)?.status ?? 0);
    return { ok: false, kind: status === 404 ? 'not_found' : 'unavailable' };
  }
}

export type ListState = 'ok' | 'empty' | 'error';
/** What a list region shows: its rows, the EMPTY sentence (a successful empty answer only), or the ERROR sentence + Retry. */
export function listState<T>(r: LoadResult<{ items: ReadonlyArray<T> }>): ListState {
  if (!r.ok) return 'error';
  return r.data.items.length === 0 ? 'empty' : 'ok';
}

type RawParams = Record<string, string | string[] | undefined>;
/**
 * "Retry" on the two homes' error states = RELOAD THE SAME URL (path + the same query string). It is a read — the web-tenant ruling
 * (`gapRetryHref` / `gapRetryIsMutation() === false`, features/mutate/chain.ts) applies: reloading a screen is neither destructive nor
 * state-changing, so no confirm step wraps it (the canon's W3055 / W2463 / W3071 confirm pages are recorded as a DELTA, not built).
 */
export function reloadHref(path: string, sp: RawParams = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) { for (const x of v) usp.append(k, x); } else if (typeof v === 'string') usp.append(k, v);
  }
  const qs = usp.toString();
  return gapRetryHref(`${path}${qs ? `?${qs}` : ''}`);
}
/** The Retry is never a mutation (re-exported so the render test can assert the rule it relies on). */
export const retryIsMutation = gapRetryIsMutation;

/** "N published": exact up to the API's cap, "cap+" above it; null when the API did not say (a filter was active, or the read failed). */
export function publishedCount(total: number | null | undefined, cap: number | null | undefined): { n: number; capped: boolean } | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null;
  const c = typeof cap === 'number' && cap > 0 ? cap : null;
  if (c !== null && total > c) return { n: c, capped: true };
  return { n: total, capped: false };
}

/** "Some lots are members-only" is a claim about THIS store: said only when the API counted at least one such lot. */
export function showsMembersOnly(count: number | null | undefined): boolean {
  return typeof count === 'number' && count > 0;
}
