'use server';
// apps/web-tenant/src/app/promotions/actions.ts · promotions/coupons mutations (PC-28b). Server-gated by
// promotion.manage; discounts APPLY server-side at checkout — these actions only define them.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildPromotion, buildCoupon } from '../../features/promos/form';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/promotions?${qs}`); }

export async function createPromotionAction(formData: FormData): Promise<void> {
  await requireSession('/promotions');
  const built = buildPromotion({
    promoType: String(formData.get('promoType') ?? ''),
    name: String(formData.get('name') ?? ''),
    discountType: String(formData.get('discountType') ?? ''),
    percentOff: String(formData.get('percentOff') ?? ''),
    amountMajor: String(formData.get('amountMajor') ?? ''),
    minOrderMajor: String(formData.get('minOrderMajor') ?? ''),
    startsLocal: String(formData.get('startsAt') ?? ''),
    endsLocal: String(formData.get('endsAt') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await tenantClient().promotions.create(built.value); }
  catch { back('error=create'); }
  revalidatePath('/promotions');
  back('ok=promo');
}

export async function setPromotionActiveAction(formData: FormData): Promise<void> {
  await requireSession('/promotions');
  const id = String(formData.get('id') ?? '').trim();
  const active = String(formData.get('active') ?? '') === '1';
  if (!id) back('error=create');
  try { await tenantClient().promotions.setActive(id, active); }
  catch { back('error=create'); }
  revalidatePath('/promotions');
  back(active ? 'ok=activated' : 'ok=deactivated');
}

export async function createCouponAction(formData: FormData): Promise<void> {
  await requireSession('/promotions');
  const built = buildCoupon({
    promotionId: String(formData.get('promotionId') ?? ''),
    code: String(formData.get('code') ?? ''),
    maxUses: String(formData.get('maxUses') ?? ''),
    perUserLimit: String(formData.get('perUserLimit') ?? ''),
  });
  if (!built.ok) back(`error=cp_${built.error}`);
  try { await tenantClient().promotions.createCoupon(built.value); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'cp_dup' : 'cp_create'}`); }
  revalidatePath('/promotions');
  back('ok=coupon');
}
