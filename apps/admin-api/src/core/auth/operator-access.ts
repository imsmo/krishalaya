// apps/admin-api/src/core/auth/operator-access.ts · PC-56 ADMIN-9 — the access decision, as pure functions.
//
// THE ACCESS DECISION, as pure functions, because it now runs on EVERY admin request and a guard is the worst place on
// a platform to discover a subtle rule. Three refusals and one subtraction:
//
//   1. the operator is SUSPENDED               → refuse (the deactivation W104 promises and never had)
//   2. this SESSION has been revoked           → refuse (`sid` has been minted and ignored since the realm was built)
//   3. the operator is past the DORMANCY line  → refuse AND suspend, in that order
//   4. otherwise: permissions = catalogue(token.roles) MINUS restrictions
//
// **THE TABLE CAN ONLY EVER REFUSE.** There is no branch here that adds a permission, and there is no shape of row that
// could. If a restriction row could grant, an INSERT anywhere — including a bug — would be an escalation into god-mode
// and `owner-roles.ts` would stop being the ceiling (Law 5 reflect-never-grant, Law 11).
//
// FAIL-CLOSED, and the reasoning is worth stating because Law 12 is degrade-never-die: a read failure here refuses the
// request. Law 12 protects a farmer whose crop price should still render when a recommendation service is down. This is
// the god-mode realm's front door, every route behind it reads the same database, and "we could not check whether this
// operator was dismissed, so we let them in" is not a degraded service — it is the absence of the control.

export const ACCESS_DENIED_REASONS = ['suspended', 'session_revoked', 'dormant'] as const;
export type AccessDeniedReason = (typeof ACCESS_DENIED_REASONS)[number];

export interface AccessPolicy {
  dormantAfterDays: number;
  suspendAfterDays: number;
  touchIntervalSec: number;
}

/** The shipped defaults, matching W439's stated policy. Used ONLY when the policy row cannot be read — and a caller
 *  that falls back to these must say so, because a threshold nobody can read is not a threshold anybody has agreed. */
export const DEFAULT_ACCESS_POLICY: AccessPolicy = Object.freeze({
  dormantAfterDays: 30,
  suspendAfterDays: 45,
  touchIntervalSec: 60,
});

export interface OperatorRow {
  adminUserId: string;
  status: string;
  lastSeenAt: Date;
  firstSeenAt: Date;
  suspendedAt: Date | null;
  suspendKind: string | null;
  suspendReason: string | null;
}

export interface RestrictionRow {
  permissionCode: string;
  reason: string;
  expiresAt: Date | null;
}

export type AccessVerdict =
  /** Admit. `dormancy` is carried through so a surface can warn before the line rather than after it. */
  | { allow: true; dormancy: DormancyState; autoSuspend: false }
  /** Refuse, and the reason is a code rather than a sentence: it is audited, and an audited reason must be countable. */
  | { allow: false; reason: AccessDeniedReason; detail: string; autoSuspend: boolean };

export type DormancyState =
  | { kind: 'active'; daysSinceSeen: number; daysToDormant: number; daysToSuspend: number }
  | { kind: 'dormant'; daysSinceSeen: number; daysToSuspend: number }
  /** Past the suspend line and still reading `active` in the database, because nothing sweeps. The console must show
   *  THIS rather than "suspended" — claiming a suspension that has not happened is the defect this platform has now
   *  found six times, and a seventh in the middle of an access-control wave would be indefensible. */
  | { kind: 'past_line'; daysSinceSeen: number };

/** Whole days elapsed, floored. Floored rather than rounded so a threshold is never crossed early: "day 45 of 45"
 *  must mean 45 complete days, not 44 and a half rounded up into a lockout. */
