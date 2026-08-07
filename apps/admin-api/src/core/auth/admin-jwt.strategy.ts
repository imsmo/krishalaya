// apps/admin-api/src/core/auth/admin-jwt.strategy.ts · self-contained HS256 admin-JWT verification (no external
// JWT lib — same dependency-free posture as the rest of the platform). The FIDO2/step-up ceremony happens at the
// admin login layer; this verifies the resulting short-lived token and surfaces its claims:
//   sub (admin user id), roles (owner roles), amr (auth methods, incl. 'hwk' for hardware key), auth_time (epoch
//   of the last strong re-auth). Pins alg=HS256, checks iss/aud/exp. Constant-time signature compare.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdminConfig } from '../config/admin-config';

export interface AdminPrincipal {
  userId: string;
  roles: string[];
  amr: string[];
  authTimeSec: number;     // epoch seconds of the last strong re-auth (step-up checks freshness)
  sessionId: string;
  /** PC-56 ADMIN-9: the token's own `exp`, carried through so the session registry can tell "revoked by a human" apart
   *  from "expired on its own" without inventing either. */
  expSec: number;
}
export class AdminTokenError extends Error { constructor(msg: string) { super(msg); this.name = 'AdminTokenError'; } }

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Verify + decode an admin access token. Throws AdminTokenError on any failure (fail-closed). */
export function verifyAdminToken(token: string, config: AdminConfig, nowSec = Math.floor(Date.now() / 1000)): AdminPrincipal {
  if (!token) throw new AdminTokenError('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AdminTokenError('malformed token');
  const [h, p, s] = parts;
  let header: any; let payload: any;
  try { header = JSON.parse(b64url(h).toString('utf8')); payload = JSON.parse(b64url(p).toString('utf8')); }
  catch { throw new AdminTokenError('undecodable token'); }
  if (header?.alg !== 'HS256') throw new AdminTokenError('unexpected alg');     // pin algorithm — no alg confusion
  const expected = createHmac('sha256', config.jwt.secret).update(`${h}.${p}`).digest();
  const given = b64url(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AdminTokenError('bad signature');
  if (payload.iss !== config.jwt.issuer) throw new AdminTokenError('bad issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.jwt.audience)) throw new AdminTokenError('bad audience');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) throw new AdminTokenError('token expired');
  if (!payload.sub) throw new AdminTokenError('no subject');
  return {
    userId: String(payload.sub),
    roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
    amr: Array.isArray(payload.amr) ? payload.amr.map(String) : [],
    authTimeSec: typeof payload.auth_time === 'number' ? payload.auth_time : 0,
    sessionId: String(payload.sid ?? ''),
    expSec: payload.exp,
  };
}
