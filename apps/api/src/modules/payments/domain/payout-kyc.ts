// modules/payments/domain/payout-kyc.ts · the per-role money gate (PC-56 TENANT-1).
//
// **THE DEFECT THIS FILE CLOSES IS ON THE MONEY PATH.** `PayoutRepository.callerKycVerified` accepted
// `kyc_status = 'verified'` on ANY active role — its own comment said so — while W153 states the platform's rule twice:
// "KYC is per role, not per person" and "worst-status view — multi-role members count at their lowest role".
//
// The canon's own example row is the exploit. Kanji Bhai R. is `worker: verified` / `farmer: pending`, and until this
// wave he could request a SETTLEMENT payout — crop sale proceeds — on the strength of a worker verification. In an FPO
// the worker check is frequently the lighter one (a wage receipt against a muster roll); the seller check is the one
// carrying a land record and a bank account in the seller's own name.
//
// Everything here is a pure function. The eligible-role map arrives as data (0125's `payout_purpose_roles`), because a
// hard-coded map is a shortcut that blocks a country: a new payout purpose for a new market must not need a deploy.

export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected' | 'expired';

/** One of a person's roles in one tenant, with the KYC status that belongs to THAT role. */
export interface RoleKyc {
  roleCode: string;
  kycStatus: string;
  isActive: boolean;
}

export type EligibilityReason =
  /** A role the purpose names is verified. The normal pass. */
  | 'eligible_role_verified'
  /** The purpose names roles and the caller holds none of them, verified or otherwise. */
  | 'no_eligible_role_held'
  /** The caller HOLDS an eligible role and its KYC is not verified. The interesting refusal: name the role and status. */
  | 'eligible_role_unverified'
  /** **THE PURPOSE IS NOT IN THE MAP.** Falls back to requiring every active role verified — unknown refuses. */
  | 'unmapped_purpose_all_roles_verified'
  | 'unmapped_purpose_some_role_unverified'
  /** No active roles at all in this tenant. */
  | 'no_active_roles';

export interface KycVerdict {
  allowed: boolean;
  reason: EligibilityReason;
  /** The role the decision turned on, where one did — so the refusal can name it and the member can be told what to fix. */
  decidingRole: string | null;
  decidingStatus: string | null;
  /** Which roles the purpose accepts. Empty means the purpose is unmapped. */
  eligibleRoles: string[];
}

/**
 * May this person receive money for this purpose?
 *
 * **THE THREE RULES, IN THE ORDER THEY MATTER:**
 *
 * 1. A MAPPED purpose is satisfied by a VERIFIED status on one of ITS roles. Not on any role — that was the defect.
 * 2. An UNMAPPED purpose requires every active role verified. A purpose nobody has mapped is a payout kind nobody has
 *    thought about, and the moment to discover that is before the money moves. Sixth time this programme has had to
 *    make unknown mean refuse, and the first time on a money gate.
 * 3. A person with NO active roles is refused, always. There is no "default" capacity to receive money in.
 *
 * The verdict names the role it turned on, because "KYC required" with no role attached is a refusal a tenant's staff
 * cannot act on — and the member cannot be told which verification to complete.
 */
