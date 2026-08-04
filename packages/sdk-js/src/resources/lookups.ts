// @krishalaya/sdk-js · lookups / taxonomy reads (P1-9). One place for the reference data every app needs to
// render pickers + facets with REAL names instead of opaque UUIDs: the category tree, a category's attributes +
// their options, admin regions, and controlled vocabularies (doc_type, cancel_reason, …). All are PUBLIC reads
// (anonymous storefront facets use them) and locale-resolved server-side from the caller's language. None move
// money or mutate anything. Unknown ids resolve to null client-side via `nameById` (never a fabricated label).
import { HttpClient } from '../http';
import { CategoryNode, AttributeDef, AttributeOption, LookupValue, RegionNode, TenantBranding } from '../types';

export class LookupsResource {
  constructor(private readonly http: HttpClient) {}

  /** The category tree (active, global). `rootCode`/`parentId` narrow the subtree; otherwise the full active tree. */
  async categories(params: { rootCode?: string; parentId?: string; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<CategoryNode[]> {
    return (await this.http.request<CategoryNode[]>('GET', 'categories', { query: { rootCode: params.rootCode, parentId: params.parentId, activeOnly: params.activeOnly ?? true }, anonymous: true, signal })).data;
  }

  /** The attributes bound to a category (hydrated defs + options + filter/card flags). `filtersOnly` → just facets. */
  async attributesForCategory(categoryId: string, opts: { filtersOnly?: boolean } = {}, signal?: AbortSignal): Promise<AttributeDef[]> {
    return (await this.http.request<AttributeDef[]>('GET', 'attributes', { query: { categoryId, filtersOnly: opts.filtersOnly }, anonymous: true, signal })).data;
  }

  /** The dropdown options for a single attribute. */
  async attributeOptions(attributeId: string, opts: { activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<AttributeOption[]> {
    return (await this.http.request<AttributeOption[]>('GET', 'attributes/options', { query: { attributeId, activeOnly: opts.activeOnly ?? true }, anonymous: true, signal })).data;
  }

  /** Admin regions: states by default, or a parent's direct children (`parentId`), locale-resolved names. */
  async regions(params: { parentId?: string; level?: number } = {}, signal?: AbortSignal): Promise<RegionNode[]> {
    return (await this.http.request<RegionNode[]>('GET', 'lookups/regions', { query: { parentId: params.parentId, level: params.level }, anonymous: true, signal })).data;
  }

  /** A controlled vocabulary by type code (e.g. 'doc_type'), platform + tenant values, locale-resolved names. */
  async values(type: string, signal?: AbortSignal): Promise<LookupValue[]> {
    return (await this.http.request<LookupValue[]>('GET', 'lookups/values', { query: { type }, anonymous: true, signal })).data;
  }

  /** DEV-26/Q20: the active request's tenant white-label branding (display name + logo URL), or `null` when no
   *  tenant context resolved. Anonymous — the same public read every storefront page already makes. */
  async tenantBranding(signal?: AbortSignal): Promise<TenantBranding | null> {
    return (await this.http.request<TenantBranding | null>('GET', 'storefront/branding', { anonymous: true, signal })).data;
  }
}

/** Pure helper: resolve an id to its display name from a lookup set, or `null` when unknown (never fabricate). */
export function nameById(items: ReadonlyArray<{ id: string; name?: string; defaultName?: string }>, id: string | null | undefined): string | null {
  if (!id) return null;
  const hit = items.find((i) => i.id === id);
  return hit ? (hit.name ?? hit.defaultName ?? null) : null;
}
