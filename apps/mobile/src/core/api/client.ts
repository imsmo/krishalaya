// apps/mobile/src/core/api/client.ts · the typed API client factory for the app, built on @krishalaya/sdk-js
// (timeout + idempotent-GET retry + circuit-safe; money as string minor units; typed SdkError). The bearer token
// is supplied per-request by a getter the auth store registers, so a single client instance always sends the
// CURRENT token (no stale-token bug, no client churn on refresh). The tenant slug (white-label builds) is sent as
// X-Tenant-Slug. `anonClient()` is the tokenless client used only for the OTP login flow.
//
// REACTIVE refresh-on-401: access tokens expire in 900s and, until now, the ONLY refresh was the boot-time
// proactive one in auth.store — once a token expired mid-session every request 401'd until the app restarted.
// `registerRefreshExecutor` mirrors `registerAccessTokenGetter`: the auth store registers an executor on mount
// that calls the refresh endpoint, persists + applies the new tokens, and reports success/failure. That executor
// is wired into the SINGLE shared client as `onUnauthorized` — the SDK (packages/sdk-js/src/http.ts) owns the
// single-flight + retry-once orchestration; this module only supplies the "how to refresh" callback.
import { createClient, KrishalayaClient } from '@krishalaya/sdk-js';
import { config } from '../config';
import { integrityHeaders } from '../security/integrity';
import { correlationHeaders } from '../observability';

/** Per-request PII-free headers: device-integrity risk signal (§4) + correlation id (§6). Merged best-effort. */
async function authedHeaders(): Promise<Record<string, string>> {
  return { ...correlationHeaders(), ...(await integrityHeaders()) };
}

let _accessTokenGetter: () => string | undefined = () => undefined;

/** The auth store calls this once so the client can read the live in-memory access token. */
export function registerAccessTokenGetter(fn: () => string | undefined): void {
  _accessTokenGetter = fn;
}

/** Resolves true once a fresh access token has been saved + applied (the auth store's job); false/throw means
 * give up (the SDK then rethrows the original 401). No-op (`false`) until the auth store registers one on mount. */
let _refreshExecutor: () => Promise<boolean> = () => Promise.resolve(false);

/** The auth store calls this once so the shared client can trigger a refresh reactively on a 401. */
export function registerRefreshExecutor(fn: () => Promise<boolean>): void {
  _refreshExecutor = fn;
}

let _client: KrishalayaClient | undefined;
/** The shared authenticated client (singleton — reads the live token each request). */
export function apiClient(): KrishalayaClient {
  if (!_client) {
    _client = createClient({
      baseUrl: config.apiUrl,
      getToken: () => _accessTokenGetter(),
      tenantSlug: config.tenantSlug,
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.userAgent,
      // Attach PII-free device-integrity + correlation-id headers on every authenticated request.
      getHeaders: authedHeaders,
      // Reactive refresh-on-401 (single-flight + retry-once is owned by the SDK's HttpClient).
      onUnauthorized: () => _refreshExecutor(),
    });
  }
  return _client;
}

/** Tokenless client for the pre-auth OTP flow. */
export function anonClient(): KrishalayaClient {
  return createClient({ baseUrl: config.apiUrl, tenantSlug: config.tenantSlug, timeoutMs: config.requestTimeoutMs, userAgent: config.userAgent });
}
