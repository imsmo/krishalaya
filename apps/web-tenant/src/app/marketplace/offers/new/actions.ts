'use server';
// apps/web-tenant/src/app/marketplace/offers/new/actions.ts · W2722 / W2723 · create a promotion — PC-56 TENANT-10b.
// The API re-runs the review's rules inside its own transaction; a refusal comes back as PROMOTION_REFUSED with every code.
// THE KEY IS THE REVIEW PAGE'S (a double submit writes one promotion). The values ride back to the failure page so its
// retry is a review of what was typed. The success page links to the audit entry the act wrote.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { NEW_PROMOTION_HREF, OFFERS_HREF, PROMO_FORM_KEYS, carried, failureCodesFrom, promotionCreateBody, promotionEntries } from '../../../../features/promos/offers';

export async function createPromotionAction(formData: FormData): Promise<void> {
  await requireSession(NEW_PROMOTION_HREF);
  const values = carried(PROMO_FORM_KEYS, (k) => formData.get(k));
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const keep = new URLSearchParams(values);
  let id: string | null = null; let failed: string[] | null = null;
  try {
    id = (await tenantClient().promotions.create(promotionCreateBody(promotionEntries(values)), key)).id;
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${NEW_PROMOTION_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(OFFERS_HREF);
  redirect(`${NEW_PROMOTION_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
