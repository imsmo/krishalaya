// modules/disputes/domain/dispute-console.ts · W140's tabs and its KPI vocabulary (PC-56 TENANT-3b). Pure, no I/O.
//
// W140 draws four tabs — "needs response · under_review · escalated · closed (90d)" — over a SEVEN-state machine.
// ONE mapping, in one place, exhaustive: a status that fell through would vanish from every tab, and a dispute in no
// tab is a dispute nobody works. (Third application of the rule TENANT-3a's order views established, and the same
// pinning test guards it: the mapping is checked against DISPUTE_STATUSES itself, not against a copy.)
import { DISPUTE_STATUSES, DisputeStatus } from './dispute.state';

export const DISPUTE_VIEWS = ['needs_response', 'under_review', 'escalated', 'closed'] as const;
export type DisputeView = (typeof DISPUTE_VIEWS)[number];

const VIEW_OF: Record<DisputeStatus, DisputeView> = {
  // `open` waits on the respondent; `seller_responded` waits on a moderator. Both are ON THE TENANT'S DESK, which is
  // what W140's first tab means — a queue of things a human here must do next.
  open: 'needs_response',
  seller_responded: 'needs_response',
  under_review: 'under_review',
  escalated: 'escalated',
  resolved: 'closed',
  rejected: 'closed',
  withdrawn: 'closed',
};

export function viewOfDisputeStatus(status: string): DisputeView | null {
  return (VIEW_OF as Record<string, DisputeView>)[status] ?? null;
}
export function statusesInDisputeView(view: DisputeView): string[] {
  return DISPUTE_STATUSES.filter((s) => VIEW_OF[s] === view).slice().sort();
}

/** Which party a closed dispute went to. **`replacement` IS NOT A WIN FOR ANYBODY** — W140's own delta says it:
 *  "+ 6 amicable — nobody 'wins', orders get fixed". Folding replacements into the raiser's column would inflate a
 *  figure a tenant reads as "how often our sellers were found at fault". */
export type DisputeOutcomeSide = 'raiser' | 'respondent' | 'amicable' | 'no_decision';

export function outcomeSide(resolutionType: string | null, status: string): DisputeOutcomeSide {
  if (status === 'withdrawn') return 'no_decision';      // the raiser walked away; nobody decided anything
  if (resolutionType === 'refund_full' || resolutionType === 'refund_partial') return 'raiser';
  if (resolutionType === 'replacement') return 'amicable';
  if (resolutionType === 'rejected' || status === 'rejected') return 'respondent';
  return 'no_decision';
}

/** W140's SLA column ("9h left" / "2d left" / "platform"). Returns null where there is no clock to show — a
 *  countdown on a closed dispute, or on one with no `sla_due_at`, is a deadline invented for decoration (the
 *  TENANT-3a acceptance-clock rule, held). */
export type SlaClock = { kind: 'left'; minutes: number } | { kind: 'overdue'; minutes: number } | null;

export function slaClock(status: string, slaDueAt: Date | string | null, now: Date): SlaClock {
  if (viewOfDisputeStatus(status) === 'closed' || viewOfDisputeStatus(status) === null) return null;
  // An escalated dispute is the platform's clock, not the tenant's — W140 prints the word "platform" in that cell
  // instead of a countdown, because a tenant cannot meet a deadline they do not own.
  if (status === 'escalated') return null;
  if (!slaDueAt) return null;
  const ms = new Date(slaDueAt).getTime() - now.getTime();
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  return ms <= 0 ? { kind: 'overdue', minutes } : { kind: 'left', minutes };
}
