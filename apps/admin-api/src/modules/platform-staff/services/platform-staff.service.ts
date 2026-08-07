// apps/admin-api/src/modules/platform-staff/services/platform-staff.service.ts · W104 / W438 / W439 (PC-56 ADMIN-9).
//
// The roster, the operator, my-work and my-security. Every figure here is a count of what the realm HAS OBSERVED, and
// the service says so in its payloads — because W104's "Active staff 31 · FIDO2 enrolled 31/31" implies a directory
// this realm cannot read, and a console that quietly renders an observed count under a directory's label is telling the
// reader something false about where the number came from.
import { Injectable } from '@nestjs/common';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminConfig } from '../../../core/config/admin-config';
import { OperatorRegistryRepository } from '../../../core/auth/operator-registry.repository';
import { dormancyOf, effectivePermissions, liveRestrictions } from '../../../core/auth/operator-access';
import { ownerPermissionCodes, resolveOwnerPermissions } from '../../../core/rbac/owner-roles';
import {
  DENY_ONLY_RATIONALE, REVOCATION_TAKES_EFFECT, RESTRICT_ALL, assertReason, assertReinstatable, assertRestrictable,
  assertRevocable, assertSuspendable, isCurrentSession, liveSessionCount, restrictionIsInert, REVOKE_REASON_MIN,
} from '../domain/operator-lifecycle';
import {
  DuplicateRestrictionError, OperatorNotFoundError, OperatorStateError, RestrictionNotFoundError,
} from '../domain/platform-staff.errors';

/** The IdP is the only thing that knows the full staff list, and this realm cannot enumerate it. Named once, quoted by
 *  every surface that shows a count, so the caveat cannot drift away from the number it qualifies. */
export const CENSUS_CAVEAT_OWNER = 'ADMIN-9-Q1' as const;

