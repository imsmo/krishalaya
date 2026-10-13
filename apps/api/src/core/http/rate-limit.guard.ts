// core/http/rate-limit.guard.ts
// Edge rate limiting — the first shield against bots, scrapers, and credential-stuffing
// (CLAUDE.md Law 12 / guide §4 abuse-control). Fixed-window counter in Redis (atomic
// incr) keyed per route × subject (ip | user | tenant). Applied GLOBALLY with a safe
// default; sensitive routes tighten it with @RateLimit({...}). Exceeding → 429 with
// Retry-After. Fails OPEN only on cache outage (never blocks all traffic on a Redis blip),
// but per-route strict limits on auth can opt to fail closed if needed.
import { CanActivate, ExecutionContext, Injectable, SetMetadata, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { CACHE_SERVICE, CacheService } from '../cache/cache.service';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { TooManyRequestsError } from '../../shared/errors/app-error';
import { clientIpOf } from './client-ip';

export interface RateLimitOpts { limit: number; windowSec: number; by?: 'ip' | 'user' | 'tenant' }
export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (opts: RateLimitOpts) => SetMetadata(RATE_LIMIT_KEY, opts);

const DEFAULT: RateLimitOpts = { limit: 300, windowSec: 60, by: 'ip' }; // generous default for every route

function clientIp(req: Request): string {
  // req.ip is derived by Express from X-Forwarded-For ONLY for the configured number of
  // trusted proxy hops (see main.ts `trust proxy`), so a client cannot spoof it by adding
  // its own X-Forwarded-For. Never read the raw header here.
  // PC-56 STORE-1a · A1 (D3): the subject is `clientIpOf(req)` — the storefront's SIGNED client address when it verifies
  // (core/http/client-ip.ts), else exactly that req.ip. Every buyer behind the storefront server now has their own bucket.
  return clientIpOf(req) || 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(CACHE_SERVICE) private readonly cache: CacheService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const opts = this.reflector.getAllAndOverride<RateLimitOpts>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]) ?? DEFAULT;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const rc = tryGetRequestContext();

    const subject = opts.by === 'user' ? (rc?.userId || clientIp(req))
      : opts.by === 'tenant' ? (rc?.tenantId || clientIp(req))
      : clientIp(req);
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const windowStart = Math.floor(Date.now() / 1000 / opts.windowSec);
    const key = `rl:${route}:${opts.by ?? 'ip'}:${subject}:${windowStart}`;

    let count: number;
    try {
      count = await this.cache.incr(key, opts.windowSec);
    } catch {
      return true; // cache outage → fail open (don't take the whole API down on a Redis blip)
    }
    if (count > opts.limit) {
      res.setHeader('Retry-After', String(opts.windowSec));
      throw new TooManyRequestsError('Rate limit exceeded; slow down.', { limit: opts.limit, windowSec: opts.windowSec });
    }
    return true;
  }
}
