// modules/disputes/domain/refund-gate.ts · the maker-checker rule for tenant refunds (PC-56 TENANT-3b). Pure, no I/O.
//
// **THE FINDING THIS FILE ANSWERS: NO REFUND PATH IN THE PLATFORM HAS EVER HAD A SECOND PAIR OF EYES.** W140 prints
// "refund execution adds maker-checker ≥ ₹10,000", W141 prints "≥ ₹10,000 needs checker", W142 prints "refund
// execution needs order.refund + maker-checker ≥ ₹10,000" — and one person holding `dispute.resolve` could call
// POST /v1/disputes/:id/resolve with resolutionType='refund_full' and the wallet reversal ran. Three screens, one
// promise, zero implementations.
//
// **THE THRESHOLD IS A SETTING, NOT A CONSTANT** (Law 6, and 0139 puts it in `setting_definitions` with risk_class
// 'money_path'). ₹10,000 is an Indian number a tenant admin must be able to change after an incident without waiting
// for a deploy. The shipped default lives here so that an unreadable setting falls back to the STRICTER behaviour —
// the same direction TENANT-1's price-anomaly gate chose, and for the same reason: a replica blip must not be the
// reason a large refund goes out on one signature.
import { DomainError } from '../../../shared/errors/app-error';

export const CHECKER_THRESHOLD_KEY = 'disputes.refund_checker_threshold_minor';
/** ₹10,000 in paise — W140/W141/W142's figure, and 0139's `default_value`. */
export const DEFAULT_CHECKER_THRESHOLD_MINOR = 1_000_000n;
/** A proposal and a refusal each owe the other party a sentence (0139's CHECK, mirrored here so the API says which
 *  field is short instead of surfacing a constraint violation). */
export const MIN_NOTE_CHARS = 20;

// 'credit_note' added by 0140 (PC-56 TENANT-3c-1): a GST credit note is the same act from this plane's point of
// view — tenant money going back to a buyer, proposed by one person and signed by another, at an amount pinned on the
// approval row. Widening the set beat growing a second maker-checker with its own threshold to forget.
export const REFUND_SUBJECTS = ['dispute', 'return', 'credit_note'] as const;
export type RefundSubject = (typeof REFUND_SUBJECTS)[number];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'applied'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export class RefundGateError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) { super(code, message, 409, details); }
}

/** Read the tenant's threshold out of a jsonb setting value. Anything unreadable — absent key, a string, a float, a
 *  negative — falls back to the shipped default AND SAYS SO, so the caller can tell an operator they are running on
 *  the default rather than on their own figure. */
export function thresholdFrom(raw: unknown): { minor: bigint; usedDefault: boolean } {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return { minor: BigInt(raw), usedDefault: false };
  if (typeof raw === 'string' && /^\d{1,18}$/.test(raw)) return { minor: BigInt(raw), usedDefault: false };
  return { minor: DEFAULT_CHECKER_THRESHOLD_MINOR, usedDefault: true };
}

/** At OR ABOVE the threshold needs a checker — "≥ ₹10,000" is the canon's own operator, so a refund of exactly
 *  ₹10,000 is inside the rule, not outside it. A threshold of 0 therefore means EVERY refund needs two people,
 *  which is what 0139's description promises a cautious tenant. */
export function needsChecker(amountMinor: bigint, thresholdMinor: bigint): boolean {
  return amountMinor >= thresholdMinor;
}

export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  amountMinor: bigint;
  proposedBy: string;
  decidedBy: string | null;
}

/** What stands between this refund and the money moving. Every branch is a sentence a screen can print. */
export type RefundGate =
  /** Below the tenant's threshold: the holder of order.refund acts alone, and that is the tenant's own choice. */
  | { kind: 'single_signature' }
  /** At/above, and nothing has been proposed yet — the resolver proposes, someone else signs. */
  | { kind: 'needs_proposal'; thresholdMinor: bigint }
  | { kind: 'awaiting_checker'; approvalId: string }
  | { kind: 'rejected_by_checker'; approvalId: string }
  /** Approved, for THIS amount, by someone other than the proposer. The only branch that lets money move. */
  | { kind: 'ready'; approvalId: string }
  /** Approved — but for a different figure. A signature is for an amount, not for a dispute. */
  | { kind: 'amount_changed'; approvalId: string; approvedMinor: bigint }
  | { kind: 'already_applied'; approvalId: string };

