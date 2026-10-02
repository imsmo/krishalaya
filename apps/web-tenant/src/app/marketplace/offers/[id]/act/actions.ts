'use server';
// apps/web-tenant/src/app/marketplace/offers/[id]/act/actions.ts · W2725 / W2726 · pause · resume — PC-56 TENANT-10b.
// Re-judged by the API on the locked row (the confirm step is not an authorisation token). The reason never travels into a
// success URL — it is on the audit row, which the success screen reads back.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { OFFERS_HREF, failureCodesFrom, isPromoAct, isUuid } from '../../../../../features/promos/offers';

export async function promotionActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${OFFERS_HREF}/${encodeURIComponent(id)}/act`;
  await requireSession(base);
  const actRaw = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isPromoAct(actRaw)) redirect(OFFERS_HREF);
  const act = actRaw as 'pause' | 'resume';
  const reason = String(formData.get('reason') ?? '').trim();
  let failed: string[] | null = null;
  try { await tenantClient().promotions.setActive(id, act === 'resume', reason); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(OFFERS_HREF);
  redirect(`${base}?step=success&act=${act}`);
}
