// apps/web-storefront/src/lib/offline-reads.ts · PC-56 STORE-6a · D2 (founder Q9) — may this organisation's public pages be kept on a phone?
// Edge-safe (the middleware runs it: no server-only import, plain fetch). The answer is the storefront's allow-listed public flags read
// (`GET /v1/storefront/flags`) — `storefront_offline_reads`, TENANT-scoped and FAIL-CLOSED: a store's pages are asked for THAT organisation
// (`x-tenant-slug`); the platform host's own pages ask the SAME key with no organisation in context, which the allow-list does not answer for a
// tenant-scoped key — so it reads absent → OFF (a platform rollout would need the key answered platform-wide: a founder question, report §7).
// Anything but an explicit `true` is OFF. Held in this instance for 60 s (an outage or a miss for 10 s), like lib/host-routing.ts.
const cache = new Map<string, { on: boolean; until: number }>();

export async function offlineReadsOn(apiOrigin: string, slug: string | null, now: number = Date.now()): Promise<boolean> {
  if (!apiOrigin) return false;
  const key = slug ?? '';
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.on;
  let on = false; let ok = false;
  try {
    const res = await fetch(`${apiOrigin.replace(/\/+$/, '')}/v1/storefront/flags`, {
      headers: { accept: 'application/json', ...(slug ? { 'x-tenant-slug': slug } : {}) }, cache: 'no-store',
    });
    const body = (await res.json()) as { data?: { storefront_offline_reads?: unknown } };
    ok = res.ok;
    on = res.ok && body.data?.storefront_offline_reads === true;
  } catch { on = false; }
  cache.set(key, { on, until: now + (ok ? 60_000 : 10_000) });
  return on;
}

/** Tests: forget every held answer. */
export function forgetOfflineReads(): void { cache.clear(); }
