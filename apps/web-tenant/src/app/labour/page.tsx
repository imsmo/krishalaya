// apps/web-tenant/src/app/labour/page.tsx · PC-56 TENANT-11b · the old labour console moved to the canon slug `/ops/labour`
// (W163). This route redirects; the old `?booking=<id>` detail lands on the job's own page (W164).
import { redirect } from 'next/navigation';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default function LabourRedirect({ searchParams }: { searchParams: { booking?: string } }) {
  const id = typeof searchParams.booking === 'string' && UUID.test(searchParams.booking) ? searchParams.booking : null;
  redirect(id ? `/ops/labour/${encodeURIComponent(id)}` : '/ops/labour');
}
