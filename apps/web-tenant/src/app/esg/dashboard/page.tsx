// apps/web-tenant/src/app/esg/dashboard/page.tsx · the canon's slug for W423 (`esg/dashboard`) — the area lives at /esg.
import { redirect } from 'next/navigation';
import { ESG_HREF } from '../../../features/esg/esg';

export default function EsgDashboardSlug() { redirect(ESG_HREF); }
