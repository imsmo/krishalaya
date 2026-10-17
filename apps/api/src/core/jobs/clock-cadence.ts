// core/jobs/clock-cadence.ts · PC-56 HOTFIX-5 · B1 (founder D2) — THE CADENCE TABLE FOR THE ORDER AND OFFER CLOCKS.
//
// `SellerConfirmTimeoutJob`, `AutoCompleteQualityWindowJob` and `ExpireOffersJob` were written, provided and exported, and registered
// NOWHERE (survey C-2 / F-1): no order ever auto-cancelled (2c's reservation held stock for ever), no delivered order ever completed (the
// farmer's escrow was never released), no offer ever expired. They are now registered in `SCHEDULED_JOB_REGISTRY` by their modules, and
// each takes its interval from THIS table — never a literal in the job class — so the founder's Law 9 review reads every money clock's
// cadence in one place. The runner (core/jobs/jobs.runner.ts) runs each under its own advisory lock, so N pods never race one sweep.
//
//   seller-confirm-timeout    every 5 min   the 24 h acceptance window (orders.acceptance_deadline) is late by at most one tick
//   quality-window-complete   every 15 min  the 24 h quality window (orders.quality_window_ends) — escrow release is not minute-critical
//   offers-expire             every 5 min   an offer's expires_at (72 h default) is late by at most one tick
//   group-lots-deadline       every 15 min  PC-56 STORE-3c · B8 (founder D3): an unfilled `pledging` group lot past its pledge_deadline is
//                                           cancelled (`target_missed`) — no money moves; a lot closes at most one tick late
//   dispute-seller-response-timeout  every 15 min  PC-56 HOTFIX-7 · B23 (survey STORE-5 C-6 / F-10): a dispute still `open` past its
//                                           `seller_respond_by` (raised + 48 h) moves to `under_review` (a moderator picks it up) and emits
//                                           `disputes.dispute_under_review` — no money moves, no notice is sent (nothing maps the event to a
//                                           template); the 48 h window is late by at most one tick
//   dispute-sla-escalation    every 60 min  PC-56 HOTFIX-7 · B23: an active dispute (open / seller_responded / under_review) past its `sla_due_at`
//                                           (raised + 7 d) moves to `escalated` and emits `disputes.dispute_escalated` (the support module opens a
//                                           P1 ticket, idempotent per dispute) — no money moves, no notice; the 7-day SLA is late by at most an hour
//   review-prompts            every 60 min  PC-56 STORE-5a · B3 (founder D3, survey C-4 / F-10): ONE `review.prompt` per recorded eligibility (an
//                                           order or booking completed within the last 7 days, its window still open) and ONE `review.reminder`
//                                           `reviews.reminder_after_days` after the invite while the window is open and nobody has reviewed the
//                                           order — no money moves; an invite is late by at most an hour
export const CLOCK_CADENCE_MS = Object.freeze({
  'seller-confirm-timeout': 5 * 60_000,
  'quality-window-complete': 15 * 60_000,
  'offers-expire': 5 * 60_000,
  'group-lots-deadline': 15 * 60_000,
  'dispute-seller-response-timeout': 15 * 60_000,
  'dispute-sla-escalation': 60 * 60_000,
  'review-prompts': 60 * 60_000,
} as const);

export type ClockName = keyof typeof CLOCK_CADENCE_MS;
export const CLOCK_NAMES = Object.freeze(Object.keys(CLOCK_CADENCE_MS) as ClockName[]);

/** The registered interval for one clock. */
export function cadenceOf(name: ClockName): number { return CLOCK_CADENCE_MS[name]; }
