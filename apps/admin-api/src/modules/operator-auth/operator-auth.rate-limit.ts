// apps/admin-api/src/modules/operator-auth/operator-auth.rate-limit.ts · PC-56 ADMIN-AUTH-1 — rate limits on the sign-in surface.
//
// Per source IP, per bucket, fixed one-minute windows (FixedWindowLimiter — per process; see its header). Runs AFTER the IP
// allowlist middleware (which covers every route in this realm, admin.module.ts) and before any database or IdP work.
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FixedWindowLimiter } from './domain/operator-auth.rules';

export const AUTH_RATE_LIMIT = 'operator_auth_rate_limit';
export interface AuthRateLimitSpec { bucket: string; perMinute: number }

/** sso/start and the callback (20/min per IP): the BROWSER calls these, so the key is the operator's own egress IP (an
 *  office NAT shares one). WebAuthn endpoints (120/min per IP): web-admin's SERVER calls these, so every operator shares
 *  web-admin's egress IP — the per-IP ceiling is deliberately loose there, and the tight limits are per CREDENTIAL instead:
 *  a ticket is burnt after 5 failed ceremonies, and every challenge is single use. */
export const AuthRateLimit = (bucket: string, perMinute: number) => SetMetadata(AUTH_RATE_LIMIT, { bucket, perMinute } as AuthRateLimitSpec);

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  static readonly limiter = new FixedWindowLimiter();
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<AuthRateLimitSpec | undefined>(AUTH_RATE_LIMIT, [ctx.getHandler(), ctx.getClass()]);
    if (!spec) return true;
    const req = ctx.switchToHttp().getRequest();
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
    if (!AuthRateLimitGuard.limiter.take(`${spec.bucket}:${ip}`, spec.perMinute, 60_000)) {
      throw new HttpException({ code: 'AUTH_RATE_LIMITED', message: 'too many attempts; wait a minute and try again' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
