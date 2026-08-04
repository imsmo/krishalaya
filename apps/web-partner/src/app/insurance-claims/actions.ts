'use server';
// apps/web-partner/src/app/insurance-claims/actions.ts · INSURER claim-progression mutations (KV-BL-056, DEV-24) —
// the ONLY place the partner session writes for the claims path. The platform API + its state machine are the
// authority (it rejects illegal transitions and re-enforces `insurance.manage` RBAC); this just builds the exact
// body and maps SdkError -> a localized error token, mirroring loan-queue/actions.ts exactly. `settle` moves funds
// (credits the claimant's wallet), so it carries an Idempotency-Key (Law 3); no mutation auto-retries.
// 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildDecide, buildScheduleSurvey, buildRecordSurvey, InsuranceInputError } from '../../features/insurance/insurance';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof InsuranceInputError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function requestDocumentsAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/request-documents`); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=requestDocuments`);
}

export async function scheduleSurveyAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  let body;
  try { body = buildScheduleSurvey(str(formData, 'surveyorUserId')); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/schedule-survey`, { body }); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=scheduleSurvey`);
}

export async function recordSurveyAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  let body;
  try { body = buildRecordSurvey(str(formData, 'damagePercent'), str(formData, 'notes')); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/record-survey`, { body }); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=recordSurvey`);
}

export async function decideAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  let body;
  try { body = buildDecide(str(formData, 'decision'), str(formData, 'rupees'), str(formData, 'note')); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/decide`, { body }); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=decide`);
}

export async function settleAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/settle`, { idempotencyKey: randomUUID() }); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=settle`);
}

export async function closeAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/insurance-claims');
  try { await partnerClient().request('POST', `insurance/claims/${enc(id)}/close`); }
  catch (e) { redirect(`/insurance-claims/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/insurance-claims/${id}`);
  redirect(`/insurance-claims/${enc(id)}?ok=close`);
}
