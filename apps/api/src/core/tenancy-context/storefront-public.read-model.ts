// core/tenancy-context/storefront-public.read-model.ts · PC-56 STORE-1b · B2 — the public reads behind the platform home (W273) and the
// tenant home (W274); PC-56 STORE-1c · B2 adds the public plan catalogue (`/pricing`, W307 — a PLATFORM table without RLS, see plans()). Every read goes through one of migration 0204's SECURITY DEFINER functions (the `tenants` wall, 0200, hides every row
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

/** PC-56 STORE-1c (founder D2) · one PUBLIC plan of a country: money as bigint minor STRINGS + the currency and its exponent (the DB's
 *  `currencies.minor_units`) — never a float, never an assumed ₹. */
export interface PublicPlan {
  code: string; name: string; monthlyMinor: string; annualMinor: string; setupFeeMinor: string; currency: string; exponent: number;
}
export interface PublicPlans {
  country: string;
  plans: PublicPlan[];
  /** The trial length the platform's signup policy states (`signup.trial_days`), or null when the setting is missing or malformed — the
   *  page then says the length is shown at creation, rather than printing a number the service might not use (the service's own default
   *  is NOT copied here: one place owns it, modules/tenancy/domain/signup.ts). */
  trialDays: number | null;
}

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

/** The `signup.trial_days` setting as a whole number of days in 1..365, else null (missing / malformed — said, never defaulted here). */
export function trialDaysOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

/** A query-string country: exactly two ASCII letters (ISO 3166-1 alpha-2), upper-cased; anything else is null (the route refuses it). */
export function countryParam(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z]{2}$/.test(raw.trim()) ? raw.trim().toUpperCase() : null;
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

  /**
   * PC-56 STORE-1c · D2 — the PUBLIC plan catalogue of one country, for `/pricing` and W307.
   *
   * `plans` is a PLATFORM table (0002 + 0037): no tenant_id and NO RLS — 0037's header says so, and kv_app holds SELECT on it (0205's header
   * records the check). So this read needs no definer function; what keeps it public is the WHERE clause, and each exclusion is a spec:
   * `is_public` (government / enterprise plans are quotes, never listed), `is_active` (the runtime sellability flag), `status = 'active'`
   * (0037's lifecycle: a DRAFT was never published, an ARCHIVED one is retired), `deleted_at IS NULL`, and THIS country only. A price change
   * is a new version row, so the newest version of each code wins (the same rule as the W115 compare read and the signup trial-plan read).
   * Read-only, on the replica (Law 12) — no money moves here.
   */
  async plans(country: string): Promise<PublicPlans> {
    const db = this.pools.replica(0);
    const r = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (p.code) p.code, p.default_name, p.monthly_price_minor::text AS monthly, p.annual_price_minor::text AS annual,
                p.setup_fee_minor::text AS setup_fee, p.currency_code, c.minor_units
           FROM plans p
           JOIN currencies c ON c.code = p.currency_code
          WHERE p.is_public AND p.is_active AND p.status = 'active' AND p.deleted_at IS NULL AND p.country_code = $1
          ORDER BY p.code, p.version DESC) latest
        ORDER BY latest.monthly::bigint, latest.code`, [country]);
    const s = await db.query(
      `SELECT COALESCE(v.value, d.default_value) AS value
         FROM setting_definitions d
         LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL
        WHERE d.key = 'signup.trial_days'`, []);
    return {
      country,
      plans: (r.rows as PgRow[]).map((x) => ({
        code: String(x.code), name: String(x.default_name), monthlyMinor: String(x.monthly), annualMinor: String(x.annual),
        setupFeeMinor: String(x.setup_fee), currency: String(x.currency_code).trim(), exponent: Number(x.minor_units),
      })),
      trialDays: trialDaysOf((s.rows[0] as PgRow | undefined)?.value),
    };
  }

  /** PC-56 STORE-2a (brief C2, 0207 `public_organisation_search`): verified live organisations whose DISPLAY NAME starts with `prefix`
   *  (≥ 2 characters, else nothing), at most 24, by name — the platform search's "Organisations" tab. One page, no cursor: a name search
   *  shows its best 24 and the page asks for a longer prefix when it is full. */
  async searchOrganisations(prefix: string): Promise<KeysetPage<OrganisationCard>> {
    const p = typeof prefix === 'string' ? prefix.trim().slice(0, 80) : '';
    if (p.length < 2) return { items: [], nextCursor: null };
    const r = await this.pools.replica(0).query(`SELECT * FROM public_organisation_search($1::text, $2::int)`, [p, PUBLIC_PAGE_DEFAULT]);
    return {
      items: (r.rows as Array<PgRow>).map((x) => ({
        slug: x.slug, displayName: x.display_name, district: x.district_name ?? null, logoUrl: x.logo_url ?? null,
        logoPath: logoPathOf(x.tenant_id, x.brand_version), memberFarmers: Number(x.member_count ?? 0),
      })),
      nextCursor: null,
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
