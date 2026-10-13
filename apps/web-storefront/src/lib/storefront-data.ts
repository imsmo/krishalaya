// apps/web-storefront/src/lib/storefront-data.ts · PC-56 STORE-1b — the tenant pages' shared reads, ONCE per request.
//
// Survey F-22: a tenant page read its branding in up to five places (layout metadata, viewport, layout body, page metadata, page body). The
// reads below are wrapped in React's per-request `cache`, so the layout, its metadata, the viewport and the page share ONE answer per
// request. And they keep the three outcomes apart (features/home/load-result.ts): a real 404 from the API — an unknown, non-live or (to an
// anonymous visitor) TRIAL organisation — is `not_found` and the layout calls notFound(); anything else (timeout, 5xx) is `unavailable` and
// the store renders a DEGRADED state, never a fake storefront and never a false 404.
import 'server-only';
import { cache } from 'react';
import type { StorefrontProfile, StorefrontTenant, TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from './api-client';
import { loadResult, type LoadResult } from '../features/home/load-result';

export type TenantShell =
  | { kind: 'ok'; tenant: StorefrontTenant; branding: TenantBranding | null }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

/** "Is there a live organisation at this slug?" + its branding — one round per request, shared by layout, metadata and page. */
export const loadTenantShell = cache(async (slug: string): Promise<TenantShell> => {
  const t = await loadResult(() => publicClient(slug).storefront.tenant());
  if (!t.ok) return { kind: t.kind };
  const b = await loadResult(() => publicClient(slug).lookups.tenantBranding());
  return { kind: 'ok', tenant: t.data, branding: b.ok ? b.data : null };
});

/** D4: the organisation's public profile (verified, since, district, member farmers, currency) — once per request. */
export const loadTenantProfile = cache(async (slug: string): Promise<LoadResult<StorefrontProfile>> =>
  loadResult(() => publicClient(slug).storefront.profile()));
