// core/auth/token.service.ts
// JWT minting/verification + refresh-token cryptography. Security design:
//  • ACCESS token is short-lived (default 15m), signed HS256, carries the
//    SERVER-RESOLVED roles+permissions snapshot (resolved from DB via RoleCache at
//    login/refresh — the client never supplies its own permissions). Staleness is
//    bounded by the short TTL; a refresh re-resolves from DB.
//  • REFRESH token is opaque high-entropy random (NOT a JWT) — only a salted SHA-256
//    HASH is stored (sessions.refresh_token_hash); the raw value lives only on the
//    device. Rotated on every refresh (theft-resistant).
//  • iss/aud are always checked; constant-time compare for refresh hashes.
import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config';

export interface AccessTokenClaims {
  sub: string;          // user id
  tid: string;          // tenant id (active tenant for this token)
  sid: string;          // session id (for revocation)
  roles: string[];
  perms: string[];      // flattened permission codes; '*' = platform god-mode
  typ: 'access';
  /** PC-56 TENANT-SW-c: when the token was issued (seconds) — the per-tenant session cut-off compares it (SessionPostureGuard). */
  iat?: number;
}

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  mintAccessToken(input: Omit<AccessTokenClaims, 'typ'>): string {
    const a = this.config.auth;
    return jwt.sign(
      { tid: input.tid, sid: input.sid, roles: input.roles, perms: input.perms, typ: 'access' },
      a.accessSecret,
      { subject: input.sub, issuer: a.issuer, audience: a.audience, expiresIn: a.accessTtlSec, algorithm: 'HS256' },
    );
  }

  verifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      const a = this.config.auth;
      const c = jwt.verify(token, a.accessSecret, { issuer: a.issuer, audience: a.audience, algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (c.typ !== 'access') return null;
      return {
        sub: String(c.sub ?? ''), tid: String((c as any).tid ?? ''), sid: String((c as any).sid ?? ''),
        roles: Array.isArray((c as any).roles) ? (c as any).roles : [],
        perms: Array.isArray((c as any).perms) ? (c as any).perms : [],
        typ: 'access',
        ...(typeof c.iat === 'number' ? { iat: c.iat } : {}),
      };
    } catch { return null; }
  }

  /** New opaque refresh token + its storable hash. Raw token is returned ONCE. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.auth.hashPepper).update(token).digest('hex');
  }

  /** Constant-time compare of a presented refresh token against a stored hash. */
  refreshMatches(presented: string, storedHash: string): boolean {
    const a = Buffer.from(this.hashRefreshToken(presented));
    const b = Buffer.from(storedHash || '');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
