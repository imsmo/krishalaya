// apps/web-tenant/src/app/insights/page.tsx · PC-56 TENANT-SW-f — /insights opens on the first canon screen, Mandi Pulse (W193).
import { redirect } from 'next/navigation';
import { MANDI_HREF } from '../../features/swf/console';

export default function InsightsIndex(): never { redirect(MANDI_HREF); }
