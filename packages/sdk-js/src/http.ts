// @krishalaya/sdk-js · the transport. One bounded, resilient request primitive every resource client uses.
// Guarantees: a per-request timeout via AbortController (no hung renders); RETRY only for IDEMPOTENT GETs on
// transient failures (network/timeout/5xx) with exponential backoff + jitter — a mutation (POST/PATCH/…) is
// NEVER auto-retried (Law 3: a non-idempotent call must fail loudly, never silently double-fire); the API's
// {data, meta} envelope is unwrapped; a non-2xx becomes a typed SdkError carrying only safe fields (no token).
//
// REACTIVE 401 recovery: when `config.onUnauthorized` is set, a 401 on a non-anonymous request triggers ONE
// refresh + ONE retry of the original request (any method — a mutation gets retried too here, since the first
// attempt never reached the server as "processed": a 401 means the API rejected it for auth, not business
// logic, so this is not a double-fire of Law 3). Concurrent 401s across in-flight requests share a SINGLE
// refresh call (see `refreshInFlight`) — refresh tokens ROTATE, so a second concurrent refresh with the
// now-stale token would fail or invalidate the whole session.
import { ResolvedConfig } from './config';
import { SdkError, SdkNetworkError, SdkTimeoutError } from './errors';

/** True in dev bundles: RN injects __DEV__; web/node builds use NODE_ENV. Resolved via globalThis so
 * plain tsc (no DOM/node types) compiles and production tree-shaking stays unaffected. */
function sdkIsDev(): boolean {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__DEV__ === 'boolean') return g.__DEV__ as boolean;
  const env = (g.process as { env?: { NODE_ENV?: string } } | undefined)?.env;
  return env ? env.NODE_ENV !== 'production' : false;
}


export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  idempotencyKey?: string;       // required by the API for POSTs that mutate; passed through as a header
  signal?: AbortSignal;          // caller cancellation (composed with the timeout)
  anonymous?: boolean;           // skip attaching the bearer token (public endpoints)
}
export interface Envelope<T> { data: T; meta?: Record<string, unknown>; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  /** The single shared in-flight refresh promise (per client instance) — set the instant the first 401 starts a
   * refresh, cleared once it settles, so every 401 that lands while a refresh is running awaits the SAME promise
   * instead of firing its own concurrent refresh call. */
  private refreshInFlight: Promise<boolean> | undefined;

