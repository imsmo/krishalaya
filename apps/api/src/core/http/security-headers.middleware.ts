// core/http/security-headers.middleware.ts
// Zero-dependency security-header baseline (no helmet in the workspace — everything here is a plain
// res.setHeader call). Runs FIRST in the chain (ahead of request-id/tenant-context — Law 1 amendment)
// so every response, including early error paths, carries these headers.
//   • Strict-Transport-Security — PRODUCTION ONLY. TLS terminates at the ALB; a local/staging pod often
//     answers plain HTTP directly, and HSTS on a non-TLS origin would be actively wrong (browsers would
//     remember and force https:// against an origin that can't serve it).
//   • X-Content-Type-Options / X-Frame-Options / Referrer-Policy — always on, cheap, no downside.
//   • Permissions-Policy — the API only ever serves JSON; geolocation/camera/microphone are consumed by
//     the WEB APPS (browser features), not this origin, so locking them here is pure defence-in-depth.
//   • Cache-Control: no-store — auth (login/OTP/refresh/token) and payments-umbrella routes (payments,
//     payouts, wallet, invoices, settlement-statements, commission-rules) carry tokens/secrets/PII in the
//     response body; nothing here should ever be cached by a shared/browser cache. Only sets it when the
//     route/handler hasn't already set its own Cache-Control (never clobbers a more specific value).
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppConfig } from '../config/app-config';

// Path prefixes (post URI-versioning, e.g. /v1/auth/login) treated as "auth/payment" for no-store.
// Matches the auth controller + every controller mounted under modules/payments.
const NO_STORE_PREFIX = /^\/v\d+\/(auth|payments|payouts|wallet|invoices|settlement-statements|commission-rules)(\/|$)/i;

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (this.config.isProd) {
      // includeSubDomains: every krishalaya.* subdomain (web apps + api) is HTTPS-only. No `preload`
      // yet — that's a one-way door (submission to browser preload lists); revisit once HSTS has run
      // cleanly in prod for a while.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');

    if (NO_STORE_PREFIX.test(req.path) && !res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  }
}
