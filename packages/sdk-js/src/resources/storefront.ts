// @krishalaya/sdk-js · storefront resource — PC-56 STORE-1a · A3/C4. The anonymous storefront's question "which organisation is this
// page?" answered by the API from the request's own tenant context (the client's `tenantSlug` → `X-Tenant-Slug`, or a verified
// storefront host). A 404 TENANT_NOT_FOUND means no LIVE tenant resolved — never a default one.
import { HttpClient } from '../http';
import { DiscoveryCard, OrganisationCard, Page, PublicAuction, StorefrontFlags, StorefrontPlans, StorefrontProfile, StorefrontStats, StorefrontTenant } from '../types';

export class StorefrontResource {
  constructor(private readonly http: HttpClient) {}
  /** The context-resolved live tenant: id, slug, display name (no PII). Anonymous. */
  async tenant(signal?: AbortSignal): Promise<StorefrontTenant> {
    return (await this.http.request<StorefrontTenant>('GET', 'storefront/tenant', { anonymous: true, signal })).data;
  }

  // PC-56 STORE-1b · the two homes' public reads (all anonymous GETs; every one goes through a 0204 SECURITY DEFINER read on the API).

  /** D4 — the context tenant's public profile. 404 TENANT_NOT_FOUND for an unknown, non-live or (anonymously) trial organisation. */
  async profile(signal?: AbortSignal): Promise<StorefrontProfile> {
    return (await this.http.request<StorefrontProfile>('GET', 'storefront/profile', { anonymous: true, signal })).data;
  }
  /** D3 — the platform's precomputed public counts and when they were computed. */
  async stats(signal?: AbortSignal): Promise<StorefrontStats> {
    return (await this.http.request<StorefrontStats>('GET', 'storefront/stats', { anonymous: true, signal })).data;
  }
  /** D1 — one keyset page of the cross-tenant discovery feed (`after` = the previous page's nextCursor). */
  async discover(q: { after?: string; limit?: number; category?: string; q?: string } = {}, signal?: AbortSignal): Promise<Page<DiscoveryCard>> {
    const r = await this.http.request<DiscoveryCard[]>('GET', 'storefront/discover', {
      anonymous: true, signal, query: { after: q.after, limit: q.limit, category: q.category, q: q.q },
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** D1 — one keyset page of the verified-organisation directory. */
  /** PC-56 STORE-2a: `q` (≥ 2 characters) = a DISPLAY-NAME prefix search of the same verified directory (at most 24, no cursor). */
  async organisations(q: { after?: string; limit?: number; q?: string } = {}, signal?: AbortSignal): Promise<Page<OrganisationCard>> {
    const r = await this.http.request<OrganisationCard[]>('GET', 'storefront/organisations', { anonymous: true, signal, query: { after: q.after, limit: q.limit, q: q.q } });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** B2 — the allow-listed public flags: `group_lots` for the context tenant (absent with none); STORE-1c — `org_self_signup`, the
   *  platform's signup switch, always. */
  async flags(signal?: AbortSignal): Promise<StorefrontFlags> {
    return (await this.http.request<StorefrontFlags>('GET', 'storefront/flags', { anonymous: true, signal })).data;
  }
  /** PC-56 STORE-2c · B7 — the PUBLIC auction read of the context organisation (`auctions` flag OFF → 404). Anonymous by default; pass
   *  `{ withSession: true }` on an authed client to receive the viewer's own facts (their best bid, leading, won + order). No bidder identity. */
  async auction(id: string, opts: { withSession?: boolean } = {}, signal?: AbortSignal): Promise<PublicAuction> {
    return (await this.http.request<PublicAuction>('GET', `storefront/auctions/${encodeURIComponent(id)}`, { anonymous: !opts.withSession, signal })).data;
  }
  /** PC-56 STORE-1c · D2 — the PUBLIC plans of a country (`?country=XX`, two letters; the API refuses a missing one by name —
   *  400 COUNTRY_REQUIRED — rather than guess a country). Read-only. */
  async plans(country?: string, signal?: AbortSignal): Promise<StorefrontPlans> {
    return (await this.http.request<StorefrontPlans>('GET', 'storefront/plans', { anonymous: true, signal, query: { country } })).data;
  }
}
