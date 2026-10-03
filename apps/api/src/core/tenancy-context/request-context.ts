// core/tenancy-context/request-context.ts
// The per-request ambient context for the API. Carried in AsyncLocalStorage so any
// layer (repo, service, guard) can read tenant/user/shard/permissions without
// threading them through every signature. Set once by tenant-context.middleware
// after authn + RBAC resolution; immutable for the rest of the request.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  tenantId: string;
  userId: string;            // '' on anonymous read paths; populated after AuthGuard
  sessionId: string;         // '' when anonymous; the access token's session id (sid)
  requestId: string;
  lang: string;              // resolved locale, e.g. 'hi-IN'
  roles: string[];           // role codes granted to the caller in this tenant
  permissions: Set<string>;  // flattened permission keys (role grants + overrides). '*' = god mode
  shardId: number;           // tenant→shard resolution for write routing
  /**
   * PC-56 ADMIN-9b. Present ONLY when this request arrived on an admin-realm act-as token. `userId` is still the
   * IMPERSONATED user, because the reads are made on their behalf and a trail that recorded the operator as the actor of
   * a farmer's page view would be describing a different event. This field is how every other layer learns that the
   * human behind the request is not the account being read.
   */
  impersonation?: {
    grantId: string;
    actorAdminId: string;
    scope: 'read_only';
    reason: string | null;
    expiresAt: Date;
  };
  /**
   * PC-56 TENANT-13c. Present ONLY when this request arrived with a tenant API key (`Bearer kv_live_…`). `tenantId` then came
   * from the KEY ROW (never a header) and `userId` is the key's creator — the person the key acts on behalf of; the synthetic
   * principal is `api_key:<keyId>`, which the audit writer records as the actor role. `refusal` is set instead when a
   * key-shaped bearer was presented and refused: the global ApiKeyAuthGuard answers it on every route.
   */
  apiKey?: {
    keyId: string;
    keyPrefix: string;
    scopes: string[];
    ratePerHour: number;
    onBehalfOf: string;
  };
  apiKeyRefusal?: { code: string; keyPrefix?: string; revokedReason?: string | null };
}

export abstract class RequestContextService { abstract get(): RequestContext; }
export const REQUEST_CONTEXT = Symbol('REQUEST_CONTEXT');

const als = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` bound as the ambient request context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Read the ambient context. Throws if called outside a request scope (programmer error). */
export function getRequestContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new Error('RequestContext accessed outside of a request scope');
  return ctx;
}

/** Best-effort read (returns undefined off-request) — for logging/metrics enrichers. */
export function tryGetRequestContext(): RequestContext | undefined {
  return als.getStore();
}
