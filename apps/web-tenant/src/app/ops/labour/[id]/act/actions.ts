'use server';
// apps/web-tenant/src/app/ops/labour/[id]/act/actions.ts · W2655 / W2656 (W2662 / W2663) · assign · confirm roster · start ·
// complete · pay · confirm a day — PC-56 TENANT-11b. Re-judged by the API on the locked row (the confirm step is not an
// authorisation token). The money acts' Idempotency-Key is the confirm page's (a double click escrows / pays once). A funds
// refusal carries the shortfall to the failure screen; nothing else from the act travels in a URL — the success screen reads
// the audit row back.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { LABOUR_HREF, consentFrom, failureCodesFrom, isAct, isUuid, isYmd, jobHref, shortfallFrom } from '../../../../../features/labour/console';

export async function jobActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${LABOUR_HREF}/${encodeURIComponent(id)}/act`;
  await requireSession(base);
  const act = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAct(act)) redirect(LABOUR_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const consent = consentFrom({ consentChannel: String(formData.get('consentChannel') ?? ''), consentMediaId: String(formData.get('consentMediaId') ?? '').trim(), consentNote: String(formData.get('consentNote') ?? '').trim() });
  const assignmentId = String(formData.get('assignmentId') ?? ''); const workDate = String(formData.get('workDate') ?? ''); const workerId = String(formData.get('workerId') ?? '');
  const c = tenantClient().labour;
  let failed: string[] | null = null; let short: string | null = null;
  try {
    if (act === 'confirmRoster') await c.confirmRoster(id, key, { ...(reason ? { reason } : {}), ...(consent ? { consent } : {}) });
    else if (act === 'start') await c.startBooking(id, reason || undefined);
    else if (act === 'complete') await c.completeBooking(id, reason || undefined);
    else if (act === 'pay') await c.payWages(id, key, reason || undefined);
    else if (act === 'assign' && isUuid(workerId)) await c.assignWorker(id, { workerId, ...(consent ? { consent } : {}) }, key);
    else if (act === 'confirmDay' && isUuid(assignmentId) && isYmd(workDate)) await c.confirmAttendance(assignmentId, workDate, key);
    else failed = ['VALIDATION_FAILED'];
  } catch (e) {
    failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown'];
    if (e instanceof SdkError) short = shortfallFrom(e.details);
  }
  const extra = new URLSearchParams({ act, ...(assignmentId && isUuid(assignmentId) ? { assignmentId } : {}), ...(isYmd(workDate) ? { workDate } : {}), ...(isUuid(workerId) ? { workerId } : {}) });
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}${short ? `&short=${short}` : ''}&${extra.toString()}`);
  revalidatePath(LABOUR_HREF); revalidatePath(jobHref(id));
  redirect(`${base}?step=success&${extra.toString()}`);
}
