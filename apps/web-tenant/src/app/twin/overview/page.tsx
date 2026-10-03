// apps/web-tenant/src/app/twin/overview/page.tsx · the canon's route comment for W420 (`twin/overview`) — the area lives at /twin.
import { redirect } from 'next/navigation';
import { TWIN_HREF } from '../../../features/twin/twin';

export default function TwinOverviewSlug() { redirect(TWIN_HREF); }
