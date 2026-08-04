// @krishalaya/sdk-js · client configuration. The SDK is the single typed entry point every web frontend +
// the mobile app + third-party integrators use to talk to the Krishalaya API. It NEVER holds secrets: the
// access token is supplied per-request by a `getToken` callback the host owns (so SSR can read an httpOnly
// cookie, a browser can read memory, a server integration can read a vault) — the SDK only attaches it.
export interface SdkConfig {
  /** API origin, e.g. https://api.krishalaya.com (no trailing /v1 — the SDK adds the version). */
  baseUrl: string;
  /** URI version segment. Default 'v1' (matches the API's URI versioning). */
  apiVersion?: string;
  /** Per-request bearer token provider. Return null/undefined for anonymous calls. Async so it can refresh. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Tenant slug for tenant-scoped storefront calls (sent as X-Tenant-Slug). */
  tenantSlug?: string;
  /** Per-request timeout (ms). Default 10000. Bounds every call so a hung API never wedges a render. */
  timeoutMs?: number;
  /** Max retries for IDEMPOTENT (GET) calls on transient network/5xx errors. Default 2. Mutations never retry. */
  retries?: number;
  /** Identifies the caller in logs/analytics (no PII). */
  userAgent?: string;
  /** Optional per-request extra headers (e.g. a mobile device-integrity risk signal). Reserved headers
   * (authorization, idempotency-key, x-tenant-slug, content-type) are NEVER overridable by these — the SDK
   * applies them first then the reserved ones win. Must carry NO secrets/PII. Async so it can attest lazily. */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Injectable fetch (tests / non-global-fetch runtimes). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /**
   * REACTIVE token refresh hook. Called (at most once per original request) when a NON-anonymous request gets a
   * 401. Return true if a fresh token is now available (the SDK retries the original request ONCE, rebuilt
   * headers pick it up via `getToken`); return false (or throw) to give up (the SDK rethrows the original 401).
   * The host owns the actual refresh call + token storage — the SDK only orchestrates WHEN to call it and
   * guarantees at most one concurrent refresh in flight per client (refresh tokens typically ROTATE: a second
   * concurrent call with the now-stale token would fail or invalidate the session). Never invoked for an
   * `anonymous: true` request (e.g. auth/refresh itself) — that would be a self-referential loop.
   */
  onUnauthorized?: () => Promise<boolean>;
}

export interface ResolvedConfig extends Required<Omit<SdkConfig, 'getToken' | 'tenantSlug' | 'userAgent' | 'getHeaders' | 'fetchImpl' | 'onUnauthorized'>> {
  getToken?: SdkConfig['getToken'];
  tenantSlug?: string;
  userAgent?: string;
  getHeaders?: SdkConfig['getHeaders'];
  fetchImpl: typeof fetch;
  onUnauthorized?: SdkConfig['onUnauthorized'];
}

export function resolveConfig(c: SdkConfig): ResolvedConfig {
  if (!c.baseUrl) throw new Error('SDK: baseUrl is required');
  const fetchImpl = c.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!fetchImpl) throw new Error('SDK: no fetch available — pass config.fetchImpl');
  return {
    baseUrl: c.baseUrl.replace(/\/+$/, ''),
    apiVersion: c.apiVersion ?? 'v1',
    timeoutMs: c.timeoutMs ?? 10000,
    retries: Math.max(0, c.retries ?? 2),
    getToken: c.getToken,
    tenantSlug: c.tenantSlug,
    userAgent: c.userAgent,
    getHeaders: c.getHeaders,
    fetchImpl,
    onUnauthorized: c.onUnauthorized,
  };
}
