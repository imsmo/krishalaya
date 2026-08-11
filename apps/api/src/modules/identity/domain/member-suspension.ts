// modules/identity/domain/member-suspension.ts · the rules of a tenant-scoped suspension (PC-56 TENANT-1b-2).
//
// Pure functions. The point of putting them here rather than inline in the service is that **the effects of a suspension
// are a list somebody can read and test**, not a set of scattered `if` statements — and one item on that list is a thing
// the code must NOT do.
import { BadRequestError } from '../../../shared/errors/app-error';

/** Same floor as the PII reveal, for the same reason: below twenty characters, people type "fraud" and move on. */
export const MIN_SUSPENSION_REASON = 20;

/**
 * **WHAT A TENANT SUSPENSION DOES AND DOES NOT DO — THE LIST, IN ONE PLACE.**
 *
 * W154 renders this to the staff member before they act, so the screen and the code read from the same source. A console
 * that described effects the code does not have would be the "claim printed with nothing behind it" this programme keeps
 * finding; a console that omitted an effect the code DOES have would be worse.
 */
export const SUSPENSION_EFFECTS = {
  /** Cannot obtain a token for THIS tenant (mint + refresh). Other tenants are untouched — the whole point of 0127. */
  blocksTenantSignIn: true,
  /** Resolves to zero roles and zero permissions in this tenant (`RoleCacheService`), invalidated immediately. */
  blocksTenantPermissions: true,
  /** Cannot create, publish or repost a listing in this tenant. */
  blocksListingWrites: true,
  /** Existing live listings stop being publicly visible — the six read paths share one predicate. */
  hidesListingsFromBuyers: true,
  /** The seller can still SEE their own catalogue: hiding it from them too makes the platform look broken, not strict. */
  ownerStillSeesOwnListings: true,
  /**
   * **FALSE, AND THIS IS THE PROMISE THE WHOLE FEATURE IS JUDGED BY.** W154: "money owed still pays out — suspension
   * never confiscates." `PayoutService` does not import this module and must never learn to. A test asserts the absence.
   */
  blocksPayouts: false,
  /** In-flight orders continue: a buyer who paid for groundnut is owed groundnut, whatever the seller's standing. */
  cancelsInFlightOrders: false,
  /** Nothing tells the member yet (TENANT-1b-2-Q1). The console says so, so staff know to telephone them. */
  notifiesMember: false,
} as const;

export interface SuspensionRecord {
  id: string;
  userId: string;
  reason: string;
  suspendedBy: string;
  createdAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
  liftReason: string | null;
}

/** A reason that is a reason: trimmed before measuring, so twenty spaces is refused. Returns the trimmed text, because
 *  the stored value should not carry whatever whitespace was pasted. */
export function requireReason(raw: string, act: 'suspend' | 'lift'): string {
  const reason = (raw ?? '').trim();
  if (reason.length < MIN_SUSPENSION_REASON) {
    throw new BadRequestError(
      `a reason of at least ${MIN_SUSPENSION_REASON} characters is required to ${act} a member`,
      { act, minLength: MIN_SUSPENSION_REASON },
    );
  }
  return reason;
}

/**
 * **A STAFF MEMBER MAY NOT SUSPEND THEMSELVES**, which is also a database CHECK (`ck_tms_not_self`).
 *
 * Not a theoretical rule: a member desk operator who suspends their own account takes their own listings off the market
 * with an audit trail pointing only at themselves, and then cannot sign in to undo it. The database refuses it too,
 * because a rule enforced only in the service is a rule the next caller of the repository does not have.
 */
export function assertNotSelf(actorUserId: string, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    throw new BadRequestError('a member cannot suspend or reinstate themselves', { reason: 'self_action' });
  }
}

/** True when this member is currently suspended in this tenant — a live episode is one with no lift. */
export function isLive(r: Pick<SuspensionRecord, 'liftedAt'> | null | undefined): boolean {
  return !!r && r.liftedAt === null;
}

/**
 * Can a suspension be created?
 *
 * **THE SECOND SUSPENSION OF AN ALREADY-SUSPENDED MEMBER IS A NO-OP, NOT AN ERROR — BUT IT IS REPORTED AS A NO-OP.** Two
 * live episodes would make "is this member suspended" a question with two answers (the unique index refuses them
 * anyway). A silent success would tell staff their new reason was recorded when it was not, so the service returns the
 * EXISTING episode and the console says the member was already suspended, with the original reason and date.
 */
export function suspendVerdict(existing: SuspensionRecord | null): 'create' | 'already_suspended' {
  return isLive(existing) ? 'already_suspended' : 'create';
}

/** Can a suspension be lifted? Lifting nothing is an error rather than a no-op: the staff member believes a member is
 *  suspended and they are not, and quietly agreeing would leave them thinking they had fixed something. */
export function liftVerdict(existing: SuspensionRecord | null): 'lift' | 'not_suspended' {
  return isLive(existing) ? 'lift' : 'not_suspended';
}

/**
 * How long a member already signed in can still act, in seconds.
 *
 * **THIS PLATFORM'S RBAC IS CARRIED IN THE ACCESS TOKEN**, so every revocation — a role removal, a permission deny, this
 * suspension — is bounded by `JWT_ACCESS_TTL_SEC` for somebody holding a live token. That is pre-existing and it is not
 * hidden: the console prints this number, because a staff member suspending a member for fraud needs to know whether the
 * cut-off is instant. The listing write and read paths ARE immediate, so in that window the member cannot list, cannot
 * publish, and cannot be found by a buyer.
 */
export function signInGraceSeconds(accessTtlSec: number): number {
  return Math.max(0, Math.floor(accessTtlSec));
}
