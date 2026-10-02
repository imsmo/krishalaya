'use server';
// apps/web-tenant/src/app/people/ambassadors/[id]/act/actions.ts · W2486 / W2487 · suspend · reinstate · pay out — PC-56
// TENANT-10a. Re-judged by the API on the locked row. THE KEY IS THE CONFIRM PAGE'S (a double click pays once — and the
// wallet key is derived from the locked earning set besides, F-1). The reason never travels into a success URL (it is on
// the audit row, which the success screen reads back); a payout's success carries the amount the server paid.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { AMBASSADORS_HREF, detailHref, failureCodesFrom, isAmbAct, isUuid } from '../../../../../features/ambassadors/console';

export async function ambassadorActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${detailHref(id)}/act`;
  await requireSession(base);
  const actRaw = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAmbAct(actRaw)) redirect(AMBASSADORS_HREF);
  const act = actRaw as 'suspend' | 'reinstate' | 'payout';
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const a = tenantClient().ambassadors;
  let failed: string[] | null = null; const done = new URLSearchParams({ step: 'success', act });
  try {
    if (act === 'suspend') await a.suspend(id, reason);
    else if (act === 'reinstate') await a.reinstate(id, reason || undefined);
    else { const r = await a.payout(id, reason, key); done.set('paid', r.paidMinor); done.set('count', String(r.earningCount)); }
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(AMBASSADORS_HREF); revalidatePath(detailHref(id));
  redirect(`${base}?${done.toString()}`);
}
