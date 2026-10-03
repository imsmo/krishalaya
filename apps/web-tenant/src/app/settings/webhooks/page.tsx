// apps/web-tenant/src/app/settings/webhooks/page.tsx · the OLD webhooks route → W188 at its canon path (PC-56 TENANT-13a).
// This page used to render `searchParams.secret` as "your signing secret" (F-5): any link carrying `?secret=` was shown as a secret, and
// the real one sat in the URL. It now reads NOTHING from the query string and redirects to /settings/developers/webhooks.
import { redirect } from 'next/navigation';
import { WEBHOOKS_HREF } from '../../../features/webhooks/webhooks';

export const dynamic = 'force-dynamic';

export default function LegacyWebhooksPage() {
  redirect(WEBHOOKS_HREF);
}
