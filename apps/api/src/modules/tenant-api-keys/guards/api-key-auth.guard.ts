// modules/tenant-api-keys/guards/api-key-auth.guard.ts · PC-56 TENANT-13c (F-9) · THE KEY GATE ON EVERY ROUTE.
//
// GLOBAL (APP_GUARD), for the reason 9c gave the auditor guard: a rule that has to be remembered on each new route is a rule that will
// be forgotten on one. For a request that did NOT arrive with a tenant key this guard does nothing. For one that did:
//   0. a refused key (the middleware recorded why)            → that refusal, on every route (401 / 403 / 404 by kind);
//   1. the route must carry `@ApiScopes(<scope>)`              → else 403 API_KEY_ROUTE_NOT_ACCEPTED. Only the catalogue's routes
//      accept key auth — a spec over the real router proves the decorated set equals the catalogue;
//   2. the key must hold that scope EXACTLY                    → else 403 API_KEY_SCOPE_MISSING (no wildcard, no prefix family);
//   3. a WRITE scope demands an Idempotency-Key                → else 400 (Law 3; the interceptor then replays a retried write);
//   4. the per-key hourly quota (rate_per_hour)                → else 429 with `Retry-After` = seconds to the window's end;
//   5. last_used_at stamped, at most once a minute (cache window + the database's own debounce).
// The route's own guards (AuthGuard, PermissionsGuard, flag) still run after this one, against the creator's CURRENT permissions.
//
// QUOTA FAILURE MODE (the partner realm's, documented): a cache outage falls OPEN — metered by the global IP limit instead — so an
// integration is not shut out by our cache being down.
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { API_SCOPES_KEY } from '../../../core/auth/api-key.port';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { tryGetRequestContext } from '../../../core/tenancy-context/request-context';
import { AppError } from '../../../shared/errors/app-error';
import { hasScope, isWriteScope } from '../domain/api-scopes';
import { HOUR_MS, rateWindowKey, secondsToWindowEnd, touchWindowKey } from '../domain/api-key.rules';
import {
  ApiKeyExpiredError, ApiKeyIdempotencyRequiredError, ApiKeyInvalidError, ApiKeyOwnerLostAccessError, ApiKeyPendingCheckerError, ApiKeyQuotaError,
  ApiKeyRevokedError, ApiKeyRouteNotAcceptedError, ApiKeyScopeMissingError, ApiKeysDisabledError, PlanFeatureRequiredError,
} from '../domain/tenant-api-keys.errors';
import { ApiKeyRepository } from '../repositories/api-key.repository';

/** 8–64: the scoped idempotency record (`<key id>::<endpoint digest>::<this>`) must fit idempotency_keys.key varchar(120). */
export const KEY_IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function refusalError(r: { code: string; keyPrefix?: string }): AppError {
  switch (r.code) {
    case 'KEY_REVOKED': return new ApiKeyRevokedError(r.keyPrefix);
    case 'KEY_EXPIRED': return new ApiKeyExpiredError(r.keyPrefix);
    case 'KEY_PENDING_CHECKER': return new ApiKeyPendingCheckerError(r.keyPrefix);
    case 'KEY_OWNER_LOST_ACCESS': return new ApiKeyOwnerLostAccessError(r.keyPrefix);
    case 'PLAN_FEATURE_REQUIRED': return new PlanFeatureRequiredError();
    case 'API_KEYS_DISABLED': return new ApiKeysDisabledError();
    default: return new ApiKeyInvalidError();
  }
}

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: ApiKeyRepository,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rc = tryGetRequestContext();
    if (!rc || (!rc.apiKey && !rc.apiKeyRefusal)) return true;           // not a key request: not this guard's business
    if (ctx.getType() !== 'http') throw new ApiKeyRouteNotAcceptedError();
    if (rc.apiKeyRefusal || !rc.apiKey) throw refusalError(rc.apiKeyRefusal ?? { code: 'API_KEY_INVALID' });
    const key = rc.apiKey;

    // HANDLER-level metadata only: a scope is declared per route, never inherited from a controller.
    const required = this.reflector.get<string | undefined>(API_SCOPES_KEY, ctx.getHandler());
    if (!required) { this.metrics.inc('tenant_api.denied', { reason: 'route' }); throw new ApiKeyRouteNotAcceptedError(); }
    if (!hasScope(key.scopes, required)) { this.metrics.inc('tenant_api.denied', { reason: 'scope' }); throw new ApiKeyScopeMissingError(required); }

    const req = ctx.switchToHttp().getRequest<Request>();
    if (isWriteScope(required) && req.method !== 'GET') {
      const idem = String(req.headers['idempotency-key'] ?? '');
      if (!KEY_IDEM_RE.test(idem)) throw new ApiKeyIdempotencyRequiredError();
    }

    const now = Date.now();
    let count: number | null = null;
    try { count = await this.cache.incr(rateWindowKey(key.keyId, now), Math.ceil(HOUR_MS / 1000)); }
    catch { this.metrics.inc('tenant_api.quota_unmetered'); }
    if (count !== null && count > key.ratePerHour) {
      const retryAfter = secondsToWindowEnd(now);
      ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter));
      this.metrics.inc('tenant_api.denied', { reason: 'quota' });
      throw new ApiKeyQuotaError(key.ratePerHour, retryAfter);
    }
    void this.touch(key.keyId, now);
    return true;
  }

  private async touch(keyId: string, nowMs: number): Promise<void> {
    try {
      const n = await this.cache.incr(touchWindowKey(keyId, nowMs), 120);
      if (n === 1) await this.repo.touch(keyId);
    } catch { /* an observability nicety — never fails a call */ }
  }
}
