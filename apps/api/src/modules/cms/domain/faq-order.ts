// modules/cms/domain/faq-order.ts · PC-56 TENANT-8c · W177 *"grouped by topic"* — the FAQ reorder act's arithmetic.
//
// An FAQ entry is a SLUG of `page_kind = 'faq'` (one row per version); its place inside its topic is `sort_order`,
// carried on every version of the slug (the order belongs to the entry, not to one version of its words). A move is
// computed here as a PLAN — which slugs take which number — and the service applies it inside one transaction on the
// topic's rows, LOCKED, judging the move against the order AS IT STANDS when the act runs (7b's rule: a confirm screen
// is not a token), under the form's Idempotency-Key, with a reason and an audit row. The plan renumbers the topic to a
// contiguous 1..n as a side effect, so entries written before 0177 (all `0`) come out in a stable order (by slug).
export interface FaqEntryPlace { slug: string; sortOrder: number }
export interface FaqMoveStep { slug: string; from: number; to: number }
export type FaqMoveDirection = 'up' | 'down';
export const FAQ_MOVE_REFUSALS = ['ENTRY_NOT_IN_TOPIC', 'AT_TOP', 'AT_BOTTOM'] as const;
export type FaqMoveRefusal = (typeof FAQ_MOVE_REFUSALS)[number];

export type FaqMovePlan = { ok: true; steps: FaqMoveStep[]; order: string[] } | { ok: false; refusal: FaqMoveRefusal };

/** The topic's entries in their stored order: place, then slug (a tie — every pre-0177 entry is 0 — reads by slug). */
export function orderedFaq(entries: readonly FaqEntryPlace[]): FaqEntryPlace[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** One entry moved one place inside its topic. */
export function planFaqMove(entries: readonly FaqEntryPlace[], slug: string, direction: FaqMoveDirection): FaqMovePlan {
  const sorted = orderedFaq(entries);
  const idx = sorted.findIndex((e) => e.slug === slug);
  if (idx < 0) return { ok: false, refusal: 'ENTRY_NOT_IN_TOPIC' };
  if (direction === 'up' && idx === 0) return { ok: false, refusal: 'AT_TOP' };
  if (direction === 'down' && idx === sorted.length - 1) return { ok: false, refusal: 'AT_BOTTOM' };
  const order = sorted.map((e) => e.slug);
  const j = direction === 'up' ? idx - 1 : idx + 1;
  [order[idx], order[j]] = [order[j], order[idx]];
  return { ok: true, steps: renumberFaq(sorted, order), order };
}

/** Every slug whose number changes when `order` becomes 1..n — and only those. */
export function renumberFaq(current: readonly FaqEntryPlace[], order: readonly string[]): FaqMoveStep[] {
  const by = new Map(current.map((e) => [e.slug, e.sortOrder]));
  const steps: FaqMoveStep[] = [];
  order.forEach((slug, i) => {
    const from = by.get(slug);
    if (from === undefined) return;
    if (from !== i + 1) steps.push({ slug, from, to: i + 1 });
  });
  return steps;
}

/** The place a NEW entry takes in its topic: after the last. */
export function nextFaqPlace(entries: readonly FaqEntryPlace[]): number {
  return entries.reduce((m, e) => (e.sortOrder > m ? e.sortOrder : m), 0) + 1;
}

/** 1-based position of an entry in its topic, as W177 prints it; null when absent. */
export function faqPosition(entries: readonly FaqEntryPlace[], slug: string): number | null {
  const i = orderedFaq(entries).findIndex((e) => e.slug === slug);
  return i < 0 ? null : i + 1;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ACT'S VERDICT                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

export const FAQ_ACT_REFUSALS = ['NO_PERMISSION', 'NOT_FAQ', ...FAQ_MOVE_REFUSALS, 'REASON_REQUIRED', 'REASON_TOO_LONG'] as const;
export type FaqActRefusal = (typeof FAQ_ACT_REFUSALS)[number];
export const MIN_MOVE_REASON = 3;
export const MAX_MOVE_REASON = 300;

export interface FaqMoveVerdict { allowed: boolean; refusals: FaqActRefusal[]; plan: FaqMovePlan | null; topic: string | null }

/** Every reason this move would be refused (the confirm screen prints them all). */
export function faqMoveVerdict(i: {
  canAuthor: boolean; topic: string | null; entries: readonly FaqEntryPlace[]; slug: string; direction: FaqMoveDirection; reason: string | null | undefined;
}): FaqMoveVerdict {
  const refusals: FaqActRefusal[] = [];
  if (!i.canAuthor) refusals.push('NO_PERMISSION');
  let plan: FaqMovePlan | null = null;
  if (i.topic === null) refusals.push('NOT_FAQ');
  else {
    plan = planFaqMove(i.entries, i.slug, i.direction);
    if (!plan.ok) refusals.push(plan.refusal);
  }
  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_MOVE_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_MOVE_REASON) refusals.push('REASON_TOO_LONG');
  return { allowed: refusals.length === 0, refusals, plan, topic: i.topic };
}
