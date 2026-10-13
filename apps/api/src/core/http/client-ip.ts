// core/http/client-ip.ts · PC-56 STORE-1a · A1 (founder decision D3) — THE ONE ANSWER TO "WHICH CLIENT MADE THIS REQUEST".
//
// WHY. Every storefront page is rendered by the storefront's Next server, so every buyer's API call arrives from ONE address: keyed on
// `req.ip`, the OTP route's 5-per-minute budget was a SITE-WIDE budget and the sixth buyer in a minute got nothing (survey F-1). The
// storefront server therefore forwards the buyer's address in `x-kv-client-ip`, with `x-kv-client-ts` (unix seconds) and
// `x-kv-client-sig` = hex HMAC-SHA256 over `${ip}|${ts}` with STOREFRONT_CALLER_SECRET. The forwarded address is honoured ONLY when:
//   • the secret is configured (production requires it — app-config), AND
//   • the timestamp is within ±300 s of now (a captured header set dies in five minutes), AND
//   • the address is a literal IPv4/IPv6 address, AND
//   • the signature verifies (constant-time compare).
// Anything else — no secret, a stale or future timestamp, a forged or missing signature, a hostname — is IGNORED, never an error, and
// the answer is `req.ip` (Express's own trust-proxy reading, main.ts). A caller who can forge the header gains nothing it did not have.
// Per-phone OTP limits (core/auth/otp.service) are untouched by any of this and still apply to every request.
//
// ONE FUNCTION, TWO USERS. The rate-limit guard's key subject AND every identity controller's audit `ip` read `clientIpOf(req)`, the value
// `ClientIpMiddleware` computed once per request with `effectiveClientIp` — so a login event never records a different address from the
// one its rate limit counted. Before this wave the identity controllers read the raw, client-supplied `X-Forwarded-For` (spoofable).
//
// The signing half lives in the storefront (`apps/web-storefront/src/lib/caller-sign.ts`); `clientIpSignature` below and its copy there
// are kept identical by a drift spec on the storefront side plus the same known-answer vector in both test suites.
import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { AppConfig } from '../config/app-config';

export const CLIENT_IP_HEADER = 'x-kv-client-ip';
export const CLIENT_TS_HEADER = 'x-kv-client-ts';
export const CLIENT_SIG_HEADER = 'x-kv-client-sig';
/** How far a signed timestamp may be from the API's clock, either way. */
export const CLIENT_SIG_MAX_SKEW_SEC = 300;

/** The signature both sides compute. Hex HMAC-SHA256 over `${ip}|${ts}`. */
export function clientIpSignature(ip: string, ts: string, secret: string): string {
  return createHmac('sha256', secret).update(`${ip}|${ts}`).digest('hex');
}

type HeaderBag = Record<string, string | string[] | undefined>;
const one = (h: HeaderBag, k: string): string => { const v = h[k]; return (Array.isArray(v) ? v[0] : v ?? '').trim(); };

/** The forwarded address when (and only when) the signed header set verifies; otherwise null. Pure. */
export function verifiedForwardedIp(headers: HeaderBag, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): string | null {
  if (!secret) return null;
  const ip = one(headers, CLIENT_IP_HEADER);
  const ts = one(headers, CLIENT_TS_HEADER);
  const sig = one(headers, CLIENT_SIG_HEADER).toLowerCase();
  if (!ip || !ts || !sig) return null;
  if (ip.length > 45 || isIP(ip) === 0) return null;
  if (!/^\d{1,12}$/.test(ts) || Math.abs(nowSec - Number(ts)) > CLIENT_SIG_MAX_SKEW_SEC) return null;
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const want = Buffer.from(clientIpSignature(ip, ts, secret), 'hex');
  const got = Buffer.from(sig, 'hex');
  return want.length === got.length && timingSafeEqual(want, got) ? ip : null;
}

/** The client address this request is accounted to: the verified forwarded address, else Express's `req.ip`. */
export function effectiveClientIp(req: Pick<Request, 'headers' | 'ip' | 'socket'>, secret: string, nowSec?: number): string | null {
  return verifiedForwardedIp(req.headers as HeaderBag, secret, nowSec) ?? (req.ip || (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress || null);
}

const KEY = Symbol.for('kv.clientIp');
type WithClientIp = { [KEY]?: string | null };

/** What `ClientIpMiddleware` decided for this request (falls back to `req.ip` where the middleware did not run, e.g. a bare unit test). */
export function clientIpOf(req: Pick<Request, 'ip' | 'socket'>): string | null {
  const memo = (req as unknown as WithClientIp)[KEY];
  if (memo !== undefined) return memo;
  return req.ip || (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress || null;
}

/** Computes `effectiveClientIp` ONCE per request, before the tenant context and every guard. */
@Injectable()
export class ClientIpMiddleware implements NestMiddleware {
  constructor(@Optional() private readonly config?: AppConfig) {}
  use(req: Request, _res: Response, next: NextFunction): void {
    (req as unknown as WithClientIp)[KEY] = effectiveClientIp(req, this.config?.storefrontCallerSecret ?? '');
    next();
  }
}
