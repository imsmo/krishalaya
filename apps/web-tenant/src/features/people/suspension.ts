// apps/web-tenant/src/features/people/suspension.ts · pure logic for W154's danger zone (PC-56 TENANT-1b-2).
//
// No React, no I/O — so the rules below are unit-tested rather than clicked.

/** Mirrors the server's floor and the CHECK constraint on `tenant_member_suspensions.reason`. The SERVER and the DATABASE
 *  are the controls; this exists so a staff member learns the rule before losing their typing to a round trip. */
export const MIN_SUSPENSION_REASON = 20;

export type ReasonBuild = { ok: true; value: string } | { ok: false; error: 'reason' };

/** Trimmed before measured, and the trimmed text is what gets sent — so the stored reason is not padded with whatever
 *  whitespace was pasted, and twenty spaces is not a reason. */
export function buildSuspensionReason(raw: string): ReasonBuild {
  const reason = (raw ?? '').trim();
  if (reason.length < MIN_SUSPENSION_REASON) return { ok: false, error: 'reason' };
  return { ok: true, value: reason.slice(0, 500) };
}

/**
 * **THE EFFECT LIST THE CONSOLE PRINTS BEFORE THE STAFF MEMBER ACTS.**
 *
 * Keys, not sentences, so all three languages carry them. This list mirrors `SUSPENSION_EFFECTS` in
 * `apps/api/.../domain/member-suspension.ts` — the screen and the code describe the same act, which is the whole
 * difference between a warning and a decoration. Note what is on it: two things the suspension does NOT do, because a
 * staff member's first question is "does this stop their money" and the answer must be on the screen, not in a manual.
 */
export const SUSPENSION_EFFECT_KEYS = [
  'signIn',      // cannot sign in to THIS organisation — their other organisations are untouched
  'permissions', // no permissions here
  'listingNew',  // cannot create, publish or repost
  'listingLive', // live listings leave the marketplace, the seller profile count and the price band
  'ownSight',    // they can still see their own catalogue
  'payouts',     // MONEY OWED STILL PAYS OUT — the promise the feature is judged by
  'orders',      // in-flight orders continue: the buyer paid
  'notice',      // nothing tells them automatically — ring them
] as const;

/** The three states W154's danger zone can be in. Distinct because they need three different sets of controls, and
 *  rendering one control disabled would leave a staff member guessing which case they are in. */
export function suspensionState(live: { liftedAt: string | null } | null | undefined): 'active' | 'suspended' {
  return live && live.liftedAt === null ? 'suspended' : 'active';
}

/** True when this staff member is looking at their own record. The API and the database both refuse a self-suspension
 *  (`ck_tms_not_self`); the console hides the control so nobody types a reason for an act that cannot happen. */
export function isSelf(viewerUserId: string | null | undefined, memberUserId: string): boolean {
  return !!viewerUserId && viewerUserId === memberUserId;
}
