'use server';
// apps/web-gov/src/app/verification/actions.ts · GW-4 KYC review write (PC-55 B1).
// The API's permission (identity.approve) and its state machine are authoritative — this action only refuses the
// things it can refuse HONESTLY and locally (a rejection with no reason, a verify with no evidence) so an officer
// gets an instant, explainable "no" instead of a round trip. Everything else is the server's verdict:
//   403 → 'forbidden' (the access grant does not include KYC review)
//   409 → 'illegal'   (the case moved under us — someone else decided it first)
// A rejection ALWAYS carries a reason: a person must be able to learn why they were refused.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { govClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildKycDecision } from '../../features/verification/review';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/verification/${encodeURIComponent(id)}?${qs}`); }

export async function decideKycAction(formData: FormData): Promise<void> {
  await requireSession('/verification');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/verification');
  const client = govClient();

  // Re-read the case server-side: the gate must be evaluated against the CURRENT truth, never against whatever the
  // submitted form believed. (A stale tab must not be able to verify a case whose evidence was since removed.)
  let facts: { status?: string | null; mediaId?: string | null };
  try {
    const c = await client.kyc.reviewCase(id);
    facts = { status: c.status, mediaId: c.mediaId };
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 403 ? 'forbidden' : 'action'}`);
  }

  const built = buildKycDecision(
    { decision: String(formData.get('decision') ?? ''), reason: String(formData.get('reason') ?? '') },
    facts,
  );
  if (!built.ok) back(id, `error=${built.error}`);

  try { await client.kyc.review(id, built.value); }
  catch (e) {
    const status = e instanceof SdkError ? e.status : 0;
    back(id, `error=${status === 403 ? 'forbidden' : status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/verification/${id}`); revalidatePath('/verification');
  back(id, `ok=${built.value.decision}`);
}
