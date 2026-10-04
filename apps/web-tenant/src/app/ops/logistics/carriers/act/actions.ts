'use server';
// apps/web-tenant/src/app/ops/logistics/carriers/act/actions.ts · W2382–W2384 — activate / deactivate a carrier WITH a reason (≥ 10),
// audited with it (PC-56 TENANT-SW-e). The API owns the wall; the console carries the reason and nothing else.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { CARRIERS_HREF, isCarrierAct, isUuid } from '../../../../../features/swe/console';

export async function carrierActAction(formData: FormData): Promise<void> {
  const base = `${CARRIERS_HREF}/act`;
  await requireSession(base);
  const act = String(formData.get('act') ?? ''); const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!isCarrierAct(act) || !isUuid(id)) redirect(CARRIERS_HREF);
  const carry = new URLSearchParams({ act, id, reason });
  try { await tenantClient().carriers.setActive(id, act === 'activate', reason); }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(CARRIERS_HREF);
  carry.set('step', 'success');
  redirect(`${base}?${carry.toString()}`);
}
