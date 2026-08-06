// modules/lookups/lookups.service.ts · the PUBLIC reference-data read API (P1-9). Hands clients the controlled
// vocabularies + the admin-region tree they need to render pickers/facets with REAL names instead of opaque UUIDs.
// All sources are master/reference data:
//   • lookup_values  — controlled vocabularies (doc_type, cancel_reason, …); platform rows (tenant_id IS NULL) plus
//                      the caller's own tenant rows; a tenant value SHADOWS a platform value of the same code.
//   • admin_regions  — states→districts→talukas→villages (global; no tenant_id).
// Names are LOCALE-RESOLVED: a LEFT JOIN onto `translations` returns the caller's-language label when one exists,
// else the canonical default_name (graceful fallback — never a fabricated label). Read-only, REPLICA-backed (CQRS),
// every list is BOUNDED (no unbounded scan), and the hot/common reads are cached with tenant-prefixed keys.
//
// PC-56 ADMIN-3b — THE JOIN NOW CARRIES A PREDICATE, AND ITS ABSENCE WAS A LATENT BUG. These joins had no condition
// beyond the key match, so (a) an unreviewed MACHINE translation would have been served to a farmer as soon as anything
// wrote one, which is exactly what the canon forbids, and (b) a soft-deleted translation was still served, so revoking a
// bad one would not have revoked it. `servableTranslation()` is the shared rule — one copy, because three copies is how
// one of them misses the next correction.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../core/database/read-replica.provider';
import { servableTranslation } from '../../core/database/translation-visibility';
import { CACHE_SERVICE, CacheService } from '../../core/cache/cache.service';
import { METRICS, Metrics, timed } from '../../core/observability/metrics';

const VALUE_LIMIT = 1000;   // a single controlled vocabulary is small + bounded
const REGION_LIMIT = 2000;  // one parent's children (or all states) — bounded

/** The base ISO-639 language for translation lookup: 'hi-IN' → 'hi'. Lowercased; defaults to 'en'. Pure. */
export function baseLang(lang: string | undefined | null): string {
  const s = (lang ?? '').trim().toLowerCase();
  const base = s.split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : 'en';
}

export interface LookupValueView { id: string; code: string; name: string; sortOrder: number; meta: Record<string, unknown>; }
export interface RegionView { id: string; code: string | null; level: number; parentId: string | null; name: string; lat: number | null; lng: number | null; }

@Injectable()
export class LookupsService {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** A controlled vocabulary (e.g. 'doc_type') — platform + this tenant's own values, locale-resolved. A tenant
   *  value shadows a platform value of the same code. Cached per (tenant, type, lang). */
  async values(tenantId: string, lang: string, typeCode: string): Promise<LookupValueView[]> {
    const lc = baseLang(lang);
    return timed(this.metrics, 'lookups.values', { tenant: tenantId }, () =>
      this.cache.wrap(`lookups:vals:${tenantId}:${typeCode}:${lc}`, 300, async () => {
        const r = await this.replica.forTenant(tenantId).query<{ id: string; code: string; name: string; sort_order: number; meta: Record<string, unknown> }>(
          `WITH v AS (
             SELECT DISTINCT ON (lv.code) lv.id, lv.code, lv.default_name, lv.sort_order, lv.meta
               FROM lookup_values lv
              WHERE lv.type_code = $1 AND lv.is_active = true AND (lv.tenant_id IS NULL OR lv.tenant_id = $2)
              ORDER BY lv.code, (lv.tenant_id IS NULL)   -- a tenant (non-NULL) row wins over the platform row
           )
           SELECT v.id, v.code, COALESCE(t.text, v.default_name) AS name, v.sort_order, v.meta
             FROM v
             LEFT JOIN translations t
               ON t.entity_type = 'lookup_value' AND t.entity_id = v.id AND t.field = 'name' AND t.language_code = $3
               AND ${servableTranslation('t')}
            ORDER BY v.sort_order, name
            LIMIT ${VALUE_LIMIT}`,
          [typeCode, tenantId, lc]);
        return r.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, sortOrder: x.sort_order, meta: x.meta ?? {} }));
      }));
  }

  /** Admin regions, locale-resolved. Without `parentId` returns the states for `level` (default 1); with `parentId`
   *  returns that node's direct children. Bounded + ordered by name; states list is cached per (tenant, level, lang). */
  async regions(tenantId: string, lang: string, opts: { parentId?: string; level?: number }): Promise<RegionView[]> {
    const lc = baseLang(lang);
    const run = async () => {
      const params: unknown[] = [lc];
      const where: string[] = ['r.is_active = true'];
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      if (opts.parentId) where.push(`r.parent_id = ${p(opts.parentId)}`);
      else where.push(`r.level = ${p(opts.level ?? 1)}`);
      const r = await this.replica.forTenant(tenantId).query<{ id: string; code: string | null; level: number; parent_id: string | null; name: string; lat: string | null; lng: string | null }>(
        `SELECT r.id, r.code, r.level, r.parent_id,
                COALESCE(t.text, r.default_name) AS name, r.centroid_lat::text AS lat, r.centroid_lng::text AS lng
           FROM admin_regions r
           LEFT JOIN translations t
             ON t.entity_type = 'region' AND t.entity_id = r.id AND t.field = 'name' AND t.language_code = $1
             AND ${servableTranslation('t')}
          WHERE ${where.join(' AND ')}
          ORDER BY name
          LIMIT ${REGION_LIMIT}`,
        params);
      return r.rows.map((x) => ({ id: x.id, code: x.code, level: x.level, parentId: x.parent_id, name: x.name,
        lat: x.lat === null ? null : Number(x.lat), lng: x.lng === null ? null : Number(x.lng) }));
    };
    return timed(this.metrics, 'lookups.regions', { tenant: tenantId }, () =>
      (!opts.parentId ? this.cache.wrap(`lookups:regions:${tenantId}:${opts.level ?? 1}:${lc}`, 600, run) : run()));
  }
}
