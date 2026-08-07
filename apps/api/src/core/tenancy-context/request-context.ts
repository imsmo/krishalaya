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
