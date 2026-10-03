'use server';
// apps/web-tenant/src/app/ops/logistics/pod/[id]/act/actions.ts · W238 — the POD MUTATE chain's writes (PC-56 TENANT-SW-a): flag, approve,
// propose a reject, confirm a reject (a different person; opens the qty_mismatch dispute). Keyed by the confirm page's idempotency key.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { PodReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { POD_HREF, isPodAct, isUuid } from '../../../../../../features/swa/console';

export async function podActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? ''); const act = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isPodAct(act)) redirect(POD_HREF);
  const base = `${POD_HREF}/${id}/act`;
  await requireSession(base);
  const reason = String(formData.get('reason') ?? '').trim(); const note = String(formData.get('note') ?? '').trim();
  const variance = String(formData.get('varianceMinor') ?? '').trim(); const key = String(formData.get('idempotencyKey') ?? '');
  const carry = new URLSearchParams({ act, ...(reason ? { reason } : {}), ...(note ? { note } : {}), ...(variance ? { varianceMinor: variance } : {}) });
  let after: PodReview | null = null;
  try {
    const s = tenantClient().shipments;
    if (act === 'flag') after = await s.podFlag(id, { reason: reason as NonNullable<PodReview['flagReason']>, ...(note ? { note } : {}), ...(variance ? { varianceMinor: variance } : {}) }, key);
    else if (act === 'approve') after = await s.podApprove(id, note || undefined, key);
    else if (act === 'reject') after = await s.podProposeReject(id, note, key);
    else after = await s.podConfirmReject(id, key);
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(POD_HREF);
  const done = new URLSearchParams({ act, step: 'success', ...(after?.disputeId ? { disputeId: after.disputeId } : {}) });
  redirect(`${base}?${done.toString()}`);
}
