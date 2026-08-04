'use server';
// apps/web-partner/src/app/loan-queue/actions.ts · lender decision mutations — the ONLY place the partner session
// writes for the loan path. The platform API + its state machine are the authority (it rejects illegal
// transitions and re-enforces partner RBAC + RLS); this just builds the exact body and maps SdkError → a localized
// error token. Money is bigint minor units: the approved amount is whole rupees → paise via BigInt (Law 2, no
// float). Disburse moves funds, so it carries an Idempotency-Key (Law 3); no mutation auto-retries.
// 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildApprove, buildReject, LendingError } from '../../features/lending/application';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof LendingError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function reviewAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/loan-queue');
  try { await partnerClient().request('POST', `fintech/loan-applications/${enc(id)}/review`); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/loan-queue/${id}`);
  redirect(`/loan-queue/${enc(id)}?ok=review`);
}

export async function approveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/loan-queue');
  let body;
  try { body = buildApprove(str(formData, 'rupees'), str(formData, 'coolingOffHours')); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `fintech/loan-applications/${enc(id)}/approve`, { body, idempotencyKey: randomUUID() }); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/loan-queue/${id}`);
  redirect(`/loan-queue/${enc(id)}?ok=approve`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/loan-queue');
  let body;
  try { body = buildReject(str(formData, 'note')); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `fintech/loan-applications/${enc(id)}/reject`, { body }); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/loan-queue/${id}`);
  redirect(`/loan-queue/${enc(id)}?ok=reject`);
}

export async function disburseAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/loan-queue');
  try { await partnerClient().request('POST', `fintech/loan-applications/${enc(id)}/disburse`, { idempotencyKey: randomUUID() }); }
  catch (e) { redirect(`/loan-queue/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/loan-queue/${id}`);
  redirect(`/loan-queue/${enc(id)}?ok=disburse`);
}
