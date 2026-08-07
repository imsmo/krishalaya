// core/tenancy-context/tenant-resolver.ts
// Verifies the access token (via TokenService — the single verification path) and
// extracts the caller's identity + server-resolved grants. The token's roles/perms
// were resolved from the DB (RoleCache) at login/refresh and signed; the client
// cannot inject its own. Returns null when no/invalid token (anonymous) so the
// middleware can still serve @Public reads.
import { Injectable } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import { AppConfig } from '../config/app-config';
import {
  ImpersonationClaims, ImpersonationTokenError, looksLikeImpersonationToken, verifyImpersonationToken,
} from '../auth/impersonation-token';

export interface ResolvedPrincipal {
  userId: string; tenantId: string; sessionId: string; roles: string[]; permissions: string[];
  /** PC-56 ADMIN-9b: set when the bearer was an act-as token. The middleware turns this into
   *  `RequestContext.impersonation` AFTER the grant gate has confirmed the session is still live — the resolver only
   *  establishes WHO the token claims to be, never that the session is permitted. */
  impersonation?: ImpersonationClaims;
}

@Injectable()
export class TenantResolver {
  constructor(
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  fromAuthHeader(authHeader?: string): ResolvedPrincipal | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const raw = authHeader.slice('Bearer '.length).trim();

    // PC-56 ADMIN-9b · THE ACT-AS BRANCH. Checked first and cheaply (an unverified `typ` peek, used only to choose a
    // verifier and never to grant anything), so an ordinary access token never pays for a second signature check.
    if (looksLikeImpersonationToken(raw)) {
      const cfg = this.config.impersonation;
      // Not configured = the token is simply unrecognised, which is exactly how this realm behaved before the verifier
      // existed: fail-closed, and an anonymous result rather than a hint about which secret was missing.
      if (!cfg.enabled) return null;
      try {
        const claims = verifyImpersonationToken(raw, cfg);
        return {
          userId: claims.targetUserId,
          tenantId: claims.targetTenantId,
          // NO SESSION ID. An act-as token carries a grant, not a session: reusing `sid` here would let an impersonated
          // request appear in the target's own session list as though they had signed in.
          sessionId: '',
          // **NO ROLES AND NO PERMISSIONS FROM THE TOKEN.** The act-as token deliberately embeds none, and inventing
          // them here would be the console granting itself access. They are resolved from the DATABASE for the target
          // user by the middleware — the same `RoleCacheService` that answers for the target's own sessions, so an
          // operator can never see more than the person whose account they opened.
          roles: [],
          permissions: [],
          impersonation: claims,
        };
      } catch (e) {
        // A malformed or expired act-as token is anonymous, not a 500. `AuthGuard` then produces the ordinary 401 for a
        // protected route, which is the same answer any other bad bearer gets.
        if (e instanceof ImpersonationTokenError) return null;
        throw e;
      }
    }

    const c = this.tokens.verifyAccessToken(raw);
    if (!c || !c.sub) return null;
    return { userId: c.sub, tenantId: c.tid, sessionId: c.sid, roles: c.roles, permissions: c.perms };
  }
}
