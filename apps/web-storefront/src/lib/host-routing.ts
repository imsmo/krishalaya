// apps/web-storefront/src/lib/host-routing.ts · PC-56 TENANT-13d · B3 — Host → tenant for the storefront (Edge-safe: no server-only
// imports, plain fetch). The API decides (`GET /v1/storefront/host?host=`): whether Host routing is ON (flag `tenant_host_routing`,
// default OFF), whether the host is one the platform answers on itself, which tenant a VERIFIED host belongs to (never a pending claim,
// never a default tenant), and whether to 301 to the tenant's primary domain (only once that domain's certificate is issued).
// Answers are cached in this instance for 60 s (a miss / an outage for 10 s), like the API's own resolver.
export const TENANT_SLUG_HEADER = 'x-kv-tenant-slug';

export interface HostAnswer {
  routing: boolean; platformHost: boolean; unavailable?: boolean;
  tenant: { slug: string } | null; redirectTo: string | null; redirectBlockedBy: string | null;
}
const cache = new Map<string, { a: HostAnswer; until: number }>();

/** The storefront's own hosts — never sent to the API: localhost, IP literals, and the configured site origin. */
export function isOwnHost(host: string, siteUrl: string): boolean {
  const h = host.toLowerCase().split(':')[0].replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || /^[0-9.]+$/.test(h) || h.startsWith('[')) return true;
  try { return siteUrl !== '' && new URL(siteUrl).hostname.toLowerCase() === h; } catch { return false; }
}

export async function resolveStorefrontHost(apiOrigin: string, host: string): Promise<HostAnswer> {
  const key = host.toLowerCase().split(':')[0];
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.a;
  let a: HostAnswer;
  try {
    const res = await fetch(`${apiOrigin.replace(/\/+$/, '')}/v1/storefront/host?host=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = (await res.json()) as { data?: HostAnswer };
    a = res.ok && body.data ? body.data : { routing: true, platformHost: false, unavailable: true, tenant: null, redirectTo: null, redirectBlockedBy: null };
  } catch {
    a = { routing: true, platformHost: false, unavailable: true, tenant: null, redirectTo: null, redirectBlockedBy: null };
  }
  cache.set(key, { a, until: Date.now() + (a.tenant ? 60_000 : 10_000) });
  return a;
}
