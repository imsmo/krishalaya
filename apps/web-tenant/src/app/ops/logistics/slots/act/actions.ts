'use server';
// apps/web-tenant/src/app/ops/logistics/slots/act/actions.ts · W2400 / W2401 — withdraw an open slot proposal with a reason (PC-56
// TENANT-SW-e). Only the desk withdraws; the member accepts or declines on their side.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { SLOTS_HREF, isUuid } from '../../../../../features/swe/console';

export async function withdrawProposalAction(formData: FormData): Promise<void> {
  const base = `${SLOTS_HREF}/act`;
  await requireSession(base);
  const id = String(formData.get('id') ?? ''); const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!isUuid(id)) redirect(SLOTS_HREF);
  const carry = new URLSearchParams({ act: 'withdraw', id, reason });
  try { await tenantClient().pickupSlots.withdraw(id, reason, key); }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(SLOTS_HREF);
  carry.set('step', 'success');
  redirect(`${base}?${carry.toString()}`);
}
