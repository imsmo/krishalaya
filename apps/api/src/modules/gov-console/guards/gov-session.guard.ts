// modules/gov-console/guards/gov-session.guard.ts · PC-56 GOV-0 — the government realm's three guards, in the order they run (the
// partner-console shape, 0225 → 0239):
//
//   1. GovConsoleFlagGuard — `gov_console` evaluated with NO tenant and NO user (platform-scoped): OFF (or unreadable — FlagsService fails
//      closed) → 404 on every /v1/gov/* route.
//   2. GovSessionGuard — the bearer must verify as a GOV token (TokenService.verifyGovAccessToken: typ 'gov_access', realm 'gov', an aid, no
//      tid, no pid); a tenant or partner token is refused here (401 GOV_SESSION_REQUIRED), and a gov token is refused by every tenant route
//      (TenantResolver only knows `typ: 'access'` → anonymous → 401) and every partner route. Then ONE control-plane read per request: the
//      session is still a live gov session of this person for this authority, and the person still holds a LIVE membership there (0239's
//      `gov_access`: active AND unexpired) — the roles and permissions are re-resolved from the DATABASE, so a removed or expired member's
//      15-minute token stops at once. The authority is the TOKEN's; no header is read. It rides the REQUEST, never the tenant context.
//   3. GovPermissionsGuard — every gov route DECLARES what it needs: `@GovPermissions(...)`, `@GovAnyMember()` or `@GovPublic()`.
import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../../core/auth/token.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { GovRealmUnitOfWork } from '../../../core/database/gov-realm-uow';
import { NotFoundError } from '../../../shared/errors/app-error';
import { clientIpOf } from '../../../core/http/client-ip';
import { GovConsoleRepository } from '../repositories/gov-console.repository';
import { govRefused } from '../domain/gov-console.errors';

export const GOV_CONSOLE_FLAG = 'gov_console';
export const GOV_PERMS_KEY = 'gov_console_permissions';
export const GOV_ANY_MEMBER_KEY = 'gov_console_any_member';
export const GOV_PUBLIC_KEY = 'gov_console_public';
/** The authority permissions a route needs (ALL of them). */
export const GovPermissions = (...perms: string[]) => SetMetadata(GOV_PERMS_KEY, perms);
/** A route any live member may reach (a session, no permission): me, sign-out. */
export const GovAnyMember = () => SetMetadata(GOV_ANY_MEMBER_KEY, true);
/** A route that needs NO gov session (sign-in steps, refresh). The flag guard still runs. */
export const GovPublic = () => SetMetadata(GOV_PUBLIC_KEY, true);

export interface GovSession {
  userId: string; authorityId: string; sessionId: string; roles: string[]; permissions: ReadonlySet<string>; expiresAt: string | null;
  ip: string | null; requestId: string | null;
}
type GovRequest = Request & { govSession?: GovSession; requestId?: string };

export const CurrentGovSession = createParamDecorator((_d: unknown, ctx: ExecutionContext): GovSession => {
  const req = ctx.switchToHttp().getRequest<GovRequest>();
  if (!req.govSession) throw govRefused('GOV_SESSION_REQUIRED');
  return req.govSession;
});

@Injectable()
export class GovConsoleFlagGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}
  async canActivate(): Promise<boolean> {
    const on = await this.flags.isEnabled(GOV_CONSOLE_FLAG, {}).catch(() => false);
    if (!on) throw new NotFoundError('Not found');
    return true;
  }
}

@Injectable()
export class GovSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService, private readonly uow: GovRealmUnitOfWork, private readonly repo: GovConsoleRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false;
    if (this.reflector.getAllAndOverride<boolean>(GOV_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<GovRequest>();
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1]?.trim() ?? '';
    const claims = bearer ? this.tokens.verifyGovAccessToken(bearer) : null;
    if (!claims || !claims.sub || !claims.sid) throw govRefused('GOV_SESSION_REQUIRED');
    const authorityId = claims.aid;
    const live = await this.uow.run(authorityId, async (tx) => {
      if (!(await this.repo.sessionLiveTx(tx, claims.sid, claims.sub, authorityId))) return null;
      const access = await this.repo.accessTx(tx, claims.sub, authorityId);
      return access.roles.length > 0 ? access : null;
    }, { userId: claims.sub });
    if (!live) throw govRefused('GOV_SESSION_ENDED');
    req.govSession = {
      userId: claims.sub, authorityId, sessionId: claims.sid, roles: live.roles, permissions: new Set(live.permissions), expiresAt: live.expiresAt,
      ip: clientIpOf(req), requestId: typeof req.requestId === 'string' ? req.requestId : null,
    };
    return true;
  }
}

@Injectable()
export class GovPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const at = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(GOV_PUBLIC_KEY, at)) return true;
    const session = ctx.switchToHttp().getRequest<GovRequest>().govSession;
    if (!session) throw govRefused('GOV_SESSION_REQUIRED');
    if (this.reflector.getAllAndOverride<boolean>(GOV_ANY_MEMBER_KEY, at)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(GOV_PERMS_KEY, at);
    if (!required || required.length === 0) throw govRefused('GOV_ROUTE_UNDECLARED');
    const missing = required.filter((p) => !session.permissions.has(p));
    if (missing.length > 0) throw govRefused('GOV_PERMISSION_MISSING', { required: missing });
    return true;
  }
}
