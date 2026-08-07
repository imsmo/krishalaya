// apps/admin-api/src/core/auth/step-up-reauth.guard.ts · sensitive god-mode mutations require a RECENT strong
// re-auth (JIT elevation). The token's auth_time must be within ADMIN_STEP_UP_MAX_AGE_SEC of now; otherwise the
// operator must re-authenticate. Throws 403 when stale or absent (fail-closed). Runs after AdminAuthGuard.
//
// PC-56 ADMIN-9: the outcome is recorded, and a REFUSAL carries the age that caused it — "your last strong re-auth was
// 41 minutes ago and the limit is 15" is actionable, where "step-up required" leaves an operator guessing whether the
// problem is their key, their session or their permissions.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AdminConfig } from '../config/admin-config';
import { AdminRequestContext } from './admin-auth.guard';
import { OperatorRegistryRepository } from './operator-registry.repository';

@Injectable()
export class StepUpReauthGuard implements CanActivate {
  constructor(
    private readonly config: AdminConfig,
    private readonly registry: OperatorRegistryRepository,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const admin: AdminRequestContext | undefined = req.admin;
    const nowSec = Math.floor(Date.now() / 1000);
    const maxAge = this.config.env.ADMIN_STEP_UP_MAX_AGE_SEC;
    const ageSec = admin?.authTimeSec ? nowSec - admin.authTimeSec : null;
    const ok = !!admin && ageSec !== null && ageSec <= maxAge;

    if (admin && this.config.env.ADMIN_OPERATOR_REGISTRY_ENABLED) {
      void this.registry.recordStepUp({
        adminUserId: admin.userId, sessionId: admin.sessionId || null, gate: 'step_up',
        actionRoute: `${req.method} ${req.route?.path ?? req.url}`,
        outcome: ok ? 'verified' : 'refused',
        detail: ok ? null
          : ageSec === null ? 'the token carried no auth_time, so the age of the last strong re-auth is unknown'
            : `the last strong re-auth was ${ageSec}s ago; the limit is ${maxAge}s`,
        ip: admin.ip, userAgent: String(req.headers?.['user-agent'] ?? '') || null,
      }).catch(() => undefined);
    }

    if (!ok) throw new ForbiddenException('step-up re-authentication required for this operation');
    return true;
  }
}
