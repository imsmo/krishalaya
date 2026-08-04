// apps/web-storefront/src/lib/api-client.ts · the typed SDK, wired for this app. SERVER factory injects the
// httpOnly session token (read server-side only) + the optional tenant slug; PUBLIC factory is token-free for
// anonymous SSR (home / listings browse / traceability scan). The SDK adds timeout + idempotent-GET retry, so a
// slow/flaky API degrades instead of hanging the render (Law 12). Money returned is a STRING of minor units.
import 'server-only';
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { env } from './env';
import { getSessionToken } from './auth';

/** Authenticated server client (SSR with the caller's session). Pass a tenant slug for tenant-scoped storefronts. */
export function serverClient(tenantSlug?: string): KrishalayaClient {
  return createClient({
    baseUrl: env.serverApiUrl,
    tenantSlug,
    getToken: () => getSessionToken(),
    userAgent: 'kv-web-storefront',
    timeoutMs: 8000,
  });
}
/** Anonymous server client for public pages (no token attached). */
export function publicClient(tenantSlug?: string): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, tenantSlug, userAgent: 'kv-web-storefront', timeoutMs: 8000 });
}
