// core/tenancy-context/tenant-context.middleware.ts
// Establishes the per-request ambient RequestContext (AsyncLocalStorage) for the
// WHOLE request. Order (Law 1): request-id → THIS → guards → controller. It:
//   • verifies the JWT (TenantResolver) → user/tenant/roles/permissions, OR
//   • for anonymous storefront reads, takes tenant from the X-Tenant-Id header (uuid)
//     or resolves the public X-Tenant-Slug (e.g. "demo-fpo") → tenant uuid,
//   • resolves the tenant→shard, locale, and request id,
//   • runs the rest of the pipeline inside runWithContext so every layer (repo,
//     service, guard) can read tenant/user without threading them through.
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithContext, RequestContext } from './request-context';
import { TenantResolver } from './tenant-resolver';
import { TenantSlugResolver } from './tenant-slug-resolver';
import { ShardRouter } from '../sharding/shard-router';
import { RoleCacheService } from '../rbac/role-cache.service';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly slugs: TenantSlugResolver,
    private readonly shards: ShardRouter,
    private readonly roles: RoleCacheService,
  ) {}

  // async: anonymous storefront reads carry only an `X-Tenant-Slug`, which we resolve to the tenant uuid via a
  // cached registry lookup. Authoritative sources still win in order (JWT tenant → explicit X-Tenant-Id → slug),
  // so an authenticated request never pays for a slug lookup.
  async use(req: Request & { requestId?: string }, _res: Response, next: NextFunction): Promise<void> {
    const principal = this.resolver.fromAuthHeader(req.headers.authorization);
    const headerTenant = (req.headers['x-tenant-id'] as string | undefined) ?? '';
    let tenantId = principal?.tenantId || headerTenant;
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
