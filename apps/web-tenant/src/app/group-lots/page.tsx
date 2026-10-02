// apps/web-tenant/src/app/group-lots/page.tsx · PC-56 TENANT-11c · the old group-lot console moved to the canon slug
// `/marketplace/group-lots` (W135). This route redirects; the old `?lot=<id>` detail lands on the lot's own page (W136).
import { redirect } from 'next/navigation';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default function GroupLotsRedirect({ searchParams }: { searchParams: { lot?: string } }) {
  const id = typeof searchParams.lot === 'string' && UUID.test(searchParams.lot) ? searchParams.lot : null;
  redirect(id ? `/marketplace/group-lots/${encodeURIComponent(id)}` : '/marketplace/group-lots');
}