@Injectable()
export class PlatformStaffService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: OperatorRegistryRepository,
    private readonly audit: AdminAuditWriter,
    private readonly config: AdminConfig,
  ) {}

  /* ---------------------------------------------------------------- W104 · the roster */

  async roster(q: { status?: string; cursor?: string; limit: number }) {
    const { policy, fromDatabase } = await this.repo.accessPolicy();
    const [rows, census] = await Promise.all([
      this.repo.listOperators(q),
      this.repo.census(policy.dormantAfterDays, policy.suspendAfterDays),
    ]);
    const now = new Date();
    const restrictionCounts = await this.restrictionCounts(rows.map((r) => r.adminUserId));

    return {
      data: rows.map((o) => ({
        adminUserId: o.adminUserId,
        status: o.status,
        // "Last seen carrying" and never "role" — the roles column is a mirror of the last token, and an operator's
        // roles can change at the IdP without this realm hearing about it until their next request.
        lastRoles: o.lastRoles,
        lastAmr: o.lastAmr,
        hasHardwareKeyFactor: o.lastAmr.includes('hwk'),
        firstSeenAt: o.firstSeenAt.toISOString(),
        lastSeenAt: o.lastSeenAt.toISOString(),
        requestCount: o.requestCount,
        dormancy: dormancyOf(o.lastSeenAt, policy, now),
        suspendKind: o.suspendKind,
        suspendReason: o.suspendReason,
        suspendedByAdminId: o.suspendedByAdminId,
        reinstateRequestedByAdminId: o.reinstateRequestedByAdminId,
        restrictionCount: restrictionCounts[o.adminUserId] ?? 0,
      })),
      meta: {
        nextCursor: rows.length === q.limit && rows.length > 0
          ? `${rows[rows.length - 1].lastSeenAt.toISOString()}|${rows[rows.length - 1].adminUserId}`
          : null,
        census,
        policy,
        policyFromDatabase: fromDatabase,
        registryEnabled: this.config.env.ADMIN_OPERATOR_REGISTRY_ENABLED,
        // THE CENSUS IS OBSERVED, NOT AUTHORITATIVE, and the payload carries the caveat rather than leaving the console
        // to remember it. An operator the IdP has provisioned but who has never signed in does not appear here at all,
        // and no query this realm can run would find them.
        censusBasis: 'observed',
        censusCaveatOwner: CENSUS_CAVEAT_OWNER,
        // The claim W104 makes that this platform cannot make. `fido2_credentials` exists (0074) and keys on the TENANT
        // realm's `users` table, so no platform operator has a row and none can. What IS knowable is whether the last
        // token carried a hardware-key factor, which is a different and weaker statement, and the console makes it in
        // those words.
        fido2EnrolmentKnown: false,
        fido2Gap: 'ADMIN-9-Q3',
      },
    };
  }

  private async restrictionCounts(ids: string[]): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const out: Record<string, number> = {};
    await Promise.all(ids.map(async (id) => {
      const rs = await this.repo.restrictionsOf(id);
      const live = liveRestrictions(rs, new Date());
      if (live.length > 0) out[id] = live.length;
    }));
    return out;
  }

  /* ---------------------------------------------------------------- W104 · one operator */

  async operator(adminUserId: string) {
    const o = await this.repo.getOperator(adminUserId);
    if (!o) throw new OperatorNotFoundError(adminUserId);
    const { policy } = await this.repo.accessPolicy();
    const now = new Date();
    const [sessions, restrictions, stepUps] = await Promise.all([
      this.repo.sessionsOf(adminUserId),
      this.repo.restrictionsOf(adminUserId, true),
      this.repo.stepUpEvents(adminUserId, 50),
    ]);

    // The effective set, computed with the SAME function the guard uses. A console that re-derived it would eventually
    // disagree with the door, and the disagreement would be invisible until somebody was wrongly refused.
    const granted = resolveOwnerPermissions(o.lastRoles);
    const live = liveRestrictions(restrictions.filter((r) => r.liftedAt === null), now);
    const effective = effectivePermissions(granted, live, ownerPermissionCodes(), now);

    return {
      adminUserId: o.adminUserId,
      status: o.status,
      lastRoles: o.lastRoles,
      lastAmr: o.lastAmr,
      firstSeenAt: o.firstSeenAt.toISOString(),
      lastSeenAt: o.lastSeenAt.toISOString(),
      lastSeenIp: o.lastSeenIp,
      requestCount: o.requestCount,
      note: o.note,
      dormancy: dormancyOf(o.lastSeenAt, policy, now),
      suspension: o.status === 'suspended' ? {
        at: o.suspendedAt?.toISOString() ?? null,
        kind: o.suspendKind,
        reason: o.suspendReason,
        byAdminId: o.suspendedByAdminId,
        reinstateRequestedByAdminId: o.reinstateRequestedByAdminId,
        reinstateReason: o.reinstateReason,
      } : null,
      reinstatedAt: o.reinstatedAt?.toISOString() ?? null,
      reinstatedByAdminId: o.reinstatedByAdminId,
      permissions: {
        // Both sets, always. "Your roles hold this and a restriction removes it" is a different answer from "your roles
        // do not hold this", and an operator who cannot tell them apart escalates the wrong problem.
        grantedByRoles: [...granted].sort(),
        effective: [...effective].sort(),
        removedByRestriction: [...granted].filter((p) => !effective.has(p)).sort(),
        godMode: granted.has('*'),
      },
      restrictions: restrictions.map((r) => ({
        id: r.id,
        permissionCode: r.permissionCode,
        reason: r.reason,
        appliedByAdminId: r.appliedByAdminId,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        liftedAt: r.liftedAt?.toISOString() ?? null,
        liftedByAdminId: r.liftedByAdminId,
        liftReason: r.liftReason,
        inForce: r.liftedAt === null && live.some((l) => l.permissionCode === r.permissionCode),
        // A restriction on a permission the operator's roles never granted is not an error and is not nothing: it is a
        // control that currently removes nothing, and a reader who is not told that will believe it is why something
        // else is failing.
        inert: restrictionIsInert(r.permissionCode, granted),
      })),
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        firstSeenAt: s.firstSeenAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
        authTimeAt: s.authTimeAt?.toISOString() ?? null,
        amr: s.amr,
        tokenExpiresAt: s.tokenExpiresAt?.toISOString() ?? null,
        revokedAt: s.revokedAt?.toISOString() ?? null,
        revokedByAdminId: s.revokedByAdminId,
        revokeReason: s.revokeReason,
        expired: !!s.tokenExpiresAt && s.tokenExpiresAt.getTime() <= now.getTime(),
      })),
      liveSessions: liveSessionCount(sessions, now),
      stepUps: stepUps.map((e) => ({
        gate: e.gate, actionRoute: e.actionRoute, outcome: e.outcome, detail: e.detail,
        userAgent: e.userAgent, at: e.createdAt.toISOString(),
      })),
      denyOnlyRationale: DENY_ONLY_RATIONALE,
      revocationTakesEffect: REVOCATION_TAKES_EFFECT,
    };
  }

  /* ---------------------------------------------------------------- W438 / W439 · my own account */

  /** Everything about the caller, read from the caller's own token and the realm's record of it. Deliberately a separate
   *  route from `operator(:id)`: reading your own security page needs no permission, and reading somebody else's is a
   *  privileged act. Routing both through one handler would make that distinction a query parameter. */
  async me(actor: AdminRequestContext) {
    const { policy, fromDatabase } = await this.repo.accessPolicy();
    const now = new Date();
    const o = await this.repo.getOperator(actor.userId);
    const [sessions, restrictions, stepUps] = await Promise.all([
      this.repo.sessionsOf(actor.userId, 25),
      this.repo.restrictionsOf(actor.userId),
      this.repo.stepUpEvents(actor.userId, 25),
    ]);
    const maxAge = this.config.env.ADMIN_STEP_UP_MAX_AGE_SEC;
    const stepUpAgeSec = actor.authTimeSec ? Math.max(0, Math.floor(Date.now() / 1000) - actor.authTimeSec) : null;

    return {
      adminUserId: actor.userId,
      roles: actor.roles,
      amr: actor.amr,
      // The session strip W438 leads with. `stepUpAgeSec` is read from the token's own `auth_time`, so it is the age of
      // the CREDENTIAL rather than the age of the session — W438 renders them as two separate rows and it is right to:
      // a four-hour session with a re-auth twelve minutes ago is a different security posture from one with none.
      session: {
        sessionId: actor.sessionId || null,
        stepUpAgeSec,
        stepUpMaxAgeSec: maxAge,
        stepUpStale: stepUpAgeSec === null || stepUpAgeSec > maxAge,
        nextStepUpInSec: stepUpAgeSec === null ? null : Math.max(0, maxAge - stepUpAgeSec),
        tokenExpiresAt: actor.expSec ? new Date(actor.expSec * 1000).toISOString() : null,
        hardwareKeyFactor: actor.amr.includes('hwk'),
      },
      dormancy: o ? dormancyOf(o.lastSeenAt, policy, now) : null,
      firstSeenAt: o?.firstSeenAt.toISOString() ?? null,
      policy,
      policyFromDatabase: fromDatabase,
      permissions: {
        effective: [...actor.permissions].sort(),
        grantedByRoles: [...actor.grantedBeforeRestrictions].sort(),
        restrictedCodes: actor.restrictedCodes,
        godMode: actor.permissions.has('*'),
      },
      restrictions: restrictions.map((r) => ({
        permissionCode: r.permissionCode, reason: r.reason,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        inForce: true,
      })),
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        current: isCurrentSession(s.sessionId, actor.sessionId),
        firstSeenAt: s.firstSeenAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
        tokenExpiresAt: s.tokenExpiresAt?.toISOString() ?? null,
        revokedAt: s.revokedAt?.toISOString() ?? null,
        revokeReason: s.revokeReason,
        expired: !!s.tokenExpiresAt && s.tokenExpiresAt.getTime() <= now.getTime(),
      })),
      liveSessions: liveSessionCount(sessions, now),
      stepUps: stepUps.map((e) => ({
        gate: e.gate, actionRoute: e.actionRoute, outcome: e.outcome, detail: e.detail,
        userAgent: e.userAgent, at: e.createdAt.toISOString(),
      })),
      // **THE FIDO2 KEY LIST W439 RENDERS CANNOT BE BUILT, and the reason is not the one the screen gives.** Its banner
      // says no credentials table exists. One does — `fido2_credentials`, 0074 — and it references `users(id)`, the
      // tenant realm's table, so the operators this page is written for have no row in it and cannot be given one
      // without the cross-tenant identity the two-realm split exists to prevent. What is knowable is whether the last
      // token asserted a hardware-key factor.
      fido2: {
        keyListAvailable: false,
        tableExists: true,
        gap: 'ADMIN-9-Q3',
        knownFromToken: actor.amr.includes('hwk'),
      },
      registryEnabled: this.config.env.ADMIN_OPERATOR_REGISTRY_ENABLED,
    };
  }

  /* ---------------------------------------------------------------- writes */

  /**
   * SUSPEND. One operator, effective on the target's next request, and it ends their live sessions in the same
   * transaction — leaving them live would mean a security page listing active sessions for a suspended account.
   *
   * Self-suspension is allowed on purpose: an operator who thinks their credential is compromised must be able to shut
   * it without finding a second person. The lock is on the way back in.
   */
  async suspend(actor: AdminRequestContext, adminUserId: string, body: { reason: string }) {
    const reason = assertReason(body.reason, 'suspending an operator');
    return this.pool.withTx(async (c) => {
      await this.repo.ensureOperatorRow(c, adminUserId, actor.userId);
      const target = await this.repo.getOperatorForUpdate(c, adminUserId);
      if (!target) throw new OperatorNotFoundError(adminUserId);
      assertSuspendable(target);
      const ok = await this.repo.suspend(c, { adminUserId, byAdminId: actor.userId, reason });
      if (!ok) throw new OperatorStateError('this operator is already suspended.');
      const sessionsEnded = await this.repo.revokeAllSessions(c, {
        adminUserId, byAdminId: actor.userId, reason: 'operator suspended',
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.operator.suspended', entityType: 'platform_operator', entityId: null,
        newValue: { adminUserId, sessionsEnded, self: adminUserId === actor.userId },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { adminUserId, status: 'suspended' as const, sessionsEnded, takesEffect: REVOCATION_TAKES_EFFECT };
    });
  }

  /** The maker's half of the FOURTEENTH maker-checker site. */
  async requestReinstate(actor: AdminRequestContext, adminUserId: string, body: { reason: string }) {
    const reason = assertReason(body.reason, 'requesting a reinstatement');
    return this.pool.withTx(async (c) => {
      const target = await this.repo.getOperatorForUpdate(c, adminUserId);
      if (!target) throw new OperatorNotFoundError(adminUserId);
      if (target.status !== 'suspended') throw new OperatorStateError('this operator is not suspended.');
      const ok = await this.repo.requestReinstate(c, { adminUserId, byAdminId: actor.userId, reason });
      if (!ok) throw new OperatorStateError('this operator is not suspended.');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.operator.reinstate_requested', entityType: 'platform_operator', entityId: null,
        newValue: { adminUserId }, reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { adminUserId, reinstateRequested: true };
    });
  }

  /** The checker's half. Three copies of one rule — this assertion, the UPDATE's `<>` predicate and 0118's CHECK —
   *  because this is the door back into god mode. */
  async reinstate(actor: AdminRequestContext, adminUserId: string) {
    return this.pool.withTx(async (c) => {
      const target = await this.repo.getOperatorForUpdate(c, adminUserId);
      if (!target) throw new OperatorNotFoundError(adminUserId);
      assertReinstatable(target, target.reinstateRequestedByAdminId, actor.userId);
      const ok = await this.repo.reinstate(c, { adminUserId, byAdminId: actor.userId });
      if (!ok) throw new OperatorStateError('this reinstatement could not be applied; reload to see the current state.');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.operator.reinstated', entityType: 'platform_operator', entityId: null,
        oldValue: { status: 'suspended', suspendKind: target.suspendKind },
        newValue: { adminUserId, status: 'active', requestedBy: target.reinstateRequestedByAdminId },
        reason: target.reinstateReason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { adminUserId, status: 'active' as const };
    });
  }

  /** Deny only. There is no counterpart that grants, and `assertRestrictable` refuses a code the catalogue does not
   *  contain — a restriction on a misspelled permission would sit in the table, show on the roster, deny nothing, and
   *  be believed. */
  async restrict(actor: AdminRequestContext, adminUserId: string, body: {
    permissionCode: string; reason: string; expiresAt?: string;
  }) {
    const reason = assertReason(body.reason, 'restricting a permission');
    const code = assertRestrictable(body.permissionCode, [...ownerPermissionCodes()]);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    return this.pool.withTx(async (c) => {
      await this.repo.ensureOperatorRow(c, adminUserId, actor.userId);
      const existing = (await this.repo.restrictionsOf(adminUserId)).find((r) => r.permissionCode === code);
      if (existing) throw new DuplicateRestrictionError(code);
      const id = await this.repo.addRestriction(c, {
        adminUserId, permissionCode: code, reason, appliedByAdminId: actor.userId, expiresAt,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.operator.restricted', entityType: 'platform_operator_restriction', entityId: id,
        newValue: { adminUserId, permissionCode: code, expiresAt: expiresAt?.toISOString() ?? null, denyOnly: true },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, permissionCode: code, isGranted: false as const };
    });
  }

  /** Lifting a restriction RESTORES a permission, which is the permissive direction — and it is deliberately NOT a
   *  two-person act, because the restriction never granted anything: lifting it returns the operator to exactly what
   *  their roles already say. The ceiling is unchanged either way, which is the whole point of deny-only. */
  async liftRestriction(actor: AdminRequestContext, adminUserId: string, id: string, body: { reason: string }) {
    const reason = assertReason(body.reason, 'lifting a restriction');
    return this.pool.withTx(async (c) => {
      const ok = await this.repo.liftRestriction(c, { id, byAdminId: actor.userId, reason });
      if (!ok) throw new RestrictionNotFoundError(id);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.operator.restriction_lifted', entityType: 'platform_operator_restriction', entityId: id,
        newValue: { adminUserId }, reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, lifted: true };
    });
  }

  /** Revoke one session. The first admin-realm session revocation that has ever existed — before this, signing out
   *  deleted a cookie and a copied bearer kept working until `exp`. */
  async revokeSession(actor: AdminRequestContext, adminUserId: string, sessionId: string, body: { reason: string }) {
    const reason = assertReason(body.reason, 'revoking a session', REVOKE_REASON_MIN);
    return this.pool.withTx(async (c) => {
      const session = await this.repo.getSessionForUpdate(c, adminUserId, sessionId);
      assertRevocable(session);
      const ok = await this.repo.revokeSession(c, { sessionId, byAdminId: actor.userId, reason });
      if (!ok) throw new OperatorStateError('this session was already revoked.');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.session.revoked', entityType: 'platform_operator_session', entityId: null,
        newValue: {
          adminUserId, sessionId,
          // Recorded, because revoking the session you are holding is a different act from ending somebody else's and
          // the log should not need to infer which happened.
          self: adminUserId === actor.userId,
          current: isCurrentSession(sessionId, actor.sessionId),
        },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        sessionId, revoked: true, takesEffect: REVOCATION_TAKES_EFFECT,
        signedYouOut: isCurrentSession(sessionId, actor.sessionId),
      };
    });
  }

  /** The dormancy/access policy. A write, so it is audited and reasoned like any other: these two numbers decide when
   *  the realm locks somebody out. */
  async setPolicy(actor: AdminRequestContext, body: {
    dormantAfterDays: number; suspendAfterDays: number; touchIntervalSec: number; reason: string;
  }) {
    const reason = assertReason(body.reason, 'changing the access policy');
    if (body.suspendAfterDays <= body.dormantAfterDays) {
      throw new OperatorStateError('the auto-suspend line must be later than the dormant line, or every dormant operator is suspended the same day.');
    }
    return this.pool.withTx(async (c) => {
      const before = await this.repo.accessPolicy();
      await c.query(
        `UPDATE platform_access_policy
            SET dormant_after_days = $1, suspend_after_days = $2, touch_interval_sec = $3,
                updated_by_admin_id = $4, updated_at = now()
          WHERE id = true`,
        [body.dormantAfterDays, body.suspendAfterDays, body.touchIntervalSec, actor.userId],
      );
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'staff.access_policy.updated', entityType: 'platform_access_policy', entityId: null,
        oldValue: before.policy as unknown as Record<string, unknown>,
        newValue: { dormantAfterDays: body.dormantAfterDays, suspendAfterDays: body.suspendAfterDays, touchIntervalSec: body.touchIntervalSec },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { updated: true };
    });
  }

  /** Restricting EVERY permission is the "read-only enforced" measure W104 shows on its own auditor row. Exposed as a
   *  named helper rather than left to a caller typing `'*'`, so the console's most consequential control has one
   *  spelling and the audit trail has one shape. */
  restrictAllCode(): string { return RESTRICT_ALL; }
}
