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
      branding = row ? { displayName: row.display_name ?? '', logoUrl: row.logo_url ?? null } : null;
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
}
