// apps/web-admin/src/lib/admin-client.ts · a thin, resilient fetch client for admin-api (the tenant SDK doesn't
// cover the god-mode realm). Attaches the admin bearer (server-side only), bounds every call with a timeout,
// retries idempotent GETs, unwraps {data,meta}, and maps non-2xx to a typed AdminApiError WITHOUT leaking the
// token. A 403 from admin-api means owner-perm / hardware-key / step-up was not satisfied — surfaced as
// `needsElevation` so the UI can prompt re-auth (admin-api is the authority; the UI only reflects it).
import 'server-only';
import { env } from './env';
import { getAdminToken } from './admin-auth';

/** `details` is the parsed refusal body (e.g. PLATFORM_PAGE_REFUSED's `problems[]`) — never the request or the token. */
export class AdminApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly requestId?: string, public readonly details?: unknown) { super(message); this.name = 'AdminApiError'; }
  get needsElevation() { return this.status === 403; }   // hardware-key / step-up / owner perm required
  get unauthorized() { return this.status === 401; }
}
interface Envelope<T> { data: T; meta?: Record<string, unknown>; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once<T>(method: string, path: string, query?: Record<string, string | number | undefined>): Promise<Envelope<T>> {
  const url = new URL(`${env.serverAdminApiUrl.replace(/\/+$/, '')}/v1/${path.replace(/^\/+/, '')}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.append(k, String(v));
  const token = getAdminToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal, cache: 'no-store' });
    const text = await res.text(); const json = text ? JSON.parse(text) : {};
    if (!res.ok) { const e = json as any; throw new AdminApiError(e?.code ?? 'ADMIN_API_ERROR', res.status, e?.message ?? `HTTP ${res.status}`, e?.requestId, e); }
    return (json && 'data' in json) ? json as Envelope<T> : { data: json as T };
  } finally { clearTimeout(timer); }
}

/** Idempotent GET to admin-api with a bounded retry on transient failure. */
export async function adminGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<Envelope<T>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await once<T>('GET', path, query); }
    catch (e) { lastErr = e; const retry = e instanceof AdminApiError ? e.status >= 500 : true; if (!retry || attempt === 3) throw e; await sleep(100 * attempt); }
  }
  throw lastErr;
}

/** A single mutation call to admin-api — NOT retried (writes must never auto-replay). The bearer is attached
 *  server-side only. A god-mode mutation ALWAYS carries the operator's audit justification: admin-api validates a
 *  mandatory `reason` field in the body, so callers put it there (e.g. `{ reason, ...fields }`). An optional
 *  Idempotency-Key header is forwarded for the (future) endpoints that expose one; admin-api ignores it elsewhere.
 *  Non-2xx maps to the typed AdminApiError (needsElevation on 403) WITHOUT leaking the token. */
type MutateOpts = { body?: unknown; idempotencyKey?: string; query?: Record<string, string | number | undefined> };
async function mutate<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, opts: MutateOpts = {}): Promise<Envelope<T>> {
  const url = new URL(`${env.serverAdminApiUrl.replace(/\/+$/, '')}/v1/${path.replace(/^\/+/, '')}`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) url.searchParams.append(k, String(v));
  const token = getAdminToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text(); const json = text ? JSON.parse(text) : {};
    if (!res.ok) { const e = json as any; throw new AdminApiError(e?.code ?? 'ADMIN_API_ERROR', res.status, e?.message ?? `HTTP ${res.status}`, e?.requestId, e); }
    return (json && 'data' in json) ? json as Envelope<T> : { data: json as T };
  } finally { clearTimeout(timer); }
}

/** POST a god-mode mutation (no auto-retry). Put the mandatory audit `reason` in `body`. */
export function adminPost<T>(path: string, opts?: MutateOpts): Promise<Envelope<T>> { return mutate<T>('POST', path, opts); }
/** PATCH a god-mode mutation (no auto-retry). */
export function adminPatch<T>(path: string, opts?: MutateOpts): Promise<Envelope<T>> { return mutate<T>('PATCH', path, opts); }
/** PUT a god-mode mutation (no auto-retry). */
export function adminPut<T>(path: string, opts?: MutateOpts): Promise<Envelope<T>> { return mutate<T>('PUT', path, opts); }
/** DELETE a god-mode mutation (no auto-retry). */
export function adminDelete<T>(path: string, opts?: MutateOpts): Promise<Envelope<T>> { return mutate<T>('DELETE', path, opts); }