export function refundGate(input: { amountMinor: bigint; thresholdMinor: bigint; approval: ApprovalView | null }): RefundGate {
  const { amountMinor, thresholdMinor, approval } = input;
  // An APPLIED approval is checked before the threshold: a second refund on a subject that already had one must be
  // refused even if the new figure happens to sit under the threshold. Otherwise ₹12,000 signed and applied, then
  // ₹9,000 alone, is a double refund with a clean audit trail.
  if (approval && approval.status === 'applied') return { kind: 'already_applied', approvalId: approval.id };
  if (!needsChecker(amountMinor, thresholdMinor)) return { kind: 'single_signature' };
  if (!approval) return { kind: 'needs_proposal', thresholdMinor };
  if (approval.status === 'pending') return { kind: 'awaiting_checker', approvalId: approval.id };
  if (approval.status === 'rejected') return { kind: 'rejected_by_checker', approvalId: approval.id };
  if (approval.amountMinor !== amountMinor) return { kind: 'amount_changed', approvalId: approval.id, approvedMinor: approval.amountMinor };
  // Belt and braces over 0139's CHECK: a row whose checker equals its proposer cannot exist, and if one ever did
  // (a hand-written UPDATE) it must not be the thing that lets money out.
  if (approval.decidedBy && approval.decidedBy === approval.proposedBy) {
    return { kind: 'awaiting_checker', approvalId: approval.id };
  }
  return { kind: 'ready', approvalId: approval.id };
}

/** The gate as the API's yes/no. Anything but `ready`/`single_signature` refuses with the reason as the error code,
 *  so the console can translate it instead of showing a generic 409. */
export function assertRefundAllowed(gate: RefundGate): void {
  if (gate.kind === 'single_signature' || gate.kind === 'ready') return;
  const codes: Record<string, string> = {
    needs_proposal: 'REFUND_NEEDS_CHECKER',
    awaiting_checker: 'REFUND_AWAITING_CHECKER',
    rejected_by_checker: 'REFUND_REJECTED_BY_CHECKER',
    amount_changed: 'REFUND_AMOUNT_CHANGED',
    already_applied: 'REFUND_ALREADY_APPLIED',
  };
  const msgs: Record<string, string> = {
    needs_proposal: 'This refund needs a second person: propose it, then a different holder of order.refund approves',
    awaiting_checker: 'A refund proposal is waiting for a checker',
    rejected_by_checker: 'The refund proposal was refused by the checker',
    amount_changed: 'The approved amount differs from the amount being refunded — propose the new figure',
    already_applied: 'A refund has already been applied for this case',
  };
  throw new RefundGateError(codes[gate.kind], msgs[gate.kind], { gate: gate.kind });
}

/** The checker may not be the proposer. Enforced here, in the service, AND by 0139's CHECK — three layers because
 *  this is the single rule the whole plane exists for. */
export function assertCheckerDistinct(proposedBy: string, checkerUserId: string): void {
  if (proposedBy === checkerUserId) {
    throw new RefundGateError('REFUND_CHECKER_IS_MAKER', 'The person who proposed a refund cannot approve it', {});
  }
}

export function assertNote(note: string | null | undefined, field: 'proposal' | 'decision'): string {
  const v = (note ?? '').trim();
  if (v.length < MIN_NOTE_CHARS) {
    throw new RefundGateError('REFUND_NOTE_TOO_SHORT', `A ${field} note of at least ${MIN_NOTE_CHARS} characters is required`, { field, min: MIN_NOTE_CHARS });
  }
  return v;
}
