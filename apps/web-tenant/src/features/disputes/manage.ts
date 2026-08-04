// apps/web-tenant/src/features/disputes/manage.ts · PURE helpers for the tenant disputes-moderation pages. They
// mirror the API's dispute state machine (disputes/domain/dispute.state.ts) so the console only offers legal
// moderation actions (review/escalate/resolve) — the API re-checks dispute.resolve + tenant scope + the
// transition on every call (we reflect, never grant). buildResolve assembles the resolve payload (money float-
// free, Law 2). No framework, no I/O → unit-tested.
import { parseMajorToMinor } from '../listings/form';

export const DISPUTE_STATUSES = ['open', 'seller_responded', 'under_review', 'escalated', 'resolved', 'rejected', 'withdrawn'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = Object.freeze({
  open: ['seller_responded', 'under_review', 'escalated', 'resolved', 'rejected', 'withdrawn'],
  seller_responded: ['under_review', 'escalated', 'resolved', 'rejected', 'withdrawn'],
  under_review: ['escalated', 'resolved', 'rejected'],
  escalated: ['under_review', 'resolved', 'rejected'],
  resolved: [],
  rejected: [],
  withdrawn: [],
});
function canTransition(from: string, to: DisputeStatus): boolean {
  return (TRANSITIONS[from as DisputeStatus] ?? []).includes(to);
}

export function canReview(status: string | undefined | null): boolean { return canTransition(status ?? '', 'under_review'); }
export function canEscalate(status: string | undefined | null): boolean { return canTransition(status ?? '', 'escalated'); }
export function canResolve(status: string | undefined | null): boolean { return canTransition(status ?? '', 'resolved'); }

/** PC-22: the RESPONDENT's respond action is legal only from 'open' (mirrors dispute.state sellerRespond) and
 *  only for the against-party — the caller's id must match dispute.againstUser (the API re-asserts the party). */
export function canRespond(status: string | undefined | null, againstUser: string | null | undefined, meId: string | null | undefined): boolean {
  return canTransition(status ?? '', 'seller_responded') && !!meId && !!againstUser && meId === againstUser;
}

/** Derive a thread author's role for display (this contract carries ids, not names — PII-minimal by design). */
export function messageAuthorRole(authorUserId: string, dispute: { raisedBy: string; againstUser: string | null }): 'complainant' | 'respondent' | 'moderator' {
  if (authorUserId === dispute.raisedBy) return 'complainant';
  if (dispute.againstUser && authorUserId === dispute.againstUser) return 'respondent';
  return 'moderator';
}

/** Validate one thread message (server re-validates ≤4000). */
export function buildDisputeMessage(raw: string): { ok: true; value: string } | { ok: false; error: 'message' } {
  const body = raw.trim();
  if (!body || body.length > 4000) return { ok: false, error: 'message' };
  return { ok: true, value: body };
}

export const RESOLUTION_TYPES = ['refund_full', 'refund_partial', 'replacement', 'rejected'] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export type ResolveResult =
  | { ok: true; value: { resolutionType: ResolutionType; resolutionAmountMinor?: string; note?: string } }
  | { ok: false; error: 'type' | 'amount' };

/** Validate + assemble a resolve payload. A partial refund REQUIRES a positive amount; other types may carry an
 *  optional amount (the server is authoritative for full-refund figures). Money parsed float-free. */
export function buildResolve(raw: { resolutionType?: string; amountMajor?: string; note?: string }): ResolveResult {
  const resolutionType = (RESOLUTION_TYPES as readonly string[]).includes(raw.resolutionType ?? '')
    ? (raw.resolutionType as ResolutionType) : null;
  if (!resolutionType) return { ok: false, error: 'type' };

  const note = (raw.note ?? '').trim() || undefined;
  const amountRaw = (raw.amountMajor ?? '').trim();

  if (resolutionType === 'refund_partial') {
    const m = parseMajorToMinor(amountRaw);
    if (m === undefined || m === '0') return { ok: false, error: 'amount' };
    return { ok: true, value: { resolutionType, resolutionAmountMinor: m, note } };
  }
  if (amountRaw) {
    const m = parseMajorToMinor(amountRaw);
    if (m === undefined) return { ok: false, error: 'amount' };
    return { ok: true, value: { resolutionType, resolutionAmountMinor: m, note } };
  }
  return { ok: true, value: { resolutionType, note } };
}
