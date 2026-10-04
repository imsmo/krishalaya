'use server';
// apps/web-tenant/src/app/ops/labour/wages/act/actions.ts · W2822 / W2823 · request · approve · reject a worker advance — PC-56
// TENANT-SW-b. Re-judged by the API and by the DATABASE (trg_worker_advance_moves: ≤ 50 % of the expected wage; approver ≠
// requester; never the worker; write-off refused). Approving DISBURSES from the booking's escrow (Hold → worker Main, keyed
// `wage-advance:<id>`) — the Idempotency-Key is the confirm page's. Only ids and codes travel in the URLs.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { consentFrom } from '../../../../../features/labour/console';
import { WAGES_ACT_HREF, WAGES_HREF, failureCodes, isAdvAct, isUuid, rupeesToPaise } from '../../../../../features/swb/console';

export async function advanceActAction(formData: FormData): Promise<void> {
  await requireSession(WAGES_ACT_HREF);
  const act = String(formData.get('act') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!isAdvAct(act)) redirect(WAGES_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const c = tenantClient().labour;
  const done = new URLSearchParams({ step: 'success', act });
  let failed: string[] | null = null;
  try {
    if (act === 'request') {
      const assignmentId = String(formData.get('assignmentId') ?? ''); const amountMinor = rupeesToPaise(String(formData.get('amount') ?? ''));
      if (!isUuid(assignmentId) || amountMinor === null) failed = ['VALIDATION_FAILED'];
      else { const r = await c.requestAdvance({ assignmentId, amountMinor, reason }, key); done.set('id', r.id); done.set('amount', r.amountMinor); }
    } else if (!isUuid(id)) failed = ['ADVANCE_NOT_FOUND'];
    else if (act === 'approve') {
      const consent = consentFrom({ consentChannel: String(formData.get('consentChannel') ?? ''), consentMediaId: String(formData.get('consentMediaId') ?? '').trim(), consentNote: String(formData.get('consentNote') ?? '').trim() });
      const r = await c.approveAdvance(id, { reason, ...(consent ? { consent } : {}) }, key); done.set('id', id); done.set('amount', r.amountMinor);
    } else { await c.rejectAdvance(id, reason); done.set('id', id); }
  } catch (e) { failed = e instanceof SdkError ? failureCodes(e.details, e.status === 403 && !e.code ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${WAGES_ACT_HREF}?step=failure&act=${act}${isUuid(id) ? `&id=${id}` : ''}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(WAGES_HREF);
  redirect(`${WAGES_ACT_HREF}?${done.toString()}`);
}
