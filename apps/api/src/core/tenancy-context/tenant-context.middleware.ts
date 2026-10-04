// core/tenancy-context/tenant-context.middleware.ts
// Establishes the per-request ambient RequestContext (AsyncLocalStorage) for the
// WHOLE request. Order (Law 1): request-id → THIS → guards → controller. It:
//   • verifies the JWT (TenantResolver) → user/tenant/roles/permissions, OR
//   • for anonymous storefront reads, takes tenant from the X-Tenant-Id header (uuid)
//     or resolves the public X-Tenant-Slug (e.g. "demo-fpo") → tenant uuid,
//   • resolves the tenant→shard, locale, and request id,
//   • runs the rest of the pipeline inside runWithContext so every layer (repo,
//     service, guard) can read tenant/user without threading them through.
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithContext, RequestContext } from './request-context';
import { TenantResolver } from './tenant-resolver';
import { TenantSlugResolver } from './tenant-slug-resolver';
import { ShardRouter } from '../sharding/shard-router';
import { RoleCacheService } from '../rbac/role-cache.service';
import { API_KEY_AUTHENTICATOR, ApiKeyAuthenticator, looksLikeTenantApiKey } from '../auth/api-key.port';
import { FlagsService } from '../feature-flags/flags.service';
import { AppConfig } from '../config/app-config';
import { hostOnly, isPlatformHost } from './host-routing';

