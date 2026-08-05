// modules/partner-api/guards/partner-key.guard.ts · PC-55 A10. The partner realm's authentication strategy.
// This guard is the ONLY thing standing between a hashed string in a header and a bank's cross-tenant book, so it is
// written to be boring and total. Order of checks, each failing closed:
//   1. shape       — parse the presented key with the pure rules; junk never reaches the DB (one regex, no query).
//   2. existence   — ONE indexed lookup by key_prefix.
//   3. secret      — constant-time SHA-256 comparison (partner-key.rules.secretMatches).
//   4. usability   — is_active AND not revoked (revocation is permanent).
//   5. scope       — the route's @PartnerScope must be present EXACTLY; there is no wildcard scope in this realm.
//   6. quota       — per-KEY fixed hourly window (rate_limit_per_hour is that key's contract).
// Steps 1–4 all fail with the SAME opaque 401 (see domain/partner-api.errors.ts): telling a prefix-prober that a key
// EXISTS but is revoked hands them an oracle. Step 5 speaks plainly — that caller is already authenticated.
//
// The authenticated partner is attached to the request object (`req.partner`) rather than to the tenant
// AsyncLocalStorage RequestContext, because a partner call has NO tenant: writing a fake tenant into that context
// would be a lie the whole stack downstream would then believe. Controllers read it via @CurrentPartner().
//
// QUOTA FAILURE MODE (deliberate, documented): on a Redis outage the quota check falls OPEN — a partner integration
// is not shut out by our cache being down. What still protects the database is the platform's global IP rate limit
// (core/http/rate-limit.guard) plus the hard LIMIT clamp on every book read (max 200 rows), so the worst case is
// "unmetered but bounded", not "unbounded".
//
// The `partner_api` feature flag is enforced by FeatureFlagGuard on the controller, which answers 404 — so while the
// realm is dark, even a perfectly valid key cannot tell that any of this code exists.
import { CanActivate, ExecutionContext, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createParamDecorator } from '@nestjs/common';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { PartnerApiRepository } from '../repositories/partner-api.repository';
import { PartnerKeyRejectedError, PartnerRateLimitError, PartnerScopeMissingError } from '../domain/partner-api.errors';
import { hasScope, isUsable, keyFromHeaders, parseKey, rateWindowKey, secretMatches, touchWindowKey, HOUR_MS } from '../domain/partner-key.rules';

export const PARTNER_SCOPE_KEY = 'partner_scope';
/** Declares the scope a partner key must hold for this route. A route without one is a bug, not a free pass:
 *  the guard REFUSES to authorise when no scope is declared (see canActivate). */
export const PartnerScope = (scope: string) => SetMetadata(PARTNER_SCOPE_KEY, scope);

export interface AuthenticatedPartner { keyId: string; partnerId: string; scopes: string[]; rateLimitPerHour: number }

/** Reads the partner the guard authenticated. Never populated unless PartnerKeyGuard ran and passed. */
export const CurrentPartner = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthenticatedPartner => {
  const req = ctx.switchToHttp().getRequest<Request & { partner?: AuthenticatedPartner }>();
  if (!req.partner) throw new PartnerKeyRejectedError(); // unreachable behind the guard; never trust "unreachable"
  return req.partner;
});

@Injectable()
export class PartnerKeyGuard implements CanActivate {
  private readonly log = new Logger(PartnerKeyGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: PartnerApiRepository,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false; // this realm is HTTP-only; anything else is not authorised by default
    const required = this.reflector.getAllAndOverride<string>(PARTNER_SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) {
      // A partner route that forgot to declare its scope must FAIL, loudly, rather than be reachable unscoped.
      this.log.error(`partner route ${ctx.getClass().name}.${ctx.getHandler().name} declares no @PartnerScope — refusing`);
      throw new PartnerKeyRejectedError();
    }

    const req = ctx.switchToHttp().getRequest<Request & { partner?: AuthenticatedPartner }>();
    const presented = keyFromHeaders(req.headers.authorization, req.headers['x-partner-key'] as string | undefined);
    const parsed = parseKey(presented);
    if (!parsed) this.reject('malformed');

    const row = await this.repo.findKeyByPrefix(parsed.prefix);
    if (!row) this.reject('unknown_prefix');
    if (!secretMatches(parsed.secret, row.keyHash)) this.reject('bad_secret');
    if (!isUsable({ isActive: row.isActive, revokedAt: row.revokedAt })) this.reject('inactive_or_revoked');
    if (!hasScope(row.scopes, required)) {
      this.metrics.inc('partner_api.denied', { reason: 'scope' });
      throw new PartnerScopeMissingError(required);
    }

    const now = Date.now();
    await this.enforceQuota(row.id, row.rateLimitPerHour, now);
    void this.touch(row.id, now); // fire-and-forget, throttled to once a minute

    req.partner = { keyId: row.id, partnerId: row.partnerId, scopes: row.scopes, rateLimitPerHour: row.rateLimitPerHour };
    this.metrics.inc('partner_api.authenticated', { partner: row.partnerId });
    return true;
  }

  /** One opaque 401 for every credential failure; the real reason goes to metrics/logs only. */
  private reject(reason: string): never {
    this.metrics.inc('partner_api.denied', { reason });
    throw new PartnerKeyRejectedError();
  }

  private async enforceQuota(keyId: string, limitPerHour: number, nowMs: number): Promise<void> {
    let count: number;
    try {
      count = await this.cache.incr(rateWindowKey(keyId, nowMs), Math.ceil(HOUR_MS / 1000));
    } catch {
      this.metrics.inc('partner_api.quota_unmetered'); // cache down → fall open (documented in the header)
      return;
    }
    if (count > limitPerHour) {
      this.metrics.inc('partner_api.denied', { reason: 'quota' });
      throw new PartnerRateLimitError(limitPerHour);
    }
  }

  private async touch(keyId: string, nowMs: number): Promise<void> {
    try {
      const n = await this.cache.incr(touchWindowKey(keyId, nowMs), 120);
      if (n === 1) await this.repo.touchLastUsed(keyId);
    } catch { /* observability nicety — never fails a partner's read */ }
  }
}
