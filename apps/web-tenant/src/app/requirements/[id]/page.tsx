// apps/web-tenant/src/app/requirements/[id]/page.tsx · PC-56 TENANT-11d — a requirement's detail moved to its canon slug
// `/marketplace/requirements/[id]` (W132). This route redirects.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default async function OldRequirementDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/marketplace/requirements/${encodeURIComponent(params.id)}`);
}
