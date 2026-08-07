// apps/admin-api/src/modules/platform-staff/domain/operator-lifecycle.ts · PC-56 ADMIN-9.
//
// SUSPEND, REINSTATE, RESTRICT, LIFT — and the asymmetry that shapes all four.
//
// Every one of the platform's thirteen existing maker-checker sites gates the PERMISSIVE direction: approving a payout,
// promoting a model, applying a routing change, publishing a scheme version. Here the permissive direction is putting
// somebody back INSIDE the god-mode realm, and the restrictive direction is taking their access away.
//
// So the rule inverts. **SUSPENSION IS ONE OPERATOR AND TAKES EFFECT ON THE NEXT REQUEST. REINSTATEMENT IS TWO.**
// A second-person rule on an emergency control is a second-person rule at 2 a.m., and a platform that cannot cut off a
// compromised operator until it finds a checker has built a control that will be bypassed the first time it matters —
// and a control that gets bypassed under pressure is worse than one that was never claimed.
import { InvalidStaffInputError, OperatorStateError, SelfActionError } from './platform-staff.errors';

export const SUSPEND_KINDS = ['manual', 'dormant'] as const;
export type SuspendKind = (typeof SUSPEND_KINDS)[number];

export const REASON_MIN = 10;
/** A session revoke reason may be shorter — "lost device" is a complete answer and W439's own placeholder suggests it.
 *  A suspension's reason is read months later by somebody deciding whether to reinstate, and needs a sentence. */
export const REVOKE_REASON_MIN = 5;

export function assertReason(reason: string | undefined, what: string, min = REASON_MIN): string {
  const r = (reason ?? '').trim();
  if (r.length < min) {
    throw new InvalidStaffInputError(
      `${what} needs a reason of at least ${min} characters. This is read by whoever decides what happens next, and a `
      + 'one-word reason is a decision nobody wrote down.',
    );
  }
  return r;
}

/* ------------------------------------------------------------------------------------------------ */
/* SUSPENSION                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/**
 * **AN OPERATOR MAY SUSPEND THEMSELVES.** It looks like something to forbid and it is the opposite: an operator who
 * believes their own credential is compromised should be able to shut it immediately without finding somebody else, and
 * the reinstatement they will need afterwards is the act that takes two people. The lock is on the way back in.
 */
export function assertSuspendable(target: { status: string }): void {
  if (target.status === 'suspended') {
    throw new OperatorStateError('this operator is already suspended.');
  }
}

