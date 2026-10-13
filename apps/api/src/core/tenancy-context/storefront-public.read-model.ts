// core/tenancy-context/storefront-public.read-model.ts · PC-56 STORE-1b · B2 — the public reads behind the platform home (W273) and the
// tenant home (W274). Every read goes through one of migration 0204's SECURITY DEFINER functions (the `tenants` wall, 0200, hides every row
// from a context-free kv_app; `listings` is RLS-forced per tenant) — named functions with the smallest projection, never a blanket bypass.
// All of them are on the read replica (Law 12: reads tolerate replica lag); the precomputed stats are refreshed by the job, never here.
//
// WHY HERE (core/tenancy-context) and not modules/listings: these are the anonymous storefront's context-free reads — the same family as
// `storefront/tenant` and `storefront/branding` (STORE-1a / 13d) — and two of the five (profile, organisations) are about TENANTS, not
// listings. The listing-search total/members-only counts stay in modules/listings (its own read model calls the 0204 counters).
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../shared/pagination/us-keyset';

/** The feed and directory page size cap. 0204 clamps a call to 48 rows; a page reads ONE extra row to know whether another page exists,
 *  so a page shows at most 47 and a call never asks for more than 48. */
export const PUBLIC_PAGE_MAX = 47;
export const PUBLIC_PAGE_DEFAULT = 24;

export interface PublicTenantProfile {
  displayName: string;
  legalName: string;
  /** the platform's own verification: tenants.approved_at set by the admin realm (0204 header) */
  verified: boolean;
  sinceYear: number;
  district: string | null;
  memberFarmers: number;
  logoUrl: string | null;
  /** the version-pinned published logo (13d) when the organisation has published a brand */
  logoPath: string | null;
  currencyCode: string;
}
export interface PlatformStats { liveListings: number; verifiedOrganisations: number; districts: number; computedAt: string | null }
export interface DiscoveryCard {
  listingId: string; tenantSlug: string; organisation: string; title: string; priceMinor: string; currencyCode: string; unitCode: string;
  organic: boolean; grade: string | null; district: string | null;
}
export interface OrganisationCard {
  slug: string; displayName: string; district: string | null; logoUrl: string | null; logoPath: string | null; memberFarmers: number;
}
export interface KeysetPage<T> { items: T[]; nextCursor: string | null }

/** A pg row as the driver hands it back: untyped (`any`) by the driver's own contract — every field is narrowed / converted below before it
 *  leaves this file (String(), Number(), === true), so no `any` reaches a caller. */
type PgRow = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- justified above

const logoPathOf = (tenantId: string, version: unknown): string | null =>
  typeof version === 'number' && version > 0 ? `/v1/storefront/branding/logo/${tenantId}/${version}` : null;

/** Clamp a requested page size to 1..47 (default 24) — so the "one extra row" probe stays inside 0204's 48-row cap. */
export function pageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return PUBLIC_PAGE_DEFAULT;
  return Math.min(Math.floor(n), PUBLIC_PAGE_MAX);
}

@Injectable()
export class StorefrontPublicReadModel {
  constructor(private readonly pools: PgPoolProvider) {}

  /** D4: a LIVE (active | grace) organisation's public profile, or null (trial / pending / suspended / unknown → no row). */
  async profile(tenantId: string): Promise<PublicTenantProfile | null> {
    const r = await this.pools.replica(0).query(`SELECT * FROM public_tenant_profile($1::uuid)`, [tenantId]);
    const x = r.rows[0] as PgRow | undefined;
    if (!x) return null;
    return {
      displayName: x.display_name, legalName: x.legal_name, verified: x.verified === true, sinceYear: Number(x.since_year),
      district: x.district_name ?? null, memberFarmers: Number(x.member_count ?? 0), logoUrl: x.logo_url ?? null,
      logoPath: logoPathOf(tenantId, x.brand_version), currencyCode: String(x.currency_code).trim(),
    };
  }

  /** D3: the precomputed counts and when they were computed (null = the job has not run yet). One row, never a count. */
  async stats(): Promise<PlatformStats> {
    const r = await this.pools.replica(0).query(`SELECT * FROM public_platform_stats()`);
    const x = r.rows[0] as PgRow | undefined;
    if (!x || !x.computed_at) return { liveListings: 0, verifiedOrganisations: 0, districts: 0, computedAt: null };
    return {
      liveListings: Number(x.live_listings), verifiedOrganisations: Number(x.verified_tenants), districts: Number(x.districts),
      computedAt: new Date(x.computed_at).toISOString(),
    };
  }

  /** D1: one keyset page of the cross-tenant discovery feed. The cursor is the µs instant as the DB printed it (us-keyset). */
  async discover(q: { after?: string; limit?: unknown; categoryId?: string; q?: string }): Promise<KeysetPage<DiscoveryCard>> {
    const limit = pageSize(q.limit);
    const c = decodeKeyset(q.after, UUID_RE);
    const category = q.categoryId && UUID_RE.test(q.categoryId) ? q.categoryId : null;
    const prefix = typeof q.q === 'string' && q.q.trim().length >= 2 ? q.q.trim().slice(0, 80) : null;
    const r = await this.pools.replica(0).query(
      `SELECT * FROM public_discovery_feed($1::timestamptz, $2::uuid, $3::int, $4::uuid, $5::text)`,
      [c?.ts ?? null, c?.id ?? null, limit + 1, category, prefix]);
    const rows = r.rows as Array<PgRow>;
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((x) => ({
        listingId: x.listing_id, tenantSlug: x.tenant_slug, organisation: x.tenant_display_name, title: x.title,
        priceMinor: String(x.price_minor), currencyCode: String(x.currency_code).trim(), unitCode: x.unit_code,
        organic: x.organic === true, grade: x.grade_name ?? null, district: x.district_name ?? null,
      })),
      nextCursor: more && last ? encodeKeyset(last.created_us, last.listing_id) : null,
    };
  }

  /** D1: one keyset page of the verified-organisation directory. */
  async organisations(q: { after?: string; limit?: unknown }): Promise<KeysetPage<OrganisationCard>> {
    const limit = pageSize(q.limit);
    const c = decodeKeyset(q.after, UUID_RE);
    const r = await this.pools.replica(0).query(
      `SELECT * FROM public_organisations($1::timestamptz, $2::uuid, $3::int)`, [c?.ts ?? null, c?.id ?? null, limit + 1]);
    const rows = r.rows as Array<PgRow>;
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((x) => ({
        slug: x.slug, displayName: x.display_name, district: x.district_name ?? null, logoUrl: x.logo_url ?? null,
        logoPath: logoPathOf(x.tenant_id, x.brand_version), memberFarmers: Number(x.member_count ?? 0),
      })),
      nextCursor: more && last ? encodeKeyset(last.created_us, last.tenant_id) : null,
    };
  }
}
