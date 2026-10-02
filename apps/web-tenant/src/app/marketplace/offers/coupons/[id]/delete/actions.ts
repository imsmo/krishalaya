'use server';
// apps/web-tenant/src/app/marketplace/offers/coupons/[id]/delete/actions.ts · W2544 / W2545 · delete a coupon — PC-56
// TENANT-10b. Reason required (the API refuses without one); a 404 means nothing was deleted and no audit row was written.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { COUPONS_HREF, failureCodesFrom, isUuid } from '../../../../../../features/promos/offers';

export async function deleteCouponAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${COUPONS_HREF}/${encodeURIComponent(id)}/delete`;
  await requireSession(base);
  if (!isUuid(id)) redirect(COUPONS_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  let failed: string[] | null = null;
  try { await tenantClient().promotions.deleteCoupon(id, reason); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(COUPONS_HREF);
  redirect(`${base}?step=success`);
}
