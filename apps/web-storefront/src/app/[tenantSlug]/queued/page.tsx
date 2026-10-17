// apps/web-storefront/src/app/[tenantSlug]/queued/page.tsx · PC-56 STORE-6a · C3 (canon W314) — "Money never queues", under the ORGANISATION's
// chrome (`/queued` on its own host). The SHARED screen; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { QueuedActionsScreen } from '../../../components/offline/QueuedActionsScreen';
import { tenantChrome } from '../../../features/store4a/account';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6.queued.title'), robots: { index: false } };
}

export default function Page({ params }: { params: { tenantSlug: string } }) {
  return <QueuedActionsScreen chrome={tenantChrome(params.tenantSlug)} />;
}
