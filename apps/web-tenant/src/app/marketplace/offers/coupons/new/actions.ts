'use server';
// apps/web-tenant/src/app/marketplace/offers/coupons/new/actions.ts · W2541 / W2542 · create a coupon — PC-56 TENANT-10b.
// The API re-runs the review inside its transaction (COUPON_REFUSED with every code); the key is the review page's.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { COUPONS_HREF, COUPON_FORM_KEYS, NEW_COUPON_HREF, carried, couponCreateBody, couponEntries, failureCodesFrom } from '../../../../../features/promos/offers';

export async function createCouponAction(formData: FormData): Promise<void> {
  await requireSession(NEW_COUPON_HREF);
  const values = carried(COUPON_FORM_KEYS, (k) => formData.get(k));
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const keep = new URLSearchParams(values);
  let id: string | null = null; let failed: string[] | null = null;
  try { id = (await tenantClient().promotions.createCoupon(couponCreateBody(couponEntries(values)), key)).id; }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${NEW_COUPON_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(COUPONS_HREF);
  redirect(`${NEW_COUPON_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
