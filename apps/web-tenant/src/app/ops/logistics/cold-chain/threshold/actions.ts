'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/threshold/actions.ts · set a subject's band — the threshold store is the ONLY source
// of a band (append-only: a new row supersedes) · PC-56 TENANT-SW-e. A BMC's band is its cooler's and is refused here by name.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { COLD_HREF, isColdSubjectType, isUuid, thresholdRefusal } from '../../../../../features/swe/console';

export async function setThresholdAction(formData: FormData): Promise<void> {
  const base = `${COLD_HREF}/threshold`;
  await requireSession(base);
  const g = (k: string) => String(formData.get(k) ?? '').trim();
  const subjectType = g('subjectType'); const subjectId = g('subjectId'); const minC = g('minC'); const maxC = g('maxC'); const reason = g('reason').slice(0, 500);
  const carry = new URLSearchParams({ subjectType, subjectId, minC, maxC, reason });
  if (!isColdSubjectType(subjectType) || !isUuid(subjectId) || thresholdRefusal(minC, maxC, reason)) { carry.set('step', 'review'); redirect(`${base}?${carry.toString()}`); }
  let id = '';
  try { id = (await tenantClient().coldChain.setThreshold({ subjectType, subjectId, minC: Number(minC), maxC: Number(maxC), reason }, g('idempotencyKey'))).id; }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(COLD_HREF);
  redirect(`${base}?step=success&thresholdId=${encodeURIComponent(id)}&subjectType=${subjectType}&subjectId=${subjectId}`);
}
