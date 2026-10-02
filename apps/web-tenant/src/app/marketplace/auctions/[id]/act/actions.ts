'use server';
// apps/web-tenant/src/app/marketplace/auctions/[id]/act/actions.ts · W2346 / W2347 (W2353 / W2354) · approve · cancel · pause ·
// resume — PC-56 TENANT-11a. Re-judged by the API on the locked row (the confirm step is not an authorisation token). The
// approve's Idempotency-Key is the confirm page's (a double click creates one order). The reason never travels into a success
// URL — it is on the audit row, which the success screen reads back.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { AUCTIONS_HREF, consentFrom, failureCodesFrom, isAct, isUuid, liveHref, settleHref } from '../../../../../features/auctions/console';

export async function auctionActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(id)}/act`;
  await requireSession(base);
  const actRaw = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAct(actRaw)) redirect(AUCTIONS_HREF);
  const act = actRaw as 'approve' | 'cancel' | 'pause' | 'resume';
  const reason = String(formData.get('reason') ?? '').trim();
  const consent = consentFrom({ consentChannel: String(formData.get('consentChannel') ?? ''), consentMediaId: String(formData.get('consentMediaId') ?? '').trim(), consentNote: String(formData.get('consentNote') ?? '').trim() });
  const c = tenantClient().auctions;
  let failed: string[] | null = null;
  try {
    if (act === 'approve') await c.approve(id, String(formData.get('idempotencyKey') ?? '').trim() || randomUUID(), consent ?? undefined);
    else if (act === 'cancel') await c.cancel(id, reason);
    else if (act === 'pause') await c.pauseEntry(id, reason);
    else await c.resumeEntry(id, reason);
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(AUCTIONS_HREF); revalidatePath(liveHref(id)); revalidatePath(settleHref(id));
  redirect(`${base}?step=success&act=${act}`);
}
