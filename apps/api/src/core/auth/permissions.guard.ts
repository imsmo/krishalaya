// core/auth/permissions.guard.ts
// Dynamic RBAC enforcement (Law 9). @RequirePermissions(...) sets metadata; the
// guard reads the caller's resolved permission set from RequestContext (role
// grants + per-user overrides, loaded by the tenant-context middleware) and
// allows only if ALL required permissions are present ('*' = platform god-mode).
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRequestContext } from '../tenancy-context/request-context';
import { ForbiddenError } from '../../shared/errors/app-error';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
// PC-56 OPS-2a (survey F-14): an act two different parties may take (a storage booking's cancel — the depositor holds `warehouse.store`, the
// warehouse's operator `warehouse.manage`) needs a guard that admits EITHER. `RequireAnyPermission` is that guard's metadata: allowed only if AT
// LEAST ONE listed permission is present. It is additive — `RequirePermissions` (ALL) is unchanged, and a handler may carry both.
export const ANY_PERMISSIONS_KEY = 'required_any_permissions';
export const RequireAnyPermission = (...perms: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, perms);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (required.length === 0 && anyOf.length === 0) return true;
    const rc = getRequestContext();
    const ok = required.every((p) => rc.permissions.has(p) || rc.permissions.has('*'));
    if (!ok) throw new ForbiddenError(`Missing permission(s): ${required.join(', ')}`, { required });
    if (anyOf.length > 0 && !anyOf.some((p) => rc.permissions.has(p) || rc.permissions.has('*'))) throw new ForbiddenError(`Missing any of: ${anyOf.join(', ')}`, { anyOf });
    return true;
  }
}
