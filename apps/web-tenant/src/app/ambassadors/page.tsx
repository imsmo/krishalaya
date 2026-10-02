// apps/web-tenant/src/app/ambassadors/page.tsx · the old ambassadors console route — kept, and redirected (PC-56 TENANT-10a).
//
// W159 lives at `/people/ambassadors` (canon slug); the sidebar keeps its `/ambassadors` entry and every existing link
// lands here, so this route forwards — and a link to an ambassador's detail (`?ambassador=<id>`) forwards to that
// ambassador's own page rather than to the list.
import { redirect } from 'next/navigation';
import { AMBASSADORS_HREF, detailHref, isUuid } from '../../features/ambassadors/console';

export const dynamic = 'force-dynamic';

export default function AmbassadorsLegacyPage({ searchParams }: { searchParams: { ambassador?: string } }) {
  if (isUuid(searchParams.ambassador)) redirect(detailHref(searchParams.ambassador));
  redirect(AMBASSADORS_HREF);
}
