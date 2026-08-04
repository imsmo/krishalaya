// apps/web-tenant/src/lib/api-client.ts · the tenant SDK, wired with the console's session token (read
// server-side only). The API enforces tenant scoping + RBAC from the token, so the console can't see another
// tenant's data even if asked (Law 1/4 server-side). Anonymous client is used only for the OTP login flow.
import 'server-only';
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { env } from './env';
import { getAccessToken } from './auth';

export function tenantClient(): KrishalayaClient {
  return createClient({
    baseUrl: env.serverApiUrl,
    getToken: () => getAccessToken(),
    // The API scopes tenant-data reads/writes by tenant context. Send the console's tenant on every authed call
    // (the API still enforces the caller's RBAC + RLS membership from the token). Locally this is NEXT_PUBLIC_TENANT_ID.
    ...(env.tenantId ? { getHeaders: () => ({ 'x-tenant-id': env.tenantId as string }) } : {}),
    userAgent: 'kv-web-tenant',
    timeoutMs: 8000,
  });
}
export function anonClient(): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, userAgent: 'kv-web-tenant', timeoutMs: 8000 });
}