/** PC-56 TENANT-13d · B3: the flag that turns Host → tenant resolution on (default OFF; seed 0009 / migration 0194). */
export const HOST_ROUTING_FLAG = 'tenant_host_routing';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly slugs: TenantSlugResolver,
    private readonly shards: ShardRouter,
    private readonly roles: RoleCacheService,
    @Optional() @Inject(API_KEY_AUTHENTICATOR) private readonly apiKeys?: ApiKeyAuthenticator,
    @Optional() private readonly flags?: FlagsService,
    @Optional() private readonly config?: AppConfig,
  ) {}

  /** The Host routing switch; a flag-store failure reads as OFF (Host is then never consulted — the pre-13d behaviour). */
  private async hostRoutingOn(): Promise<boolean> {
    if (!this.flags) return false;
    try { return await this.flags.isEnabled(HOST_ROUTING_FLAG); } catch { return false; }
  }

  private static refuse(res: Response, status: number, code: string, message: string, requestId: string): void {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code, message, details: {} }, meta: { request_id: requestId, timestamp: new Date().toISOString() } }));
  }

  // async: anonymous storefront reads carry only an `X-Tenant-Slug`, which we resolve to the tenant uuid via a
  // cached registry lookup. Authoritative sources still win in order (JWT tenant → explicit X-Tenant-Id → slug),
  // so an authenticated request never pays for a slug lookup.
  async use(req: Request & { requestId?: string }, res: Response, next: NextFunction): Promise<void> {
    // PC-56 TENANT-13c (F-9) · THE KEY BRANCH, decided before anything else reads a tenant. A key-shaped bearer is a key: the
    // tenant comes from the key row and `X-Tenant-Id` / `X-Tenant-Slug` are NEVER read on this branch. A refused key is not
    // anonymous — the refusal rides the context and the global ApiKeyAuthGuard answers it on every route.
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1]?.trim() ?? '';
    if (bearer && looksLikeTenantApiKey(bearer)) {
      const lang0 = ((req.headers['x-lang'] as string) || (req.headers['accept-language'] as string) || 'en-IN').split(',')[0];
      const result = this.apiKeys ? await this.apiKeys.authenticate(bearer) : { ok: false as const, refusal: { code: 'API_KEY_INVALID' as const } };
      const p = result.ok ? result.principal : null;
      const keyCtx: RequestContext = {
        tenantId: p?.tenantId ?? '',
        userId: p?.onBehalfOf ?? '',
        sessionId: '',
        requestId: req.requestId ?? '',
        lang: lang0,
        roles: p?.roles ?? [],
        permissions: new Set(p?.permissions ?? []),
        shardId: p ? this.shards.shardFor(p.tenantId) : 0,
        ...(p
          ? { apiKey: { keyId: p.keyId, keyPrefix: p.keyPrefix, scopes: p.scopes, ratePerHour: p.ratePerHour, onBehalfOf: p.onBehalfOf } }
          : { apiKeyRefusal: result.ok ? { code: 'API_KEY_INVALID' } : result.refusal }),
      };
      runWithContext(keyCtx, () => next());
      return;
    }

    const principal = this.resolver.fromAuthHeader(req.headers.authorization);
    let tenantId = principal?.tenantId || '';
    // PC-56 TENANT-13d · B3 — HOST ROUTING (flag `tenant_host_routing`, default OFF). With no JWT / key tenant, a request that arrives on a
    // TENANT host (not one the platform answers on itself — host-routing.ts) belongs to that host's tenant: only a VERIFIED, live domain
    // of a live tenant answers (0194 `resolve_tenant_host`, the F-24 status filter on the Host path); a tenant Host that matches nothing
    // is 404 TENANT_NOT_FOUND — never a default tenant — and headers cannot redirect such a request to another tenant.
    if (!tenantId && (await this.hostRoutingOn())) {
      const host = hostOnly((req as Request & { hostname?: string }).hostname || (req.headers.host as string | undefined) || '');
      if (!isPlatformHost(host, this.config?.platformHosts ?? [])) {
        const r = await this.slugs.resolveHost(host);
        if (r.error) { TenantContextMiddleware.refuse(res, 503, 'TENANT_RESOLUTION_UNAVAILABLE', 'The organisation for this address could not be looked up — try again', req.requestId ?? ''); return; }
        if (!r.value) { TenantContextMiddleware.refuse(res, 404, 'TENANT_NOT_FOUND', 'No organisation is served at this address', req.requestId ?? ''); return; }
        tenantId = r.value.tenantId;
      }
    }
    if (!tenantId) {
      // PC-56 TENANT-13d (F-24): an anonymous X-Tenant-Id is honoured only for a LIVE tenant — the slug path's own status filter
      const headerTenant = (req.headers['x-tenant-id'] as string | undefined) ?? '';
      if (headerTenant) tenantId = (await this.slugs.resolveId(headerTenant)) ?? '';
    }
    if (!tenantId) {
      const slug = req.headers['x-tenant-slug'] as string | undefined;
      if (slug) tenantId = (await this.slugs.resolve(slug)) ?? '';
    }
    const lang = ((req.headers['x-lang'] as string) || (req.headers['accept-language'] as string) || 'en-IN').split(',')[0];

    let roles = principal?.roles ?? [];
    let permissions = new Set(principal?.permissions ?? []);

    // PC-56 ADMIN-9b · AN ACT-AS TOKEN CARRIES NO PERMISSIONS, AND THAT IS THE DESIGN. They are resolved here, from the
    // database, for the TARGET user — the same `RoleCacheService` that answers for that person's own sessions. So an
    // operator inside somebody's account sees exactly what that person sees and never more: no permission is invented
    // for the session, and a target with a narrow role gives a narrow session.
    //
    // A god-mode `'*'` cannot arrive this way either, because it would have to be a permission the TARGET holds — and
    // if the target really is a tenant super_admin, the operator sees what that admin sees, which is the correct answer
    // and is bounded by the read-only guard regardless.
    if (principal?.impersonation && tenantId) {
      const access = await this.roles.effectiveAccess(principal.userId, tenantId);
      roles = access.roles;
      permissions = new Set(access.permissions);
    }

    const ctx: RequestContext = {
      tenantId,
      userId: principal?.userId ?? '',
      sessionId: principal?.sessionId ?? '',
      requestId: req.requestId ?? '',
      lang,
      roles,
      permissions,
      shardId: tenantId ? this.shards.shardFor(tenantId) : 0,
      ...(principal?.issuedAtSec !== undefined ? { issuedAtSec: principal.issuedAtSec } : {}),
      ...(principal?.impersonation
        ? {
          impersonation: {
            grantId: principal.impersonation.grantId,
            actorAdminId: principal.impersonation.actorAdminId,
            scope: 'read_only' as const,
            // The reason is on the GRANT and is read by the gate on the request path; the middleware does not fetch it
            // twice. Null here means "not yet read", never "no reason was given" — a mandatory column since 0038.
            reason: null,
            expiresAt: new Date(principal.impersonation.expSec * 1000),
          },
        }
        : {}),
    };
    runWithContext(ctx, () => next());
  }
}
