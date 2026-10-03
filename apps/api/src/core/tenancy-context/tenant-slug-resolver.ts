// core/tenancy-context/tenant-slug-resolver.ts
// Resolves a storefront's PUBLIC tenant SLUG (e.g. "demo-fpo", sent by anonymous storefront/SDK calls as the
// `X-Tenant-Slug` header) to the tenant's internal uuid, so the request pipeline can establish tenant context for
// unauthenticated public reads (browse, listing detail, public reviews, trace scan landing).
//
// WHY this is safe without a tenant context: `tenants` is a GLOBAL registry table — it has no `tenant_id` column,
// so the blanket RLS pass (migrations 0014/0020/…) skips it and it carries NO row-level policy. A lookup by slug
// therefore needs no `app.tenant_id` GUC. We resolve ONLY tenants in a browsable lifecycle status; pending/
// suspended/archived/terminated tenants do not expose a storefront.
//
// HOT PATH: this runs (at most) once per anonymous request, so results are cached in-process with a short TTL —
// positive hits for 60s, negative (unknown slug) for 10s — bounding DB load to ~1 query per slug per minute per
// pod while staying fresh enough that a newly-activated tenant appears within a minute. A resolution FAILURE never
// throws: it degrades to "unresolved" (the request proceeds as anonymous and is rejected cleanly downstream with
// 400 TENANT_REQUIRED rather than 500).
import { Injectable, Logger } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';

interface CacheEntry { tenantId: string | null; expiresAt: number; }
interface BrandingCacheEntry { branding: TenantBranding | null; expiresAt: number; }

const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000;
// tenants.slug is varchar(50) UNIQUE; reject anything that can't be a slug BEFORE touching the DB (no wasted query,
// no injection surface — the value is also bound as a parameter, never interpolated).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;

@Injectable()
export class TenantSlugResolver {
  private readonly log = new Logger(TenantSlugResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly pools: PgPoolProvider) {}

