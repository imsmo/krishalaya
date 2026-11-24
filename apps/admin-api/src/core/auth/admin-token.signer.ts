// apps/admin-api/src/core/auth/admin-token.signer.ts · PC-56 ADMIN-AUTH-1 — the ONLY production minter of the admin JWT.
//
// The exact counterpart of `admin-jwt.strategy.ts#verifyAdminToken`: HS256 over this process's ADMIN_JWT_SECRET, `iss`/`aud`
// pinned to this process's own issuer/audience. Same dependency-free posture as the verifier. Called ONLY by the
// operator-auth module after BOTH factors have been proven in this request chain: a verified OpenID Connect id_token
// (amr 'oidc') AND a verified WebAuthn assertion against a credential this realm holds (amr 'hwk'). The dev-login bypass
// keeps its own minter (dev-login.controller.ts, unchanged, never 'hwk').
import { createHmac } from 'node:crypto';
import { AdminConfig } from '../config/admin-config';

export interface AdminTokenClaims {
  sub: string;              // admin_user_id
  roles: string[];          // from the operator's ADMIN_OPERATOR_BINDINGS entry (config), never from a row
  amr: string[];            // ['oidc', 'hwk']
  authTimeSec: number;      // when the hardware key was last used (step-up freshness)
  sid: string;              // platform_operator_sessions.session_id
  expSec: number;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function signAdminToken(c: AdminTokenClaims, config: AdminConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!config.jwt.secret) throw new Error('ADMIN_JWT_SECRET is not configured');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: config.jwt.issuer, aud: config.jwt.audience, sub: c.sub, roles: c.roles, amr: c.amr,
    auth_time: c.authTimeSec, sid: c.sid, iat: nowSec, exp: c.expSec,
  })));
  const sig = b64url(createHmac('sha256', config.jwt.secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
