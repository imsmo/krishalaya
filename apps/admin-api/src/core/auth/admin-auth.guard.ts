// apps/admin-api/src/core/auth/admin-auth.guard.ts · authenticates every admin request: verifies the admin JWT
// (self-contained HS256, iss/aud/exp pinned), resolves owner-role permissions from the static catalog, and
// attaches the principal to req.admin. Throws 401 on any failure (fail-closed). No tenant context exists here —
// admin-api is a separate realm (Law 11).
//
// ---------------------------------------------------------------------------------------------------------------
// PC-56 ADMIN-9 · THE GUARD NOW CHECKS THE REALM'S OWN RECORD, NOT ONLY THE TOKEN
// ---------------------------------------------------------------------------------------------------------------
// Until 0118 this guard touched no database. A valid signature was the whole of authorisation, which meant:
//   * a dismissed operator kept full god-mode access until their token expired, and nothing here could shorten that
//     (W104: "Deactivation is immediate and audited — sessions killed... Departing staff are deactivated before the
//     exit conversation, not after." There was no deactivation);
//   * `sid` was minted, carried on the principal, and read by nothing — so signing out deleted a cookie and a copied
//     bearer kept working;
//   * dormancy existed for farmers (`users.last_active_at`) and not for operators, though W439 states a 30/45-day
//     policy as though it were enforced.
//
// So the guard now: reads the operator's row, REFUSES a suspended operator, REFUSES a revoked session, REFUSES and
// auto-suspends an operator past the dormancy line, and SUBTRACTS deny-only restrictions from the catalogue's answer.
//
// **IT CAN ONLY EVER REFUSE OR SUBTRACT.** There is no branch below that adds a permission, because a database row that
// could grant one would make `owner-roles.ts` advisory and hand anything with a write grant a route into god mode
// (Law 5 reflect-never-grant, Law 11).
//
// FAIL-CLOSED ON A READ FAILURE, and this is a deliberate exception to Law 12's degrade-never-die. Law 12 protects a
// farmer whose price chart should still render when a recommender is down. This is the god-mode realm's front door;
// every route behind it needs the same database; and "we could not check whether this operator was dismissed, so we let
// them in" is not a degraded service, it is the absence of the control.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminConfig } from '../config/admin-config';
import { verifyAdminToken, AdminTokenError, AdminPrincipal } from './admin-jwt.strategy';
import { resolveOwnerPermissions, ownerPermissionCodes } from '../rbac/owner-roles';
import { OperatorRegistryRepository } from './operator-registry.repository';
import {
  AccessPolicy, DEFAULT_ACCESS_POLICY, DormancyState, accessVerdict, effectivePermissions, shouldTouch,
} from './operator-access';
import { AccessRefusedError } from '../../modules/platform-staff/domain/platform-staff.errors';

export interface AdminRequestContext extends AdminPrincipal {
  permissions: Set<string>;
  ip: string | null;
  requestId: string;
  /** Null when the realm has never seen this operator before (their first request creates the row) or when the registry
   *  is disabled. A surface that reports dormancy must handle it rather than printing "day 0 of 45" for an unknown. */
  dormancy: DormancyState | null;
  /** The permissions the catalogue gave before restrictions were subtracted, so a 403 can say WHY: "your roles hold
   *  this and a restriction removes it" is a different answer from "your roles do not hold this", and an operator who
   *  cannot tell them apart will escalate the wrong problem. */
  grantedBeforeRestrictions: Set<string>;
  restrictedCodes: string[];
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  /** The policy row changes twice a year and would otherwise be read on every request. Cached for a minute; the ACCESS
   *  DECISION is never cached, only the two thresholds it compares against. */
  private policyCache: { policy: AccessPolicy; fromDatabase: boolean; atMs: number } | null = null;

  constructor(
    private readonly config: AdminConfig,
    private readonly registry: OperatorRegistryRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let principal: AdminPrincipal;
    try { principal = verifyAdminToken(token, this.config); }
    catch (e) { throw new UnauthorizedException(e instanceof AdminTokenError ? e.message : 'unauthorized'); }

    const ip = req.ip ?? req.socket?.remoteAddress ?? null;
    const requestId = String(req.headers?.['x-request-id'] ?? '');
    const granted = resolveOwnerPermissions(principal.roles);

    const admin: AdminRequestContext = {
      ...principal,
      permissions: granted,
      grantedBeforeRestrictions: granted,
      restrictedCodes: [],
      dormancy: null,
      ip,
      requestId,
    };

    if (!this.config.env.ADMIN_OPERATOR_REGISTRY_ENABLED) {
      // The kill-switch exists for ONE reason and it is not convenience: this guard is the front door, and a defect in
      // a brand-new registry read must be recoverable without a deploy. Default ON — a security control that ships off
      // is a security control nobody turns on. When off, the realm behaves exactly as it did before 0118, and the
      // console says so on every screen rather than showing a roster that is no longer consulted.
      req.admin = admin;
      return true;
    }

    const { policy, fromDatabase } = await this.policy();
    const inputs = await this.registry.accessInputs(principal.userId, principal.sessionId);
    const now = new Date();
    const verdict = accessVerdict(inputs.operator, inputs.session, policy, now);

    if (!verdict.allow) {
      if (verdict.autoSuspend) {
        // Recorded BEFORE the throw, so the refusal and the suspension are one event rather than a refusal that
        // depended on somebody later noticing. Best-effort: a failure to write must not turn a refusal into a 500 that
        // the caller might read as a transient error and retry into.
        await this.registry.autoSuspendDormant(principal.userId, policy.suspendAfterDays).catch(() => undefined);
      }
      throw new AccessRefusedError(verdict.reason, verdict.detail);
    }

    admin.dormancy = verdict.dormancy;
    if (inputs.restrictions.length > 0) {
      admin.permissions = effectivePermissions(granted, inputs.restrictions, ownerPermissionCodes(), now);
      admin.restrictedCodes = inputs.restrictions.map((r) => r.permissionCode);
    }
    if (!fromDatabase) {
      // Surfaced on the principal rather than swallowed: a realm enforcing thresholds it could not read should be able
      // to say so on the security page instead of implying the policy row was consulted.
      (admin as AdminRequestContext & { policyFallback?: boolean }).policyFallback = true;
    }

    if (inputs.operator === null || shouldTouch(inputs.operator.lastSeenAt, policy, now)) {
      await this.registry.observe({
        adminUserId: principal.userId,
        sessionId: principal.sessionId,
        ip,
        userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 300) || null,
        roles: principal.roles,
        amr: principal.amr,
        authTimeSec: principal.authTimeSec,
        tokenExpSec: principal.expSec ?? null,
      }).catch(() => undefined);
      // The touch is bookkeeping and is best-effort BY DESIGN. A write failure here must not refuse a request — the
      // check that protects the realm is the READ above, and that one is not best-effort: if it throws, the request
      // fails closed with a 500 and nobody gets in on an unchecked credential.
    }

    req.admin = admin;
    return true;
  }

  private async policy(): Promise<{ policy: AccessPolicy; fromDatabase: boolean }> {
    const nowMs = Date.now();
    if (this.policyCache && nowMs - this.policyCache.atMs < 60_000) {
      return { policy: this.policyCache.policy, fromDatabase: this.policyCache.fromDatabase };
    }
    const read = await this.registry.accessPolicy().catch(() => ({ policy: DEFAULT_ACCESS_POLICY, fromDatabase: false }));
    this.policyCache = { ...read, atMs: nowMs };
    return read;
  }
}
