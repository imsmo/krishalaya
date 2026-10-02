// apps/web-tenant/src/app/promotions/page.tsx · the old promotions console route — kept, and redirected (PC-56 TENANT-10b).
//
// W129 lives at `/marketplace/offers` (canon slug) and W130 at `/marketplace/offers/coupons`. Every existing link to
// `/promotions` lands here and forwards. `/offers` — LISTING offers, a buyer's bid on a listing — is a different object that
// shares the word (F-20) and is untouched.
import { redirect } from 'next/navigation';
import { OFFERS_HREF } from '../../features/promos/offers';

export const dynamic = 'force-dynamic';

export default function PromotionsLegacyPage() {
  redirect(OFFERS_HREF);
}
