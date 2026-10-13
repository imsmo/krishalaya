// apps/web-storefront/src/lib/tenant-context.ts · PC-56 STORE-1a · C4 (founder D1) — WHICH ORGANISATION THIS SIGN-IN BELONGS TO.
//
// Order: the `/[tenantSlug]` route param → the host-routing header the middleware sets for a verified tenant host (flag
// `tenant_host_routing`) → NEXT_PUBLIC_PLATFORM_TENANT_SLUG (the platform bazaar's tenant). The slug is then resolved by the API
// (`GET /v1/storefront/tenant` — LIVE tenants only, through its SECURITY DEFINER reads), so a typo or a suspended store is a named state,
// never a guessed tenant. Buyer accounts are per tenant, as the API models them. The build-time NEXT_PUBLIC_TENANT_ID is retired.
import 'server-only';
import { headers } from 'next/headers';
import type { StorefrontTenant } from '@krishalaya/sdk-js';
import { env } from './env';
import { publicClient } from './api-client';
import { TENANT_SLUG_HEADER } from './host-routing';
import { pickTenantSlug } from '../features/auth/redirect';

export type TenantResolution =
  | { ok: true; slug: string; tenant: StorefrontTenant }
  | { ok: false; kind: 'not_configured' | 'not_found' | 'unavailable'; slug: string | null };

export async function resolveStorefrontTenant(routeSlug?: string | null): Promise<TenantResolution> {
  let hostSlug: string | null = null;
  try { hostSlug = headers().get(TENANT_SLUG_HEADER); } catch { hostSlug = null; }
  const slug = pickTenantSlug(routeSlug, hostSlug, env.platformTenantSlug);
  if (!slug) return { ok: false, kind: 'not_configured', slug: null };
  try {
    return { ok: true, slug, tenant: await publicClient(slug).storefront.tenant() };
  } catch (e) {
    const status = Number((e as { status?: unknown } | null)?.status ?? 0);
    return { ok: false, kind: status === 404 ? 'not_found' : 'unavailable', slug };
  }
}