  constructor(private readonly config: ResolvedConfig) {}

  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
    return this.attempt<T>(method, path, opts, false);
  }

  /** `isUnauthorizedRetry` is true only on the ONE retry issued after a successful refresh — it disables a
   * second recovery attempt for this same logical request, which is what bounds the loop to a single retry. */
  private async attempt<T>(method: HttpMethod, path: string, opts: RequestOptions, isUnauthorizedRetry: boolean): Promise<Envelope<T>> {
    const url = this.buildUrl(path, opts.query);
    const isIdempotent = method === 'GET';
    const maxAttempts = isIdempotent ? this.config.retries + 1 : 1;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.once<T>(method, url, opts);
      } catch (err) {
        lastErr = err;
        if (!isUnauthorizedRetry && this.isRecoverableUnauthorized(err, opts)) {
          const refreshed = await this.refreshOnce();
          // Rebuild the request from scratch (fresh header pass → `getToken()` reads the just-refreshed token);
          // `opts` — and therefore `opts.idempotencyKey` — is the SAME object, so a POST retry reuses the
          // identical Idempotency-Key rather than minting a new one.
          if (refreshed) return this.attempt<T>(method, path, opts, true);
          throw err;   // refresh declined/failed → surface the ORIGINAL 401, not a refresh error
        }
        const retryable = isIdempotent && this.isRetryable(err) && attempt < maxAttempts;
        if (!retryable) throw err;
        await sleep(Math.min(1000, 100 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 50));   // backoff + jitter
      }
    }
    throw lastErr;   // unreachable, but satisfies the type
  }

  /** A 401 is recoverable only when: the callback is configured, the request carried a bearer token (never for
   * `anonymous: true` calls — that would make auth/refresh itself try to refresh on its own 401), and it's the
   * request's first 401 (guarded by the caller via `isUnauthorizedRetry`). */
  private isRecoverableUnauthorized(err: unknown, opts: RequestOptions): boolean {
    return err instanceof SdkError && err.status === 401 && !opts.anonymous && !!this.config.onUnauthorized;
  }

  /** Single-flight: the first caller starts the refresh and stores the promise; every caller that arrives while
   * it is still running (there is no `await` between the check and the assignment, so no interleaving is
   * possible in JS's single-threaded event loop) gets the SAME promise instead of invoking the callback again. */
  private refreshOnce(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = Promise.resolve()
        .then(() => this.config.onUnauthorized!())
        .catch(() => false)
        .finally(() => { this.refreshInFlight = undefined; });
    }
    return this.refreshInFlight;
  }

  private async once<T>(method: HttpMethod, url: string, opts: RequestOptions): Promise<Envelope<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await this.config.fetchImpl(url, {
        method,
        headers: await this.headers(method, opts),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? safeParse(text) : {};
      if (!res.ok) {
        // The API's real error wire-shape (core/http/exception.filter's AllExceptionsFilter) is
        // { error: { code, message, details }, meta: { request_id, timestamp } } — NOT a flat
        // {code,message,requestId} object. Accept both: unwrap `error` when present (the real contract), else
        // fall back to a flat body (defensive — also keeps older/hand-rolled test fixtures working).
        type ErrShape = { code?: string; message?: string; requestId?: string; details?: Record<string, unknown>; [k: string]: unknown };
        const raw = (json ?? {}) as { error?: ErrShape; meta?: { request_id?: string } } & ErrShape;
        const e: ErrShape = raw.error ?? raw;
        const requestId = e.requestId ?? raw.meta?.request_id ?? res.headers.get('x-request-id') ?? undefined;
        // S6-prep DEV LOGGING: surface every API error in the client terminal (Metro / browser
        // console) so a founder can copy-paste the real reason instead of guessing from a generic
        // toast. Gated off in production bundles (RN injects __DEV__; web/node use NODE_ENV).
        // MF-12: use console.log (NOT .warn) — Expo/Metro renders warnings as intrusive on-screen
        // yellow toasts; expected/handled 4xx (e.g. flag-OFF module 404s) shouldn't nag the founder.
        // The line still prints in the Metro terminal for copy-paste debugging.
        if (sdkIsDev()) {
          // eslint-disable-next-line no-console
          console.log(
            `[sdk] ${method} ${url} → ${res.status} ${e.code ?? 'API_ERROR'}: ${e.message ?? ''}` +
            (requestId ? ` (requestId ${requestId})` : ''),
            e.details ?? '',
          );
        }
        throw new SdkError(e.code ?? 'API_ERROR', res.status, e.message ?? `HTTP ${res.status}`, requestId, e.details ?? e);
      }
      return (json && typeof json === 'object' && 'data' in (json as object)) ? (json as Envelope<T>) : { data: json as T };
    } catch (err) {
      if (err instanceof SdkError) throw err;
      if (controller.signal.aborted) throw new SdkTimeoutError(this.config.timeoutMs);
      throw new SdkNetworkError(err instanceof Error ? err.message : 'network error', err);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async headers(method: HttpMethod, opts: RequestOptions): Promise<Record<string, string>> {
    const h: Record<string, string> = { accept: 'application/json' };
    // Caller-supplied extra headers (e.g. a device-integrity risk signal) are applied FIRST so the reserved
    // headers below always win — a caller can never override auth/idempotency/tenant/content-type.
    if (this.config.getHeaders) {
      try {
        const extra = await this.config.getHeaders();
        for (const [k, v] of Object.entries(extra)) {
          const key = k.toLowerCase();
          if (key === 'authorization' || key === 'idempotency-key' || key === 'x-tenant-slug' || key === 'content-type' || key === 'accept') continue;
          if (typeof v === 'string') h[key] = v;
        }
      } catch { /* extra headers are best-effort; never block a request (degrade) */ }
    }
    if (opts.body !== undefined) h['content-type'] = 'application/json';
    if (this.config.tenantSlug) h['x-tenant-slug'] = this.config.tenantSlug;
    if (this.config.userAgent) h['user-agent'] = this.config.userAgent;
    if (opts.idempotencyKey && method !== 'GET') h['idempotency-key'] = opts.idempotencyKey;
    if (!opts.anonymous && this.config.getToken) {
      const token = await this.config.getToken();
      if (token) h.authorization = `Bearer ${token}`;
    }
    return h;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const clean = path.replace(/^\/+/, '');
    let url = `${this.config.baseUrl}/${this.config.apiVersion}/${clean}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.append(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    return url;
  }
  private isRetryable(err: unknown): boolean {
    if (err instanceof SdkTimeoutError) return true;
    if (err instanceof SdkNetworkError) return true;
    if (err instanceof SdkError) return err.status >= 500 || err.status === 429;
    return false;
  }
}
function safeParse(text: string): unknown { try { return JSON.parse(text); } catch { return { message: text.slice(0, 300) }; } }
