'use server';
// apps/web-tenant/src/app/promotions/actions.ts · the old inline promotion / coupon forms' actions — kept, redirected
// (PC-56 TENANT-10b).
//
// The `/promotions` page now forwards to W129 (`/marketplace/offers`). These three actions wrote directly from an inline
// form with no review, no reason and — against the real API — no Idempotency-Key, so every one of them 400'd (F-7). A form
// still posting to them (an old tab) is sent to the chain that now does the act properly, carrying nothing it typed: the
// chain's review is where a promotion's budget, rules and window are checked before anything is written.
import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { NEW_COUPON_HREF, NEW_PROMOTION_HREF, OFFERS_HREF } from '../../features/promos/offers';

export async function createPromotionAction(_formData: FormData): Promise<void> {
  await requireSession(OFFERS_HREF);
  redirect(`${NEW_PROMOTION_HREF}?step=edit`);
}

export async function setPromotionActiveAction(_formData: FormData): Promise<void> {
  await requireSession(OFFERS_HREF);
  redirect(OFFERS_HREF);
}

export async function createCouponAction(_formData: FormData): Promise<void> {
  await requireSession(OFFERS_HREF);
  redirect(`${NEW_COUPON_HREF}?step=edit`);
}