export function daysSince(then: Date, now: Date): number {
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export function dormancyOf(lastSeenAt: Date, policy: AccessPolicy, now: Date): DormancyState {
  const d = daysSince(lastSeenAt, now);
  if (d >= policy.suspendAfterDays) return { kind: 'past_line', daysSinceSeen: d };
  if (d >= policy.dormantAfterDays) {
    return { kind: 'dormant', daysSinceSeen: d, daysToSuspend: policy.suspendAfterDays - d };
  }
  return {
    kind: 'active',
    daysSinceSeen: d,
    daysToDormant: policy.dormantAfterDays - d,
    daysToSuspend: policy.suspendAfterDays - d,
  };
}

/** Is this restriction in force right now? An expired restriction denies nothing — the whole point of the `expires_at`
 *  column is that a 90-day read-only measure ends by itself rather than by somebody remembering. */
export function restrictionInForce(r: RestrictionRow, now: Date): boolean {
  return r.expiresAt === null || r.expiresAt.getTime() > now.getTime();
}

/**
 * THE SUBTRACTION. Two things are worth reading closely.
 *
 * `'*'` AS A RESTRICTION CODE REMOVES EVERYTHING, including a super_admin's god-mode star. That is the "read-only
 * enforced" measure W104 shows on its own auditor row, and it has to work against every role or it is a measure that
 * quietly exempts the most powerful account on the platform.
 *
 * A RESTRICTION ON A GOD-MODE OPERATOR MUST STILL BITE. `resolveOwnerPermissions` answers `{'*'}` for super_admin and
 * `hasOwnerPermission` treats the star as "holds everything" — so subtracting `payouts.approve` from a set containing
 * only `'*'` would remove nothing and the console would report a restriction that does not restrict. The star is
 * therefore EXPANDED to the full catalogue before subtraction whenever any restriction is in force.
 */
export function effectivePermissions(
  granted: Set<string>,
  restrictions: readonly RestrictionRow[],
  allCodes: readonly string[],
  now: Date,
): Set<string> {
  const live = restrictions.filter((r) => restrictionInForce(r, now));
  if (live.length === 0) return granted;

  const denied = new Set(live.map((r) => r.permissionCode));
  if (denied.has('*')) return new Set();

  const base = granted.has('*') ? new Set<string>(['*', ...allCodes]) : new Set(granted);
  // The star itself goes too: a set that still holds '*' would answer true for the very code just removed, because
  // `hasOwnerPermission` short-circuits on it. This is the one place where subtracting a NAMED permission has to
  // remove an UNNAMED one as well, and getting it wrong would make every restriction on a super_admin cosmetic.
  if (base.has('*')) base.delete('*');
  for (const code of denied) base.delete(code);
  return base;
}

/** Every restriction that is actually biting, for display. Separate from the subtraction so a console can list them
 *  without re-deriving the rule — two implementations of one rule is how a screen starts disagreeing with the guard. */
export function liveRestrictions(restrictions: readonly RestrictionRow[], now: Date): RestrictionRow[] {
  return restrictions.filter((r) => restrictionInForce(r, now));
}

export interface SessionRow {
  sessionId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
}

/**
 * The gate. Order matters and is deliberate:
 *
 * SUSPENSION IS CHECKED BEFORE SESSION REVOCATION because a suspended operator's every session is void whether or not
 * anybody revoked them individually, and reporting "session revoked" to a dismissed operator would understate what has
 * happened in the audit trail.
 *
 * DORMANCY IS CHECKED LAST, and only for an operator who is otherwise admissible: an already-suspended operator does
 * not need a second reason, and recording a dormancy auto-suspension over a manual one would overwrite the record of a
 * dismissal with a housekeeping event.
 *
 * AN UNKNOWN OPERATOR IS ADMITTED AND RECORDED. This is the one permissive branch and it is not a loophole: their token
 * is valid, the realm has simply never seen them before, and refusing first-sightings would mean nobody could ever sign
 * in — the table would have to be populated by the directory sync that this design exists to avoid. The FIRST request
 * creates the row, and every request after it is checked against it.
 */
export function accessVerdict(
  operator: OperatorRow | null,
  session: SessionRow | null,
  policy: AccessPolicy,
  now: Date,
): AccessVerdict {
  if (operator === null) {
    return { allow: true, dormancy: { kind: 'active', daysSinceSeen: 0, daysToDormant: policy.dormantAfterDays, daysToSuspend: policy.suspendAfterDays }, autoSuspend: false };
  }

  if (operator.status === 'suspended') {
    const kind = operator.suspendKind === 'dormant' ? 'dormancy' : 'a platform administrator';
    return {
      allow: false, reason: 'suspended', autoSuspend: false,
      detail: `this operator account is suspended (by ${kind}). Access to the platform realm is refused until it is reinstated, which needs two administrators.`,
    };
  }

  if (session && session.revokedAt !== null) {
    return {
      allow: false, reason: 'session_revoked', autoSuspend: false,
      detail: 'this session has been revoked. Sign in again to start a new one.',
    };
  }

  const dormancy = dormancyOf(operator.lastSeenAt, policy, now);
  if (dormancy.kind === 'past_line') {
    return {
      allow: false, reason: 'dormant', autoSuspend: true,
      detail: `this operator has not used the platform realm for ${dormancy.daysSinceSeen} days, past the ${policy.suspendAfterDays}-day limit. The account is now suspended and needs two administrators to reinstate.`,
    };
  }

  return { allow: true, dormancy, autoSuspend: false };
}

/** Should the guard spend a write on this request? The read that decides access happens every time regardless; the
 *  touch is bookkeeping, and one UPDATE per request would multiply admin write traffic for no added truth. A zero
 *  interval means "every request", which is what a test wants and what production does not. */
export function shouldTouch(lastSeenAt: Date, policy: AccessPolicy, now: Date): boolean {
  if (policy.touchIntervalSec <= 0) return true;
  return now.getTime() - lastSeenAt.getTime() >= policy.touchIntervalSec * 1000;
}