export function kycVerdictFor(purposeRoles: string[], roles: RoleKyc[]): KycVerdict {
  const active = roles.filter((r) => r.isActive);
  if (active.length === 0) {
    return { allowed: false, reason: 'no_active_roles', decidingRole: null, decidingStatus: null, eligibleRoles: purposeRoles };
  }

  // Unmapped purpose → the strictest reading. Deliberately NOT "any role", which is what made a worker verification
  // open a farmer settlement.
  if (purposeRoles.length === 0) {
    const unverified = active.find((r) => r.kycStatus !== 'verified');
    if (unverified) {
      return {
        allowed: false, reason: 'unmapped_purpose_some_role_unverified',
        decidingRole: unverified.roleCode, decidingStatus: unverified.kycStatus, eligibleRoles: [],
      };
    }
    return { allowed: true, reason: 'unmapped_purpose_all_roles_verified', decidingRole: null, decidingStatus: null, eligibleRoles: [] };
  }

  const held = active.filter((r) => purposeRoles.includes(r.roleCode));
  if (held.length === 0) {
    return { allowed: false, reason: 'no_eligible_role_held', decidingRole: null, decidingStatus: null, eligibleRoles: purposeRoles };
  }
  const verified = held.find((r) => r.kycStatus === 'verified');
  if (verified) {
    return { allowed: true, reason: 'eligible_role_verified', decidingRole: verified.roleCode, decidingStatus: 'verified', eligibleRoles: purposeRoles };
  }
  // Holds the right role, unverified. **THE MOST USEFUL REFUSAL ON THIS PLANE**: it names exactly which verification the
  // member has to finish, which is what turns a blocked payout into an action a field officer can take.
  const worst = worstOf(held);
  return { allowed: false, reason: 'eligible_role_unverified', decidingRole: worst.roleCode, decidingStatus: worst.kycStatus, eligibleRoles: purposeRoles };
}

/**
 * **THE ORDER W153's "WORST-STATUS VIEW" DEPENDS ON.** A multi-role member counts at their lowest role, and "lowest"
 * has to be an explicit total order rather than whatever a string sort gives: alphabetically 'expired' precedes
 * 'pending' precedes 'verified', which would make an EXPIRED verification look worse than a REJECTED one. It is not —
 * a rejection is a decision against the person, an expiry is a clock running out, and a roster that ranked them the
 * other way round would send staff to the wrong member first.
 */
const SEVERITY: Record<string, number> = {
  rejected: 0,   // somebody looked and said no
  none: 1,       // never started
  expired: 2,    // was verified once; a re-check, not a rejection
  pending: 3,    // in flight
  verified: 4,   // done
};

export function severityOf(status: string): number {
  // An unrecognised status sorts as the WORST. Fifth wave in a row: a state this code cannot describe is a state whose
  // safety it cannot assert, and on a roster that decides who staff chase, guessing "fine" is the wrong guess.
  return SEVERITY[status] ?? -1;
}

function worstOf(roles: RoleKyc[]): RoleKyc {
  return roles.reduce((a, b) => (severityOf(b.kycStatus) < severityOf(a.kycStatus) ? b : a));
}

/**
 * The roster's per-person status: the WORST status across their active roles. W153's headline percentage
 * ("Fully verified members · 89%") counts a person only when every active role is verified.
 */
export function worstKycStatus(roles: RoleKyc[]): { status: string; roleCode: string | null } {
  const active = roles.filter((r) => r.isActive);
  if (active.length === 0) return { status: 'none', roleCode: null };
  const w = worstOf(active);
  return { status: w.kycStatus, roleCode: w.roleCode };
}

/** Whether this person counts toward "fully verified" — every active role verified, not merely one. */
export function isFullyVerified(roles: RoleKyc[]): boolean {
  const active = roles.filter((r) => r.isActive);
  return active.length > 0 && active.every((r) => r.kycStatus === 'verified');
}

/** The roster cell for a multi-role member: "verified ×2", or the worst status when they disagree. W153 renders both
 *  shapes, and the difference is the whole point of the column. */
export function rosterKycLabel(roles: RoleKyc[]): { key: string; count: number; status: string; roleCode: string | null } {
  const active = roles.filter((r) => r.isActive);
  if (active.length === 0) return { key: 'noRoles', count: 0, status: 'none', roleCode: null };
  if (isFullyVerified(active)) {
    return { key: active.length > 1 ? 'verifiedMany' : 'verifiedOne', count: active.length, status: 'verified', roleCode: null };
  }
  const w = worstKycStatus(active);
  // A mixed member is labelled by the role that is BEHIND, because that is the one somebody has to act on.
  return { key: 'mixed', count: active.length, status: w.status, roleCode: w.roleCode };
}
