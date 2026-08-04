'use server';
// apps/web-tenant/src/app/requirements/actions.ts · requirements-board mutations (PC-28c). Post + quote are
// Idempotency-Keyed (Law 3); requirement.post / requirement.quote are the authoritative server gates; close is
// owner-or-moderator (server-asserted). 409 → illegal/duplicate messages (Law 12).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildRequirement, buildQuote } from '../../features/requirements/form';
import { SdkError } from '@krishalaya/sdk-js';

export async function postRequirementAction(formData: FormData): Promise<void> {
  await requireSession('/requirements');
  const built = buildRequirement({
    title: String(formData.get('title') ?? ''),
    quantity: String(formData.get('quantity') ?? ''),
    unitCode: String(formData.get('unitCode') ?? ''),
    budgetMinMajor: String(formData.get('budgetMin') ?? ''),
    budgetMaxMajor: String(formData.get('budgetMax') ?? ''),
    needBy: String(formData.get('needBy') ?? ''),
    pincode: String(formData.get('pincode') ?? ''),
    isUrgent: formData.get('isUrgent') === '1',
  });
  if (!built.ok) redirect(`/requirements?box=mine&error=${built.error}`);
  let id = '';
  try { id = (await tenantClient().requirements.create(built.value, randomUUID())).id; }
  catch { redirect('/requirements?box=mine&error=post'); }
  revalidatePath('/requirements');
  redirect(`/requirements/${encodeURIComponent(id)}?ok=posted`);
}

export async function closeRequirementAction(formData: FormData): Promise<void> {
  await requireSession('/requirements');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/requirements');
  try { await tenantClient().requirements.close(id); }
  catch (e) { redirect(`/requirements/${encodeURIComponent(id)}?error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'close'}`); }
  revalidatePath(`/requirements/${id}`); revalidatePath('/requirements');
  redirect(`/requirements/${encodeURIComponent(id)}?ok=closed`);
}

export async function quoteRequirementAction(formData: FormData): Promise<void> {
  await requireSession('/requirements');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/requirements');
  const built = buildQuote({
    priceMajor: String(formData.get('priceMajor') ?? ''),
    quantity: String(formData.get('quantity') ?? ''),
    message: String(formData.get('message') ?? ''),
  });
  if (!built.ok) redirect(`/requirements/${encodeURIComponent(id)}?error=q_${built.error}`);
  try { await tenantClient().requirements.quote(id, built.value, randomUUID()); }
  catch (e) { redirect(`/requirements/${encodeURIComponent(id)}?error=${e instanceof SdkError && e.status === 409 ? 'q_dup' : 'quote'}`); }
  revalidatePath(`/requirements/${id}`);
  redirect(`/requirements/${encodeURIComponent(id)}?ok=quoted`);
}