/** The most consequential rule in this file. */
export function assertReinstatable(
  target: { status: string; suspendKind: string | null },
  requestedByAdminId: string | null,
  checkerAdminId: string,
): void {
  if (target.status !== 'suspended') {
    throw new OperatorStateError('this operator is not suspended, so there is nothing to reinstate.');
  }
  if (!requestedByAdminId) {
    throw new OperatorStateError(
      'no reinstatement has been requested for this operator. Reinstatement is a two-person act: one administrator '
      + 'requests it and a different one approves it.',
    );
  }
  if (requestedByAdminId === checkerAdminId) {
    // The FOURTEENTH maker-checker site, and the one case it exists for: a suspended operator letting themselves back in,
    // or an administrator quietly undoing their own suspension of a colleague.
    throw new SelfActionError(
      'you requested this reinstatement, so you cannot approve it. Restoring access to the platform realm needs a '
      + 'second administrator — the same rule as every other two-person control here, pointed the other way round: '
      + 'removing access takes one person, giving it back takes two.',
    );
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* RESTRICTIONS — deny only                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export const RESTRICT_ALL = '*';

/**
 * A restriction names a permission code from the compiled catalogue, or `'*'`.
 *
 * **A CODE THAT DOES NOT EXIST IS REFUSED**, because a restriction on `payout.approve` (singular, and therefore wrong —
 * the real code is `payouts.approve`) would sit in the table, appear on the roster, deny nothing, and be believed. A
 * typo in a control is indistinguishable from the control being off, and this is the cheapest place in the system to
 * make that impossible.
 */
export function assertRestrictable(permissionCode: string, knownCodes: readonly string[]): string {
  const code = permissionCode.trim();
  if (code === RESTRICT_ALL) return code;
  if (!knownCodes.includes(code)) {
    throw new InvalidStaffInputError(
      `'${code}' is not a platform permission code. A restriction naming a code that does not exist would deny nothing `
      + 'while looking like a control.',
    );
  }
  return code;
}

/** Is this restriction pointless — i.e. does the operator's roles not grant it in the first place? Not an error: roles
 *  change, and a restriction placed ahead of a promotion is a legitimate thing to want. But the console says so, because
 *  an operator reading "restricted: ledger.correct" would otherwise believe a permission was taken away that they never
 *  held, and might reasonably conclude the restriction is what is stopping them doing something else. */
export function restrictionIsInert(permissionCode: string, granted: ReadonlySet<string>): boolean {
  if (permissionCode === RESTRICT_ALL) return granted.size === 0;
  return !(granted.has('*') || granted.has(permissionCode));
}

/**
 * **WHY THERE IS NO `grantPermission` FUNCTION IN THIS FILE, STATED SO THAT NOBODY LATER ADDS ONE HELPFULLY.**
 *
 * Granting a platform permission means editing `owner-roles.ts` and deploying. That is not an oversight to be worked
 * around; it is the ceiling that makes the catalogue meaningful. A row in a database that could add a god-mode
 * permission would mean: whoever can write that row can grant themselves anything, the compiled catalogue becomes
 * advisory, and Law 5's reflect-never-grant is broken in the one realm where it matters most.
 *
 * W104 shows two overrides on its roster — "+1 (refunds ≤ ₹10,000)" and "−1 (read-only enforced)". Only the second can
 * exist here. The first is not a feature this wave failed to build; it is a shape this platform must not have.
 */
export const GRANT_SIDE_OVERRIDES_ARE_REFUSED = true;

/** Named so the console's sentence and the migration's constraint quote the same source. */
export const DENY_ONLY_RATIONALE =
  'A restriction can only ever remove a permission. An override that added one would mean a database row escalating '
  + 'privileges beyond the compiled catalogue, which is the ceiling this realm is built on (Law 5, Law 11).';

/* ------------------------------------------------------------------------------------------------ */
/* SESSIONS                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** Revoking an already-revoked session is refused rather than treated as success: "already ended" and "I have just
 *  ended it" are different facts, and W439 renders them as different rows. */
export function assertRevocable(session: { revokedAt: Date | null } | null): void {
  if (!session) throw new OperatorStateError('no such session for this operator.');
  if (session.revokedAt !== null) throw new OperatorStateError('this session was already revoked.');
}

/**
 * **REVOKING YOUR OWN CURRENT SESSION IS ALLOWED, and it signs you out.** W439 renders the current session with a
 * "this device" badge and a Revoke control beside it, which is right: "sign out everywhere" is a security action a
 * person must be able to take about themselves, and a console that quietly excluded the session you are holding would
 * leave the one credential an attacker is actually using.
 */
export function isCurrentSession(sessionId: string, actorSessionId: string): boolean {
  return sessionId !== '' && sessionId === actorSessionId;
}

/** How many live sessions remain after this revoke — so the console can tell the truth about what just happened
 *  instead of claiming "all sessions ended". */
export function liveSessionCount(sessions: readonly { revokedAt: Date | null; tokenExpiresAt: Date | null }[], now: Date): number {
  return sessions.filter((s) => s.revokedAt === null
    && (s.tokenExpiresAt === null || s.tokenExpiresAt.getTime() > now.getTime())).length;
}

/**
 * **THE HONEST LIMIT ON "SESSIONS KILLED WITHIN 60 SECONDS".** W104 promises it and this wave delivers something
 * narrower and real: a revoked session is refused by `AdminAuthGuard` on its NEXT request to admin-api. A token already
 * in flight completes. And nothing here reaches the IdP, so a revoked session could in principle still be honoured by
 * some other relying party that trusts the same issuer — admin-api is the only consumer today, and that is a fact about
 * today rather than a guarantee.
 */
export const REVOCATION_TAKES_EFFECT = 'next request to admin-api' as const;
