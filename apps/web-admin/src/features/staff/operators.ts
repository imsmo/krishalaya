// apps/web-admin/src/features/staff/operators.ts · W104 / W105 / W438 / W439 view logic (PC-56 ADMIN-9).
//
// Pure functions, tested separately from the pages. Three of them decide what a reader BELIEVES about access, and each
// exists because the honest reading and the convenient reading differ:
//
//   * `dormancyKey` must never render "suspended" for an operator past the line whose row still says active. Nothing
//     sweeps; the suspension happens at their next request. Six status columns on this platform have already recorded
//     acts nobody performs, and claiming this one inside an access-control wave would be indefensible.
//   * `censusLabel` must never present an OBSERVED count as a directory count. W104 says "Active staff 31"; this realm
//     can only count operators it has seen.
//   * `keyListState` must not render an empty FIDO2 key list as "no keys registered". The table exists and is unusable
//     by these operators — an empty list would read as a fact about the operator instead of a fact about the schema.

/* ------------------------------------------------------------------------------------------------ */
/* STATUS                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export function statusKey(status: string): string {
  return status === 'active' ? 'st.status.active' : status === 'suspended' ? 'st.status.suspended' : 'st.status.unknown';
}

export function statusClass(status: string): string {
  if (status === 'suspended') return 'kv-badge is-danger';
  if (status === 'active') return 'kv-badge is-ok';
  return 'kv-badge is-warn';
}

/** A dismissal and a dormancy sweep are not the same event, and a console that rendered them alike would let the first
 *  hide inside the second. */
export function suspendKindKey(kind: string | null): string {
  if (kind === 'manual') return 'st.suspend.manual';
  if (kind === 'dormant') return 'st.suspend.dormant';
  return 'st.suspend.unknown';
}

/* ------------------------------------------------------------------------------------------------ */
/* DORMANCY                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export interface Dormancy {
  kind: 'active' | 'dormant' | 'past_line';
  daysSinceSeen: number;
  daysToDormant?: number;
  daysToSuspend?: number;
}

export function dormancyKey(d: Dormancy | null): string {
  if (!d) return 'st.dormancy.unknown';
  if (d.kind === 'past_line') return 'st.dormancy.pastLine';
  if (d.kind === 'dormant') return 'st.dormancy.dormant';
  return 'st.dormancy.active';
}

/** `past_line` is DANGER, `dormant` is a warning: the first means the next request will be refused, and whoever is
 *  reading the roster is the only person who can pre-empt that. */
export function dormancyClass(d: Dormancy | null): string {
  if (!d) return 'kv-badge';
  if (d.kind === 'past_line') return 'kv-badge is-danger';
  if (d.kind === 'dormant') return 'kv-badge is-warn';
  return 'kv-badge is-ok';
}

