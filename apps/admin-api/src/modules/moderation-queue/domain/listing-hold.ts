// apps/admin-api/src/modules/moderation-queue/domain/listing-hold.ts · W090 + W091, PURE (PC-56 ADMIN-5f).
//
// W089's first principle governs this whole module: **"Hold fast, remove slow — a held listing is reversible, a wrong
// removal costs a farmer income."** Everything below is asymmetric in that direction on purpose. A hold is one
// operator, immediate, and cheap to undo. A removal at or above ₹1,00,000 of value at stake needs a second person and
// cannot be undone at all.
//
// THE DEFECT THIS PLANE EXISTS TO FIX. Handling a report with `action: 'removed'` wrote `action_taken = 'removed'`,
// emitted `ai.moderation_actioned`, and returned 200 — and **no listings handler subscribes to that event.**
// `Listing.hide()` has exactly one caller in the repository and it is a unit test. So the queue said the marketplace
// was cleaned and the listing stayed published and purchasable. Third occurrence of the same pattern: a status column
// recording an act no code performs.
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidModerationOrderError, ModerationNotApprovableError } from './moderation-queue.errors';

export const HOLD_ACTIONS = ['hold', 'release', 'remove'] as const;
export type HoldAction = (typeof HOLD_ACTIONS)[number];

/** W090's source chips. A free-text source would let a fourth be invented to justify a hold. */
export const HOLD_SOURCES = ['fraud_flag', 'reported', 'regulated_category', 'spot_audit'] as const;
export type HoldSource = (typeof HOLD_SOURCES)[number];

/** W090: "removals of value ≥ ₹1,00,000 are maker-checker". Minor units — money is never a rupee figure in code. */
export const REMOVAL_CHECKER_THRESHOLD_MINOR = 10_000_000n;   // ₹1,00,000.00

/** W090: "Hold SLA 4h … Queue pages the lead at 3h." */
export const HOLD_SLA_HOURS = 4;
export const HOLD_PAGE_LEAD_HOURS = 3;

/** The reason is sent to the farmer about their own produce, so it is not a code. */
export const REASON_MIN = 20;

/* ------------------------------------------------------------------------------------------------ */
/* THE LISTING LIFECYCLE, DUPLICATED DELIBERATELY                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** The transitions a HOLD may make, copied from apps/api's `listing.state.ts` rather than imported.
 *
 *  admin-api is a separate deployable and must not depend on the other app's internals — the same reasoning as
 *  ADMIN-5d's `OBSERVED_PRODUCERS`. The cost is that this list can go stale, so the mirror is NARROW (only the
 *  transitions this plane performs) and the source is named. A wider copy would be a second state machine.
 *
 *  `held` may be reached from `published` or `paused`; it releases to `published` or ends in `archived`. It
 *  deliberately cannot become `hidden`: hidden is the SELLER's state, and moving a listing there would disguise a
 *  platform action as the seller's own decision.
 */
export const HOLDABLE_FROM = Object.freeze(['published', 'paused'] as const);
export const RELEASE_TO = 'published' as const;
export const REMOVE_TO = 'archived' as const;
export const LISTING_STATE_SOURCE = 'apps/api/src/modules/listings/domain/listing.state.ts' as const;

export function isHoldable(status: string): boolean {
  return (HOLDABLE_FROM as readonly string[]).includes(status);
}

/* ------------------------------------------------------------------------------------------------ */
/* VALUE AT STAKE                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** W090's "Value at stake" column, and the figure the removal threshold is judged against.
 *
 *  `price_minor` is a bigint and `quantity_available` is `numeric(14,3)`, so the product is money × a fractional
 *  quantity and the arithmetic has to be decided rather than assumed. THREE DECISIONS, all of them stated because a
 *  reader will otherwise assume the easy answer:
 *
 *  1. **The quantity arrives as a STRING and is scaled to an integer of thousandths.** `Number('18.500')` is fine and
 *     `Number` on a 14-digit quantity is not, and there is no reason to find out which one somebody types.
 *  2. **The product is computed in bigint and divided at the END**, so the rounding happens once. Multiplying a
 *     rounded price by a quantity compounds the error per row, and this figure gates a maker-checker.
 *  3. **It rounds HALF UP, and therefore never understates.** The direction matters because the number decides
 *     whether a second signature is required: a removal at exactly the threshold must not slip under it because of a
 *     half-paisa. Rounding down would make the cheaper path the accidental default, which is the one thing Rule Zero
 *     forbids.
 */
