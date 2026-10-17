// modules/partner-console/guards/partner-session.guard.ts · PC-56 PARTNER-0 — the partner realm's three guards, in the order they run:
//
//   1. PartnerConsoleFlagGuard — `partner_console` evaluated with NO tenant and NO user (platform-scoped, founder D6): OFF (or unreadable —
//      FlagsService fails closed) → 404 on every /v1/partner/* route, the FeatureFlagGuard precedent. It deliberately does NOT reuse
//      FeatureFlagGuard: that guard scopes the flag to the request context's tenant, which an anonymous caller can steer with X-Tenant-Id.
//   2. PartnerSessionGuard — the bearer must verify as a PARTNER token (TokenService.verifyPartnerAccessToken: typ 'partner_access', realm
//      'partner', a pid, no tid); a TENANT token is refused here (401 PARTNER_SESSION_REQUIRED) and a partner token is refused by every tenant
//      route (TenantResolver only knows `typ: 'access'` → anonymous → AuthGuard 401). Then ONE control-plane read per request: the token's
//      session is still a live partner session of this person for this partner, and the person still holds an active membership there — the
//      roles and permissions are re-resolved from the DATABASE (a removed member's 15-minute token stops working at once, not at expiry).
//      The partner rides the REQUEST (`req.partnerSession`), never the tenant AsyncLocalStorage context: a partner call has no tenant, and
//      writing a fake one would be a lie the whole stack would believe (0090's rule). The partner id is the TOKEN's — no header is read.
//   3. PartnerPermissionsGuard — every partner route DECLARES what it needs: `@PartnerPermissions(...)`, `@PartnerAnyMember()` (a session,
//      no permission) or `@PartnerPublic()` (sign-in, the invite page). A route that declares nothing is REFUSED (the @PartnerScope rule).
import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../../core/auth/token.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { NotFoundError } from '../../../shared/errors/app-error';
import { clientIpOf } from '../../../core/http/client-ip';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { partnerRefused } from '../domain/partner-console.errors';

export const PARTNER_CONSOLE_FLAG = 'partner_console';
export const PARTNER_PERMS_KEY = 'partner_console_permissions';
export const PARTNER_ANY_MEMBER_KEY = 'partner_console_any_member';
export const PARTNER_PUBLIC_KEY = 'partner_console_public';
/** The partner permissions a route needs (ALL of them). */
export const PartnerPermissions = (...perms: string[]) => SetMetadata(PARTNER_PERMS_KEY, perms);
/** A route any partner member may reach (a session, no permission): me, sign-out, the person's own 2FA. */
export const PartnerAnyMember = () => SetMetadata(PARTNER_ANY_MEMBER_KEY, true);
/** A route that needs NO partner session (sign-in, the public invite lookup / accept). The flag guard still runs. */
export const PartnerPublic = () => SetMetadata(PARTNER_PUBLIC_KEY, true);

export interface PartnerSession {
  userId: string; partnerId: string; sessionId: string; roles: string[]; permissions: ReadonlySet<string>;
  ip: string | null; requestId: string | null;
}
type PartnerRequest = Request & { partnerSession?: PartnerSession; requestId?: string };

/** The partner session PartnerSessionGuard verified. Never populated unless the guard ran and passed. */
export const CurrentPartnerSession = createParamDecorator((_d: unknown, ctx: ExecutionContext): PartnerSession => {
  const req = ctx.switchToHttp().getRequest<PartnerRequest>();
  if (!req.partnerSession) throw partnerRefused('PARTNER_SESSION_REQUIRED');   // unreachable behind the guard; never trust "unreachable"
  return req.partnerSession;
});

@Injectable()
export class PartnerConsoleFlagGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}
  async canActivate(): Promise<boolean> {
    const on = await this.flags.isEnabled(PARTNER_CONSOLE_FLAG, {}).catch(() => false);
    if (!on) throw new NotFoundError('Not found');   // invisible when disabled
    return true;
  }
}

@Injectable()
export class PartnerSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService, private readonly uow: PartnerRealmUnitOfWork, private readonly repo: PartnerConsoleRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false;
    if (this.reflector.getAllAndOverride<boolean>(PARTNER_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<PartnerRequest>();
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1]?.trim() ?? '';
    const claims = bearer ? this.tokens.verifyPartnerAccessToken(bearer) : null;
    if (!claims || !claims.sub || !claims.sid) throw partnerRefused('PARTNER_SESSION_REQUIRED');
    const partnerId = claims.pid;
    const live = await this.uow.run(partnerId, async (tx) => {
      if (!(await this.repo.sessionLiveTx(tx, claims.sid, claims.sub, partnerId))) return null;
      const access = await this.repo.accessTx(tx, claims.sub, partnerId);
      return access.roles.length > 0 ? access : null;
    }, { userId: claims.sub });
    if (!live) throw partnerRefused('PARTNER_SESSION_ENDED');
    req.partnerSession = {
      userId: claims.sub, partnerId, sessionId: claims.sid, roles: live.roles, permissions: new Set(live.permissions),
      ip: clientIpOf(req), requestId: typeof req.requestId === 'string' ? req.requestId : null,
    };
    return true;
  }
}

@Injectable()
export class PartnerPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const at = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PARTNER_PUBLIC_KEY, at)) return true;
    const session = ctx.switchToHttp().getRequest<PartnerRequest>().partnerSession;
    if (!session) throw partnerRefused('PARTNER_SESSION_REQUIRED');
    if (this.reflector.getAllAndOverride<boolean>(PARTNER_ANY_MEMBER_KEY, at)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PARTNER_PERMS_KEY, at);
    if (!required || required.length === 0) throw partnerRefused('PARTNER_ROUTE_UNDECLARED');
    const missing = required.filter((p) => !session.permissions.has(p));
    if (missing.length > 0) throw partnerRefused('PARTNER_PERMISSION_MISSING', { required: missing });
    return true;
  }
}
