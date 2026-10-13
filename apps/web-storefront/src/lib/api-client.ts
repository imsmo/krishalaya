// apps/web-storefront/src/lib/api-client.ts · the typed SDK, wired for this app. SERVER factory injects the
// httpOnly session token (read server-side only) + the optional tenant slug; PUBLIC factory is token-free for
// anonymous SSR (home / listings browse / traceability scan). The SDK adds timeout + idempotent-GET retry, so a
// slow/flaky API degrades instead of hanging the render (Law 12). Money returned is a STRING of minor units.
// PC-56 STORE-1a · C2: every factory forwards the buyer's address, signed (lib/caller.ts), so the API's per-IP limits count BUYERS,
// not this server.
import 'server-only';
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { env } from './env';
import { getSessionToken } from './auth';
import { callerHeaders } from './caller';

/** Authenticated server client (SSR with the caller's session). Pass a tenant slug for tenant-scoped storefronts. */
export function serverClient(tenantSlug?: string): KrishalayaClient {
  return createClient({
    baseUrl: env.serverApiUrl,
    tenantSlug,
    getToken: () => getSessionToken(),
    getHeaders: callerHeaders,
    userAgent: 'kv-web-storefront',
    timeoutMs: 8000,
  });
}
/** Anonymous server client for public pages (no token attached). */
export function publicClient(tenantSlug?: string): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, tenantSlug, getHeaders: callerHeaders, userAgent: 'kv-web-storefront', timeoutMs: 8000 });
}
/** PC-56 STORE-1a · C7: a client holding a token that is not (yet) in a cookie — the sign-in action's buyer bootstrap. */
export function tokenClient(accessToken: string, tenantSlug?: string): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, tenantSlug, getToken: () => accessToken, getHeaders: callerHeaders, userAgent: 'kv-web-storefront', timeoutMs: 8000 });
}