export function valueAtStakeMinor(priceMinor: bigint, quantityAvailable: string): bigint {
  const q = (quantityAvailable ?? '').trim();
  if (!/^[0-9]{1,14}(\.[0-9]{1,3})?$/.test(q)) {
    throw new InvalidModerationOrderError('the listing quantity could not be read, so the value at stake cannot be computed');
  }
  const [whole, frac = ''] = q.split('.');
  const thousandths = BigInt(whole) * 1000n + BigInt((frac + '000').slice(0, 3));
  if (priceMinor < 0n) throw new InvalidModerationOrderError('a listing price cannot be negative');
  const scaled = priceMinor * thousandths;              // minor units × thousandths
  // Half-up on the final division only.
  return (scaled + 500n) / 1000n;
}

/** Whether a REMOVAL at this value needs a second operator. */
export function removalNeedsChecker(valueMinor: bigint): boolean {
  return valueMinor >= REMOVAL_CHECKER_THRESHOLD_MINOR;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE SLA                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export type HoldSla =
  | { kind: 'unmeasured' }
  | { kind: 'ok'; hoursLeft: number }
  | { kind: 'page_lead'; hoursLeft: number }
  | { kind: 'breached'; hoursOver: number };

/** W090: the deadline is 4 hours from the hold, and the lead is paged at 3.
 *
 *  `unmeasured` when there is no deadline, and unmeasured is NOT ok — a hold with no clock cannot be shown to be
 *  inside its SLA, and on this queue the farmer under it is losing money by the hour.
 */
export function holdSla(dueAt: string | null | undefined, now: Date): HoldSla {
  if (!dueAt) return { kind: 'unmeasured' };
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) return { kind: 'unmeasured' };
  const hoursLeft = (t - now.getTime()) / 3_600_000;
  if (hoursLeft < 0) return { kind: 'breached', hoursOver: Math.round(-hoursLeft * 10) / 10 };
  // The lead is paged with one hour left on a four-hour window — which is what "pages at 3h" means measured forward.
  if (hoursLeft <= HOLD_SLA_HOURS - HOLD_PAGE_LEAD_HOURS) return { kind: 'page_lead', hoursLeft: Math.round(hoursLeft * 10) / 10 };
  return { kind: 'ok', hoursLeft: Math.round(hoursLeft * 10) / 10 };
}

export function holdDeadline(heldAt: Date): Date {
  return new Date(heldAt.getTime() + HOLD_SLA_HOURS * 3_600_000);
}

/* ------------------------------------------------------------------------------------------------ */
/* THE ORDERS                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export interface OrderInput {
  action: HoldAction;
  source: HoldSource;
  sourceRef?: string | null;
  reason: string;
  valueAtStakeMinor: bigint;
}

export function assertReason(reason: unknown): string {
  if (typeof reason !== 'string') throw new InvalidModerationOrderError('a reason is required');
  const v = reason.trim();
  if (v.length < REASON_MIN) {
    throw new InvalidModerationOrderError(
      `a reason of at least ${REASON_MIN} characters is required — it is sent to the farmer about their own produce, `
      + 'and "policy violation" tells them nothing they can act on or appeal');
  }
  if (v.length > 2000) throw new InvalidModerationOrderError('a reason must be at most 2000 characters');
  return v;
}

/** Whether this listing may be HELD at all.
 *
 *  A listing already held is refused rather than re-held: a second hold would reset the SLA clock, and an SLA that
 *  restarts every time somebody looks at a case is not a deadline.
 */
export function assertHoldable(currentStatus: string, alreadyHeldAt: string | null): void {
  if (alreadyHeldAt) {
    throw new InvalidModerationOrderError(
      'this listing is already held. Releasing and re-holding would restart the 4-hour clock, so the existing hold '
      + 'stands and its deadline is the one that counts');
  }
  if (!isHoldable(currentStatus)) {
    throw new InvalidModerationOrderError(
      `a ${currentStatus} listing cannot be held — only a published or paused one can (see ${LISTING_STATE_SOURCE})`);
  }
}

