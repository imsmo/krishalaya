// apps/web-tenant/src/app/auctions/page.tsx · the old auctions console route — kept, and redirected (PC-56 TENANT-11a).
//
// W137 lives at `/marketplace/auctions` (canon slug), with W138 at `/marketplace/auctions/[id]/live` and W139 at
// `/marketplace/auctions/[id]/settle`. Every existing link to `/auctions` lands here and forwards. The old page's create
// form posted lot prices without a quantity and listed other sellers' listings it could never auction; its approve/cancel
// buttons called acts with no Idempotency-Key and no reason — those call shapes no longer exist, and its actions file went
// with them (one path, not two).
import { redirect } from 'next/navigation';
import { AUCTIONS_HREF } from '../../features/auctions/console';

export const dynamic = 'force-dynamic';

export default function AuctionsLegacyPage() {
  redirect(AUCTIONS_HREF);
}
