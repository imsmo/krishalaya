// apps/web-gov/src/lib/api-client.ts · the SDK, wired with the console's GOVERNMENT session token (read server-side only). PC-56 GOV-1a
// (GOV-1 Q2-A): this console calls ONLY the government realm (`client.gov.*` → `/v1/gov/*`) and the public flag map; it sends no tenant
// header and holds no tenant id — the API answers a tenant or partner route with 401 for a gov token anyway (GOV-0). The anonymous client is
// used only for the sign-in steps, the refresh and the flag map.
import 'server-only';
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { env } from './env';
import { getAccessToken } from './auth';

/** The signed-in client. `token` overrides the cookie (the gate asks the API about the exact token it judged). */
export function govClient(token?: string): KrishalayaClient {
  return createClient({
    baseUrl: env.serverApiUrl,
    getToken: () => token ?? getAccessToken(),
    userAgent: 'kv-web-gov',
    timeoutMs: 8000,
  });
}
export function anonClient(): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, userAgent: 'kv-web-gov', timeoutMs: 8000 });
}