export function assertReleasable(alreadyHeldAt: string | null): void {
  if (!alreadyHeldAt) throw new InvalidModerationOrderError('this listing is not held, so there is nothing to release');
}

export type RemoveBlock =
  | { ok: true; needsChecker: boolean }
  | { ok: false; reason: 'not_held' }
  | { ok: false; reason: 'needs_checker'; valueMinor: bigint };

/** W090/W091: a removal is the irreversible act, so it happens from a HOLD rather than directly from published.
 *
 *  That ordering is the "remove slow" half of the principle made structural: to remove a listing an operator must
 *  first hold it, which means the seller has already been told it is under review and has had the chance to respond.
 *  A remove button on a live listing would let one click end a farmer's sale with no interval at all.
 */
export function removeState(alreadyHeldAt: string | null, valueMinor: bigint, checker: string | null): RemoveBlock {
  if (!alreadyHeldAt) return { ok: false, reason: 'not_held' };
  if (removalNeedsChecker(valueMinor) && !checker) return { ok: false, reason: 'needs_checker', valueMinor };
  return { ok: true, needsChecker: removalNeedsChecker(valueMinor) };
}

/** The write-side gate for a removal. THE NINTH MAKER-CHECKER SITE. */
export function assertRemovable(args: {
  alreadyHeldAt: string | null; valueMinor: bigint; actor: string; heldBy: string | null; checker: string | null;
}): { needsChecker: boolean } {
  const { alreadyHeldAt, valueMinor, actor, heldBy, checker } = args;
  const s = removeState(alreadyHeldAt, valueMinor, checker);
  if (!s.ok) {
    if (s.reason === 'not_held') {
      throw new InvalidModerationOrderError(
        'a listing must be held before it can be removed. Holding tells the seller their listing is under review and '
        + 'gives them the chance to respond — a removal straight from published ends a sale with no interval at all');
    }
    throw new ModerationNotApprovableError(
      `this listing is worth ${s.valueMinor} minor units, at or above the ${REMOVAL_CHECKER_THRESHOLD_MINOR} threshold. `
      + 'A removal of this size needs a second operator.');
  }
  if (s.needsChecker) {
    assertSecondPerson(
      'removing a high-value listing', heldBy, actor,
      'The operator who placed the hold cannot also sign off the removal. A wrong removal costs a farmer income and '
      + 'cannot be undone.');
    // `checker` is the actor here; the constraint `ck_lmo_maker_ne_checker` refuses the overlap in the database too.
  }
  return { needsChecker: s.needsChecker };
}

/* ------------------------------------------------------------------------------------------------ */
/* WHAT THE FARMER IS TOLD                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** W091: "farmer sees 'under review' honestly — with ETA". The ETA is the SLA deadline, and it is shown as a real
 *  time rather than "shortly", because "shortly" on perishable produce is not information. */
export const APPEAL_PATH = '/help/appeal' as const;

export interface NoticePlan { recipientKind: 'subject_owner' | 'reporter'; body: string; appealPath: string }

/** The notices an order owes. Composed here so the set is decided by the ACTION rather than by whoever wrote the
 *  service — W089's second principle is "every action explains itself", and an action that silently owed no notice
 *  would be the exception nobody noticed.
 *
 *  A RELEASE notifies the seller too. That is not politeness: their listing was stopped and is now live again, and
 *  the platform that interrupted the sale is the one that has to say it is over.
 */
export function noticesFor(action: HoldAction, hasReporter: boolean): NoticePlan['recipientKind'][] {
  const out: NoticePlan['recipientKind'][] = ['subject_owner'];
  // W092: "Reporters hear back on every report — even dismissals get a respectful explanation." A hold is not an
  // outcome yet, so the reporter hears at the END — on release or removal — rather than twice.
  if (hasReporter && action !== 'hold') out.push('reporter');
  return out;
}

export function assertLanguage(code: unknown, activeLanguages: readonly string[]): string {
  if (typeof code !== 'string' || !code.trim()) {
    throw new InvalidModerationOrderError('the language the notice is written in is required');
  }
  const c = code.trim();
  if (!activeLanguages.includes(c)) {
    throw new InvalidModerationOrderError(
      `'${c}' is not an active platform language. A notice composed in one language and delivered under another `
      + "template is a message the farmer cannot read wearing a label saying they can");
  }
  return c;
}
