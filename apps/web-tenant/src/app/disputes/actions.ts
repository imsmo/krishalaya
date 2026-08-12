'use server';
// apps/web-tenant/src/app/disputes/actions.ts · tenant disputes-moderation mutations (needs dispute.resolve,
// re-checked server-side — this is NOT god-mode: a tenant admin only acts within their own tenant). The only
// place the authed tenantClient() writes for the disputes path:
//   - reviewDisputeAction / escalateDisputeAction: take under review / escalate (transitions).
//   - resolveDisputeAction: resolve with a decision (resolutionType + optional amount, money float-free; refunds
//     move money SERVER-SIDE — the app never does, Law 11).
// The API re-checks the legal transition; an illegal/raced move (409) degrades to a message (Law 12). The SDK's
// dispute methods expose NO Idempotency-Key, so none is passed. 'use server' modules export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildResolve, buildDisputeMessage } from '../../features/disputes/manage';
import { validateReviewResponse } from '../../features/reviews/respond';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/disputes/${encodeURIComponent(id)}?${qs}`); }

async function transition(formData: FormData, kind: 'review' | 'escalate'): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/disputes');
  try {
    if (kind === 'review') await tenantClient().disputes.review(id);
    else await tenantClient().disputes.escalate(id);
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : kind}`);
  }
  revalidatePath(`/disputes/${id}`);
  revalidatePath('/disputes');
  back(id, `ok=${kind}`);
}

export async function reviewDisputeAction(formData: FormData): Promise<void> { return transition(formData, 'review'); }
export async function escalateDisputeAction(formData: FormData): Promise<void> { return transition(formData, 'escalate'); }

// P1-5: the reviewed party (this seller) posts ONE public response to a review about them. The API gates this to
// the review's target (anti-IDOR) and rejects a second response server-side; an illegal/raced move (409) degrades
// to a message (Law 12). Response text is validated client-side (1–4000 chars after trim) before it round-trips.
export async function respondToReviewAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('reviewId') ?? '').trim();
  if (!id) redirect('/disputes?error=review');
  const built = validateReviewResponse(String(formData.get('response') ?? ''));
  if (!built.ok) redirect(`/disputes?error=review_${built.error}`);
  try {
    await tenantClient().reviews.respond(id, built.value);
  } catch (e) {
    redirect(`/disputes?error=${e instanceof SdkError && e.status === 409 ? 'review_illegal' : 'review'}`);
  }
  revalidatePath('/disputes');
  redirect('/disputes?ok=review');
}

export async function resolveDisputeAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/disputes');
  const built = buildResolve({
    resolutionType: String(formData.get('resolutionType') ?? ''),
    amountMajor: String(formData.get('amountMajor') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) back(id, `error=${built.error}`);
  try {
    await tenantClient().disputes.resolve(id, built.value);
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'resolve'}`);
  }
  revalidatePath(`/disputes/${id}`);
  revalidatePath('/disputes');
  back(id, 'ok=resolve');
}

// PC-22: PARTY actions on the dispute thread. The API asserts the caller IS a party (assertParty) — a non-party
// gets 403 which degrades to a message; the UI additionally gates via canRespond (reflect, never grant).
export async function respondDisputeAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/disputes');
  try {
    await tenantClient().disputes.respond(id);
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'respond'}`);
  }
  revalidatePath(`/disputes/${id}`);
  revalidatePath('/disputes');
  back(id, 'ok=respond');
}

export async function postDisputeMessageAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/disputes');
  const built = buildDisputeMessage(String(formData.get('body') ?? ''));
  if (!built.ok) back(id, `error=${built.error}`);
  try {
    await tenantClient().disputes.postMessage(id, built.value);
  } catch (e) {
    back(id, `error=${e instanceof SdkError && (e.status === 403 || e.status === 409) ? 'notparty' : 'message'}`);
  }
  revalidatePath(`/disputes/${id}`);
  back(id, 'ok=message');
}

// ---------------------------------------------------------------------------
// PC-56 TENANT-3b · the refund maker-checker plane (W141's "≥ ₹10,000 needs checker", enforced for the first time)
// ---------------------------------------------------------------------------
// PROPOSING needs dispute.resolve; DECIDING needs order.refund — the permission 0139 seeds, which W142 and W133 both
// named and no file granted. Every refusal is translated BY NAME: a generic error on a refund is the message that
// makes an operator press the button a second time.
const GATE_ERRORS: Record<string, string> = {
  REFUND_NEEDS_CHECKER: 'needsChecker',
  REFUND_AWAITING_CHECKER: 'awaitingChecker',
  REFUND_REJECTED_BY_CHECKER: 'rejectedByChecker',
  REFUND_AMOUNT_CHANGED: 'amountChanged',
  REFUND_ALREADY_APPLIED: 'alreadyApplied',
  REFUND_CHECKER_IS_MAKER: 'checkerIsMaker',
  REFUND_NOTE_TOO_SHORT: 'noteTooShort',
  REFUND_FORBIDDEN: 'refundPerm',
  REFUND_PROPOSAL_DUPLICATE: 'proposalDuplicate',
};
function gateErr(e: unknown, fallback: string): string {
  const code = e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '';
  return GATE_ERRORS[code] ?? (e instanceof SdkError && e.status === 403 ? 'refundPerm' : fallback);
}

export async function proposeRefundAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/disputes');
  const amountMinor = String(formData.get('amountMinor') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  // Checked here as well as server-side, so a 20-character floor is a form message rather than a round trip.
  if (!/^[1-9]\d{0,15}$/.test(amountMinor)) back(id, 'error=amount');
  if (note.length < 20) back(id, 'error=noteTooShort');
  try {
    await tenantClient().refundApprovals.propose({ subjectType: 'dispute', subjectId: id, amountMinor, note });
  } catch (e) { back(id, `error=${gateErr(e, 'propose')}`); }
  revalidatePath(`/disputes/${id}`);
  revalidatePath('/disputes');
  back(id, 'ok=proposed');
}

export async function decideRefundAction(formData: FormData): Promise<void> {
  await requireSession('/disputes');
  const id = String(formData.get('id') ?? '').trim();
  const approvalId = String(formData.get('approvalId') ?? '').trim();
  if (!id || !approvalId) redirect('/disputes');
  const decision = String(formData.get('decision') ?? '');
  if (decision !== 'approved' && decision !== 'rejected') back(id, 'error=decide');
  const note = String(formData.get('note') ?? '').trim();
  // A REFUSAL OWES THE PROPOSER A SENTENCE (0139's CHECK). An approval does not — forcing one produces "ok".
  if (decision === 'rejected' && note.length < 20) back(id, 'error=noteTooShort');
  try {
    await tenantClient().refundApprovals.decide(approvalId, { decision, note: note || undefined });
  } catch (e) { back(id, `error=${gateErr(e, 'decide')}`); }
  revalidatePath(`/disputes/${id}`);
  revalidatePath('/disputes');
  back(id, `ok=${decision}`);
}
