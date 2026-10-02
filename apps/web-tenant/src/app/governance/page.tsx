// apps/web-tenant/src/app/governance/page.tsx · the governance area's front door → W198 (PC-56 TENANT-9b).
//
// This page used to be the resolutions screen itself — with a create form that minted its Idempotency-Key per submit and
// carried no formula, and open / close buttons that posted a status change with no confirm, no reason and no audit row.
// Those are gone: there is ONE write path, through the form chain (`/governance/resolutions/new`) and the mutate chain
// (`/governance/resolutions/[id]/act`). The sidebar's link and every old bookmark land on W198.
import { redirect } from 'next/navigation';
import { RESOLUTIONS_HREF } from '../../features/governance/resolutions';

export const dynamic = 'force-dynamic';

export default function GovernancePage(): never {
  redirect(RESOLUTIONS_HREF);
}
