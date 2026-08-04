// apps/web-partner/src/lib/api-client.ts · the platform SDK, wired with the partner's session token (read
// server-side only). The API enforces partner-scoped RBAC from the token, so a partner can only ever see the
// applications/claims routed to them (Law 1/4 server-side). The anonymous client is used only for the OTP login.
import 'server-only';
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { env } from './env';
import { getAccessToken } from './partner-auth';

export function partnerClient(): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, getToken: () => getAccessToken(), userAgent: 'kv-web-partner', timeoutMs: 8000 });
}
export function anonClient(): KrishalayaClient {
  return createClient({ baseUrl: env.serverApiUrl, userAgent: 'kv-web-partner', timeoutMs: 8000 });
}
