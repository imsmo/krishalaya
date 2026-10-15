// apps/web-storefront/src/lib/store-door.ts · PC-56 STORE-2c · C1 (founder 2b D3 carried) — the platform's money routes are DOORS, not pages.
// Checkout, pay and confirm live under the organisation's own chrome (`/<slug>/checkout…`); the platform's /checkout, /checkout/pay and
// /checkout/confirm send a signed-in buyer to the store their session was minted for (`kv_tid` → `GET /v1/storefront/tenant` → its slug) —
// the /cart door's rule (STORE-2b). If that store cannot be read, the door says so with a Retry; it never guesses a store.
import 'server-only';
import { sessionTenantClient } from './api-client';

export async function sessionStoreSlug(): Promise<string | null> {
  try { return (await sessionTenantClient().storefront.tenant()).slug ?? null; } catch { return null; }
}

/** Carry a door's query along (strings only, bounded), dropping anything else. */
export function carryQuery(sp: Record<string, string | string[] | undefined>, keep: readonly string[]): string {
  const p = new URLSearchParams();
  for (const k of keep) { const v = sp[k]; const s = Array.isArray(v) ? v[0] : v; if (typeof s === 'string' && s !== '') p.set(k, s.slice(0, 120)); }
  const q = p.toString();
  return q ? `?${q}` : '';
}