/** The one sentence that keeps this console honest about its own limits. */
export function pastLineIsNotSuspended(d: Dormancy | null): boolean {
  return d?.kind === 'past_line';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE CENSUS                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** Observed, always. There is no basis on which this realm could produce a directory count, so there is no branch here
 *  that claims one — a parameter for it would be an invitation to pass `true` later. */
export function censusLabelKey(): string {
  return 'st.census.observed';
}

export function fido2ClaimKey(enrolmentKnown: boolean): string {
  // The parameter exists because the day a platform-realm credential table lands, this flips — and the console should
  // change with the schema rather than needing an edit to stop lying.
  return enrolmentKnown ? 'st.fido2.enrolled' : 'st.fido2.unknowable';
}

export type KeyListState = 'unavailable' | 'empty' | 'listed';

/** "No keys registered" is a statement about an operator. "This realm cannot hold a key for you" is a statement about
 *  the schema. W439's own banner makes the first claim; only the second is true. */
export function keyListState(available: boolean, count: number): KeyListState {
  if (!available) return 'unavailable';
  return count === 0 ? 'empty' : 'listed';
}

export function keyListKey(state: KeyListState): string {
  switch (state) {
    case 'unavailable': return 'st.keys.unavailable';
    case 'empty': return 'st.keys.empty';
    default: return 'st.keys.listed';
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* SESSIONS                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export type SessionState = 'current' | 'live' | 'revoked' | 'expired';

/** Order matters: a revoked session that has also expired is REVOKED, because somebody did that and the record should
 *  say so. Expiry is what happens when nobody does anything. */
export function sessionState(s: {
  current?: boolean; revokedAt: string | null; expired: boolean;
}): SessionState {
  if (s.revokedAt) return 'revoked';
  if (s.expired) return 'expired';
  return s.current ? 'current' : 'live';
}

export function sessionKey(state: SessionState): string { return `st.session.${state}`; }

export function sessionClass(state: SessionState): string {
  switch (state) {
    case 'current': return 'kv-badge is-info';
    case 'live': return 'kv-badge is-ok';
    case 'revoked': return 'kv-badge is-danger';
    default: return 'kv-badge';
  }
}

/** Whether a revoke control appears at all. An expired or already-revoked session offers none — a control for an act
 *  that cannot happen teaches an operator that the console guesses. */
export function canRevokeSession(state: SessionState): boolean {
  return state === 'current' || state === 'live';
}

/** Revoking your own current session signs you out, and the button must say so before it is pressed rather than after. */
export function revokeLabelKey(state: SessionState): string {
  return state === 'current' ? 'st.session.revokeSelf' : 'st.session.revoke';
}

/* ------------------------------------------------------------------------------------------------ */
/* STEP-UP                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export function stepUpOutcomeClass(outcome: string): string {
  return outcome === 'verified' ? 'kv-badge is-ok' : 'kv-badge is-danger';
}

export function gateKey(gate: string): string {
  return gate === 'hardware_key' ? 'st.gate.hardwareKey' : gate === 'step_up' ? 'st.gate.stepUp' : 'st.gate.other';
}

/** The strip W438 leads with. A stale step-up is not an error — it means the next gated action will ask for the key,
 *  which is the control working. */
export function stepUpStateKey(stale: boolean, hasFactor: boolean): string {
  if (!hasFactor) return 'st.stepUp.noFactor';
  return stale ? 'st.stepUp.stale' : 'st.stepUp.fresh';
}

export function stepUpClass(stale: boolean, hasFactor: boolean): string {
  if (!hasFactor) return 'kv-note is-danger';
  return stale ? 'kv-note is-warn' : 'kv-note is-ok';
}

/* ------------------------------------------------------------------------------------------------ */
/* RESTRICTIONS — deny only                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export type RestrictionState = 'in_force' | 'inert' | 'expired' | 'lifted';

export function restrictionState(r: {
  liftedAt: string | null; inForce: boolean; inert: boolean; expiresAt: string | null;
}, nowMs: number): RestrictionState {
  if (r.liftedAt) return 'lifted';
  if (r.expiresAt && Date.parse(r.expiresAt) <= nowMs) return 'expired';
  // INERT BEFORE IN_FORCE: a restriction on a permission the operator's roles never granted is not protecting anything,
  // and a reader who is told "in force" will believe it is why something else is failing.
  if (r.inert) return 'inert';
  return r.inForce ? 'in_force' : 'expired';
}

export function restrictionKey(state: RestrictionState): string { return `st.restriction.${state}`; }

export function restrictionClass(state: RestrictionState): string {
  switch (state) {
    case 'in_force': return 'kv-badge is-warn';
    case 'inert': return 'kv-badge';
    default: return 'kv-badge is-muted';
  }
}

/** The star, rendered as a sentence. `*` in a permission column is a character an operator has to be taught to read. */
export function restrictionCodeLabel(code: string): { key: string; code: string | null } {
  return code === '*' ? { key: 'st.restriction.all', code: null } : { key: 'st.restriction.one', code };
}

/* ------------------------------------------------------------------------------------------------ */
/* REINSTATEMENT — the fourteenth maker-checker site, by ABSENCE                                     */
/* ------------------------------------------------------------------------------------------------ */

/** Whether to render the REQUEST control (the maker's half). */
export function canRequestReinstate(o: { status: string; reinstateRequestedByAdminId: string | null }): boolean {
  return o.status === 'suspended' && !o.reinstateRequestedByAdminId;
}

/**
 * Whether to render the APPROVE control. Absent — never disabled — for the requester, and absent when nobody has asked.
 * The server refuses regardless (`assertReinstatable`, the UPDATE's own predicate, and 0118's CHECK: three copies,
 * because this is the door back into god mode). A greyed-out button here would teach an operator that the rule is a UI
 * preference.
 */
export function canApproveReinstate(
  o: { status: string; reinstateRequestedByAdminId: string | null },
  me: string | null,
): boolean {
  if (o.status !== 'suspended' || !o.reinstateRequestedByAdminId) return false;
  return o.reinstateRequestedByAdminId !== me;
}

/** Why the approve control is missing, so an absence never reads as an unbuilt feature. */
export function reinstateAbsenceKey(
  o: { status: string; reinstateRequestedByAdminId: string | null },
  me: string | null,
): string | null {
  if (o.status !== 'suspended') return null;
  if (!o.reinstateRequestedByAdminId) return 'st.reinstate.noneRequested';
  if (o.reinstateRequestedByAdminId === me) return 'st.reinstate.youRequested';
  return null;
}

/* ------------------------------------------------------------------------------------------------ */
/* W105 · THE MATRIX                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export function cellStateKey(state: string): string {
  switch (state) {
    case 'granted': return 'st.matrix.granted';
    case 'god_mode': return 'st.matrix.godMode';
    default: return 'st.matrix.none';
  }
}

export function cellClass(state: string): string {
  switch (state) {
    case 'granted': return 'kv-badge is-ok';
    // God mode is drawn apart from a grant rather than as a stronger version of one: "holds whatever is defined,
    // including codes a future deploy adds" is a different fact from "holds this".
    case 'god_mode': return 'kv-badge is-warn';
    default: return 'kv-cell-empty';
  }
}

/** The role editor has no write path and the page says why. Exported as a predicate so the pages cannot disagree about
 *  whether to render a Submit control. */
export function matrixIsWritable(): boolean { return false; }

/* ------------------------------------------------------------------------------------------------ */
/* W438 · QUICK LINKS — locked, never hidden (Law 11)                                                */
/* ------------------------------------------------------------------------------------------------ */

export interface QuickLink { href: string; labelKey: string; permission: string | null; roleHintKey: string }

/** W438: "Shown per your role's real permissions (Golden Law 11) — locked tiles are not hidden, they name the role that
 *  unlocks them." A hidden tile teaches an operator that the platform is smaller than it is; a locked one tells them
 *  exactly what to ask for. */
export const QUICK_LINKS: readonly QuickLink[] = Object.freeze([
  { href: '/support', labelKey: 'st.quick.support', permission: 'support.oversight.read', roleHintKey: 'st.role.support' },
  { href: '/moderation', labelKey: 'st.quick.moderation', permission: 'moderation.read', roleHintKey: 'st.role.moderation' },
  { href: '/recon', labelKey: 'st.quick.recon', permission: 'recon.read', roleHintKey: 'st.role.recon' },
  { href: '/compliance/audit', labelKey: 'st.quick.audit', permission: 'audit.read', roleHintKey: 'st.role.audit' },
  { href: '/staff', labelKey: 'st.quick.staff', permission: 'staff.read', roleHintKey: 'st.role.staff' },
  { href: '/staff/roles', labelKey: 'st.quick.roles', permission: 'rbac.read', roleHintKey: 'st.role.roles' },
  { href: '/staff/security', labelKey: 'st.quick.security', permission: null, roleHintKey: 'st.role.none' },
  { href: '/flags', labelKey: 'st.quick.flags', permission: 'flags.manage', roleHintKey: 'st.role.flags' },
  { href: '/cells', labelKey: 'st.quick.cells', permission: 'cells.read', roleHintKey: 'st.role.cells' },
]);

/** Uses the EFFECTIVE set, so a restricted operator sees a tile lock rather than clicking through to a 403 — the
 *  restriction is visible where its effect is. */
export function quickLinkUnlocked(link: QuickLink, effective: readonly string[]): boolean {
  if (link.permission === null) return true;
  return effective.includes('*') || effective.includes(link.permission);
}

/** Whether the lock is caused by a RESTRICTION rather than by the operator's roles — a different sentence, because one
 *  is answered by asking for a role and the other by asking why the restriction is there. */
export function lockedByRestriction(link: QuickLink, granted: readonly string[], restricted: readonly string[]): boolean {
  if (link.permission === null) return false;
  const held = granted.includes('*') || granted.includes(link.permission);
  return held && (restricted.includes(link.permission) || restricted.includes('*'));
}
