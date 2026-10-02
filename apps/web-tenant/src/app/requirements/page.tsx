// apps/web-tenant/src/app/requirements/page.tsx · PC-56 TENANT-11d — the requirements board moved to its canon slug
// `/marketplace/requirements` (W131). This route redirects (the old `box` query has no meaning on the desk's board).
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default function OldRequirementsPage() { redirect('/marketplace/requirements'); }
