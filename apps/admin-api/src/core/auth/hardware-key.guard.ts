// apps/admin-api/src/core/auth/hardware-key.guard.ts · enforces FIDO2/hardware-key 2FA for god-mode requests.
// The WebAuthn ceremony happens at admin login; the resulting token carries amr=['hwk',...]. This guard enforces
// that claim is present (when ADMIN_REQUIRE_HARDWARE_KEY is on — always on in production, §4 fail-closed). Throws
// 403 otherwise. Runs after AdminAuthGuard (req.admin populated).
//
// PC-56 ADMIN-9: **THE OUTCOME IS NOW RECORDED, INCLUDING THE REFUSALS.** W439 renders a step-up log whose fourth row
// reads `failed · retried` — and a log of successful elevations only answers "did I re-authenticate" while leaving the
// question a security page exists for: did somebody try to reach a gated action without the key. Nothing was recorded
// before this wave, so that log had no source at all.
//
// **WHAT THIS GUARD CHECKS IS A STRING IN AN ARRAY IN THE TOKEN**, and that is worth being explicit about: `amr`
// containing 'hwk' is the IdP's assertion that a hardware key was used. There is no credential lookup here and there
// cannot be one — `fido2_credentials` (0074) keys on `users(id)`, the TENANT realm's table, so a platform operator has
// no row in it and could not have one without the cross-tenant identity the two-realm split exists to prevent
// (ADMIN-9-Q3). This guard is exactly as strong as the IdP that mints the claim, and no stronger.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AdminConfig } from '../config/admin-config';
import { AdminRequestContext } from './admin-auth.guard';
import { OperatorRegistryRepository } from './operator-registry.repository';

@Injectable()
export class HardwareKeyGuard implements CanActivate {
  constructor(
    private readonly config: AdminConfig,
    private readonly registry: OperatorRegistryRepository,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const admin: AdminRequestContext | undefined = req.admin;
    if (!this.config.env.ADMIN_REQUIRE_HARDWARE_KEY) return true;
    const ok = !!admin && admin.amr.includes('hwk');
    if (admin && this.config.env.ADMIN_OPERATOR_REGISTRY_ENABLED) {
      // Best-effort, and deliberately not awaited: an elevation must not be refused because the log was slow, and it
      // must not be GRANTED because the log was slow either — which is why the decision below does not depend on it.
      void this.registry.recordStepUp({
        adminUserId: admin.userId, sessionId: admin.sessionId || null, gate: 'hardware_key',
        actionRoute: `${req.method} ${req.route?.path ?? req.url}`,
        outcome: ok ? 'verified' : 'refused',
        detail: ok ? null : 'the token carried no hardware-key factor (amr has no \'hwk\')',
        ip: admin.ip, userAgent: String(req.headers?.['user-agent'] ?? '') || null,
      }).catch(() => undefined);
    }
    if (!ok) throw new ForbiddenException('hardware-key (FIDO2) re-auth required');
    return true;
  }
}