  /** Returns the tenant uuid for a live storefront slug, or null (unknown/malformed/not-live). Never throws. */
  async resolve(slug: string): Promise<string | null> {
    const key = slug.trim().toLowerCase();
    if (!SLUG_RE.test(key)) return null;

    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.tenantId;

    let tenantId: string | null = null;
    try {
      // shard 0 = the global registry shard; in single-DB deployments every shard shares one writer URL.
      const res = await this.pools.writer(0).query(
        `SELECT id FROM tenants WHERE slug = $1 AND status IN ('trial','active','grace') LIMIT 1`,
        [key],
      );
      tenantId = (res.rows[0]?.id as string | undefined) ?? null;
    } catch (e) {
      // Degrade, do not cache: a transient DB error must not pin a slug to "unresolved" for the whole TTL.
      this.log.error(`tenant slug resolve failed for "${key}": ${(e as Error).message}`);
      return null;
    }

    this.cache.set(key, { tenantId, expiresAt: now + (tenantId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return tenantId;
  }

  /**
   * PC-56 TENANT-13d (F-24): an anonymous `X-Tenant-Id` is honoured only for a LIVE tenant (trial | active | grace) — the same status filter
   * the slug path always had. Same cache discipline. Never throws (degrades to "unresolved").
   */
  private readonly idCache = new Map<string, CacheEntry>();
  async resolveId(raw: string): Promise<string | null> {
    const id = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
    const now = Date.now();
    const hit = this.idCache.get(id);
    if (hit && hit.expiresAt > now) return hit.tenantId;
    let tenantId: string | null = null;
    try {
      const res = await this.pools.writer(0).query(`SELECT id FROM tenants WHERE id = $1 AND status IN ('trial','active','grace') AND deleted_at IS NULL LIMIT 1`, [id]);
      tenantId = (res.rows[0]?.id as string | undefined) ?? null;
    } catch (e) {
      this.log.error(`tenant id resolve failed: ${(e as Error).message}`);
      return null;
    }
    this.idCache.set(id, { tenantId, expiresAt: now + (tenantId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return tenantId;
  }

  /**
   * PC-56 TENANT-13d (B3): Host → tenant, through 0194's SECURITY DEFINER `resolve_tenant_host` — ONLY a verified, live domain of a live
   * tenant answers (never a pending claim, never a default tenant). Cached 60 s (a miss 10 s). A DB error degrades to "unresolved"
   * WITHOUT caching and is reported as `error` so the caller can answer 503 rather than a false 404.
   */
  private readonly hostCache = new Map<string, { value: HostResolution | null; expiresAt: number }>();
  async resolveHost(host: string): Promise<{ value: HostResolution | null; error: boolean }> {
    const key = host.trim().toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]{1,253}$/.test(key)) return { value: null, error: false };
    const now = Date.now();
    const hit = this.hostCache.get(key);
    if (hit && hit.expiresAt > now) return { value: hit.value, error: false };
    let value: HostResolution | null = null;
    try {
      const res = await this.pools.writer(0).query(`SELECT * FROM resolve_tenant_host($1)`, [key]);
      const r = res.rows[0] as Record<string, any> | undefined;
      value = r ? { tenantId: r.tenant_id, slug: r.slug, domainKind: r.domain_kind, isPrimary: r.is_primary === true,
                    primaryDomain: r.primary_domain ?? null, primaryKind: r.primary_kind ?? null, primaryTls: r.primary_tls ?? null } : null;
    } catch (e) {
      this.log.error(`tenant host resolve failed for "${key}": ${(e as Error).message}`);
      return { value: null, error: true };
    }
    this.hostCache.set(key, { value, expiresAt: now + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return { value, error: false };
  }

  /** DEV-26/Q20: the public white-label branding for an already-resolved tenant (display_name + logo_url,
   *  migration 0075). Read-only, same "no RLS needed" reasoning as `resolve()` above (`tenants` has no
   *  `tenant_id` column). Cached alongside the slug cache (same TTL discipline: a positive hit for
   *  `POSITIVE_TTL_MS`, a miss for `NEGATIVE_TTL_MS`; a DB error degrades to `null` WITHOUT caching, so the next
   *  request retries) — a SEPARATE cache map from `resolve()`'s own (keyed by tenantId, not slug; the two never
   *  collide, but sharing one map risked confusing a slug string with a uuid string). Never throws. */
  private readonly brandingCache = new Map<string, BrandingCacheEntry>();

  async getBranding(tenantId: string): Promise<TenantBranding | null> {
    const now = Date.now();
    const hit = this.brandingCache.get(tenantId);
    if (hit && hit.expiresAt > now) return hit.branding;

    let branding: TenantBranding | null = null;
    try {
      const res = await this.pools.writer(0).query(
        `SELECT display_name, logo_url FROM tenants WHERE id = $1 AND status IN ('trial','active','grace') LIMIT 1`,
        [tenantId],
      );
      const row = res.rows[0] as { display_name?: string; logo_url?: string | null } | undefined;
      // PC-56 TENANT-13d: the published brand (SECURITY DEFINER — `tenant_branding*` are RLS-forced and this path has no tenant GUC)
      const pb = row ? await this.pools.writer(0).query(`SELECT * FROM public_tenant_brand($1)`, [tenantId]) : { rows: [] };
      const b = pb.rows[0] as Record<string, any> | undefined;
      const brand: PublishedBrand | null = b ? {
        version: Number(b.version), displayName: b.display_name, appShortName: b.app_short_name,
        logoPath: `/v1/storefront/branding/logo/${tenantId}/${Number(b.version)}`, logoMime: b.logo_mime,
        colours: { primary: b.primary_color, accent: b.accent_color, ink: b.ink_color, surface: b.surface_color },
        poweredByHidden: b.powered_by_hidden === true && b.plan_allows_unbranded === true,
        publishedAt: new Date(b.published_at).toISOString(),
      } : null;
      branding = row ? { displayName: brand?.displayName ?? row.display_name ?? '', logoUrl: row.logo_url ?? null, brand } : null;
    } catch (e) {
      this.log.error(`tenant branding read failed for "${tenantId}": ${(e as Error).message}`);
      return null; // degrade, do not cache (transient DB error must not pin "no branding" for the whole TTL)
    }

    this.brandingCache.set(tenantId, { branding, expiresAt: now + (branding ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return branding;
  }
}

/** DEV-26/Q20: the shape a public storefront render needs — never more than this (no PII, no internal fields). */
export interface TenantBranding {
  displayName: string;
  /** https-only (DB CHECK, migration 0075) or null — a null/missing value means "render the LOGO-4 fallback"
   *  (name-block / initial-tile), NEVER the platform's own mark (see migration 0075's own header + LOGO-4). */
  logoUrl: string | null;
  /** PC-56 TENANT-13d (A5): the PUBLISHED white-label brand (0194 `public_tenant_brand` — the history version the brand points at, never a
   *  draft), or null when the tenant has never published (members see the platform brand with the tenant's name). */
  brand: PublishedBrand | null;
}
export interface PublishedBrand {
  version: number;
  displayName: string;
  appShortName: string;
  /** API path of the published logo (version-pinned, content-type locked); the caller prefixes its own API origin. */
  logoPath: string;
  logoMime: 'image/png' | 'image/svg+xml';
  colours: { primary: string; accent: string; ink: string; surface: string };
  /** the tenant chose to hide the mark AND its plan includes white_label_unbranded right now — trust surfaces keep it regardless */
  poweredByHidden: boolean;
  publishedAt: string;
}
/** PC-56 TENANT-13d (B3): a verified Host's tenant, and where the tenant's primary domain is (for the 301). */
export interface HostResolution {
  tenantId: string; slug: string; domainKind: 'included' | 'custom'; isPrimary: boolean;
  primaryDomain: string | null; primaryKind: 'included' | 'custom' | null; primaryTls: string | null;
}
