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
import { buildResolve } from '../../features/disputes/manage';
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
