// modules/requirements/domain/response-group.ts · PC-56 TENANT-11d · F-11 — THE POOLED QUOTE'S STATE MACHINE. PURE.
//
// Founder decision: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND. The desk assembles a group of
// lines (one per member) from member stock; each member says yes to THEIR line's exact figures; only then can the group be
// sent, which writes one `requirement_responses` row per line (status submitted, group_id set) in one transaction.
//
//   draft ⇄ consent_pending   while the desk edits (consent_pending = at least one line lacks its member's yes)
//   draft | consent_pending → submitted   send (refused while ANY line lacks consent — CONSENT_MISSING names the member)
//   draft | consent_pending → withdrawn   the desk drops the draft
//   submitted → accepted | rejected       the buyer (or the desk with the buyer's consent for that act)
//   submitted → withdrawn                 the desk withdraws the sent quote (its live responses lapse as rejected)
// The DB trigger trg_rrg_moves (0189) holds the same edges.
import { DomainError } from '../../../shared/errors/app-error';

export const GROUP_STATUSES = ['draft', 'consent_pending', 'submitted', 'accepted', 'rejected', 'withdrawn'] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];
const EDGES: Readonly<Record<GroupStatus, readonly GroupStatus[]>> = Object.freeze({
  draft:           ['draft', 'consent_pending', 'submitted', 'withdrawn'],
  consent_pending: ['draft', 'consent_pending', 'submitted', 'withdrawn'],
  submitted:       ['accepted', 'rejected', 'withdrawn'],
  accepted:        [],
  rejected:        [],
  withdrawn:       [],
});

export class IllegalGroupTransitionError extends DomainError {
  constructor(from: string, to: string) { super('REQUIREMENT_GROUP_ILLEGAL_TRANSITION', `Cannot move the pooled quote ${from}→${to}`, 409, { from, to }); }
}
export function assertGroupTransition(from: GroupStatus, to: GroupStatus): void {
  if (!(EDGES[from] ?? []).includes(to)) throw new IllegalGroupTransitionError(from, to);
}
export const isEditable = (s: GroupStatus) => s === 'draft' || s === 'consent_pending';

/** What the draft is, from its live lines: no lines or every line consented → draft; any line without consent → consent_pending. */
export function draftStatusFor(lines: ReadonlyArray<{ consentId: string | null }>): 'draft' | 'consent_pending' {
  return lines.some((l) => !l.consentId) ? 'consent_pending' : 'draft';
}

/** Canon W132: "valid 48h". A sent pooled quote (and each response it wrote) is valid for 48 hours from the send. */
export const GROUP_VALID_MS = 48 * 3600_000;
