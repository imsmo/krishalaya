'use server';
// apps/web-partner/src/app/lender/queue/actions.ts · PC-56 PARTNER-4a (carried from PARTNER-0 · founder D3, moved to the canon's address) —
// the lender's decisions over the PARTNER decision routes (`/v1/partner/applications/:id/{review,approve,reject}`). The API is the authority:
// it reads the application through the consent-gated axis (404 when not admitted), decides inside the APPLICATION's tenant with the state
// machine's rules (the cooling-off window, approved ≤ requested), checks the person's role (a maker reviews; a checker approves / rejects) and
// records the partner person as the actor. Every decision carries the Idempotency-Key the page MINTED AT RENDER (a hidden field: a double
// submit replays one key, never two). There is NO disburse action and there never will be: disbursal moves the cooperative's own wallet money
// and is its act — the API refuses a partner's attempt by name (`PARTNER_CANNOT_DISBURSE`). Money: whole rupees → paise via BigInt (Law 2).
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildApprove, buildReject, LendingError } from '../../../features/lending/application';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.code === 'PARTNER_PERMISSION_MISSING') return 'permission';
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof LendingError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const keyOf = (fd: FormData) => str(fd, 'idempotencyKey').trim();

export async function reviewAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim(); const key = keyOf(formData);
  if (!id || !key) redirect('/lender/queue');
  try { await partnerClient().partner.decide.review(id, key); }
  catch (e) { redirect(`/lender/queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/lender/queue/${id}`);
  redirect(`/lender/queue/${enc(id)}?ok=review`);
}

export async function approveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim(); const key = keyOf(formData);
  if (!id || !key) redirect('/lender/queue');
  let body;
  try { body = buildApprove(str(formData, 'rupees'), str(formData, 'coolingOffHours')); }
  catch (e) { redirect(`/lender/queue/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().partner.decide.approve(id, body, key); }
  catch (e) { redirect(`/lender/queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/lender/queue/${id}`);
  redirect(`/lender/queue/${enc(id)}?ok=approve`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim(); const key = keyOf(formData);
  if (!id || !key) redirect('/lender/queue');
  let body;
  try { body = buildReject(str(formData, 'note')); }
  catch (e) { redirect(`/lender/queue/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().partner.decide.reject(id, body, key); }
  catch (e) { redirect(`/lender/queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/lender/queue/${id}`);
  redirect(`/lender/queue/${enc(id)}?ok=reject`);
}
