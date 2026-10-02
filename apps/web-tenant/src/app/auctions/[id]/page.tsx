// apps/web-tenant/src/app/auctions/[id]/page.tsx · the old auction detail route — kept, and redirected (PC-56 TENANT-11a).
// An auction is now read on the live monitor (W138) — which links to its settlement (W139) once it has ended.
import { redirect } from 'next/navigation';
import { AUCTIONS_HREF, isUuid, liveHref } from '../../../features/auctions/console';

export const dynamic = 'force-dynamic';

export default function AuctionDetailLegacyPage({ params }: { params: { id: string } }) {
  redirect(isUuid(params.id) ? liveHref(params.id) : AUCTIONS_HREF);
}
