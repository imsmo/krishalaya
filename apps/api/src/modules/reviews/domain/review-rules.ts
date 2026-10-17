// modules/reviews/domain/review-rules.ts · PC-56 STORE-5a · B1 (founder D2 / D3 / D5) — THE REVIEW RULES THE CANON STATES, IN ONE PLACE. PURE.
//
// No I/O, no clock of its own: every rule takes `now` (Law 5 — the rule in the domain, the clock passed in; the live spec moves the instants,
// never the code). The NUMBERS are platform settings (migration 0218: `reviews.edit_window_hours` 168, `reviews.invite_window_days` 30,
// `reviews.reminder_after_days` 7) read by the repository; the constants below are the NAMED fallbacks used only when a setting is absent or
// malformed (logged by the caller — never a silent literal, the 3b `OFFER_ROUND_TTL_FALLBACK_H` precedent).
//
//   • THE EDIT WINDOW (D3): an author edits for `edit_window_hours` after submitting, then the review is LOCKED. The lock instant is stamped
//     on the row at submit (`reviews.edit_locks_at`); a row without one is read as locked (fail closed — a verdict is kept, never edited away).
//   • THE INVITE WINDOW (D3): the parties of a completed order may review for `invite_window_days` after the eligibility was recorded
//     (`review_eligibility.expires_at`). A row without an expiry (written outside the handlers — a fixture) is read as open.
//   • ONE INVITE, ONE REMINDER (D3): the reminder is due once — after the invite, `reminder_after_days` later, while the window is open and
//     no review exists for the order.
//   • THE DIMENSIONS ARE A VOCABULARY (Law 6): a sub-rating key must be an ACTIVE `review_dimension` code.
//   • THE REPLY IS THE ORGANISATION'S (D2): served as `respondedBy: 'organisation'` — never the responder's name or id.
//   • THE REVIEWER IS "VERIFIED BUYER" (D5): the public label is derived from `isVerifiedPurchase` only — no masked name, no city.
export const REVIEW_EDIT_WINDOW_FALLBACK_H = 168;
export const REVIEW_INVITE_WINDOW_FALLBACK_D = 30;
export const REVIEW_REMINDER_AFTER_FALLBACK_D = 7;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A positive whole number from a setting's raw value, else null (the caller then uses the named fallback and says so). */
export function positiveInt(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** When a review written at `createdAt` stops being editable. */
export function editLocksAt(createdAt: Date, windowHours: number): Date {
  return new Date(createdAt.getTime() + windowHours * HOUR);
}

/** May the author still edit? Strictly before the lock instant; no recorded lock → locked (fail closed). */
export function canEdit(now: Date, locksAt: Date | null | undefined): boolean {
  return locksAt instanceof Date && !Number.isNaN(locksAt.getTime()) && now.getTime() < locksAt.getTime();
}

/** When an eligibility recorded at `completedAt` stops admitting a review. */
export function eligibilityExpiresAt(completedAt: Date, days: number): Date {
  return new Date(completedAt.getTime() + days * DAY);
}

/** Is the review window open? Strictly before the expiry; no recorded expiry → open (a row written outside the eligibility handlers). */
export function isWindowOpen(now: Date, expiresAt: Date | null | undefined): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;
  return now.getTime() < expiresAt.getTime();
}

export interface ReminderFacts { promptedAt: Date | null; remindedAt: Date | null; expiresAt: Date | null; reviewed: boolean }
/** The ONE reminder: invited, not yet reminded, `afterDays` since the invite, the window still open, nobody has reviewed the order. */
export function reminderDue(e: ReminderFacts, now: Date, afterDays: number): boolean {
  if (!e.promptedAt || e.remindedAt || e.reviewed) return false;
  if (now.getTime() - e.promptedAt.getTime() < afterDays * DAY) return false;
  return e.expiresAt !== null && isWindowOpen(now, e.expiresAt);
}

/** The sub-rating keys that are NOT in the active vocabulary (empty = every key is a known dimension). */
export function unknownDimensions(subRatings: Record<string, unknown> | null | undefined, vocabulary: readonly string[]): string[] {
  const known = new Set(vocabulary);
  return Object.keys(subRatings ?? {}).filter((k) => !known.has(k)).sort();
}
/** Every sub-rating key is a known dimension. */
export function validDimensions(subRatings: Record<string, unknown> | null | undefined, vocabulary: readonly string[]): boolean {
  return unknownDimensions(subRatings, vocabulary).length === 0;
}

/** Who replied, as every read serves it: the ORGANISATION, never a person (founder D2). */
export const ORGANISATION_REPLY = 'organisation' as const;
export type ReplyAuthor = typeof ORGANISATION_REPLY;
/** The reply half of a review as every read serves it — `respondedBy` is the organisation when a reply exists, else null. */
export function organisationReply(response: string | null | undefined, respondedAt: Date | null | undefined): { sellerResponse: string | null; sellerRespondedAt: Date | null; respondedBy: ReplyAuthor | null } {
  const text = typeof response === 'string' && response.length > 0 ? response : null;
  return { sellerResponse: text, sellerRespondedAt: text ? (respondedAt ?? null) : null, respondedBy: text ? ORGANISATION_REPLY : null };
}

/** The public reviewer label (founder D5): "Verified buyer" for a verified purchase — nothing else is ever said about the reviewer. */
export const VERIFIED_BUYER = 'verified_buyer' as const;
export function reviewerLabel(isVerifiedPurchase: boolean): typeof VERIFIED_BUYER | null {
  return isVerifiedPurchase ? VERIFIED_BUYER : null;
}

/** The moderation acts and who may perform them (founder D2): `flag` → under_moderation with `review.flag` OR `review.moderate`; hide /
 *  remove / restore with `review.moderate` only (the platform desk). */
export type ModerationAct = 'hide' | 'restore' | 'flag' | 'remove';
export function mayModerate(act: ModerationAct, who: { canModerate: boolean; canFlag: boolean }): boolean {
  if (act === 'flag') return who.canFlag || who.canModerate;
  return who.canModerate;
}
