// apps/web-storefront/src/app/(platform)/queued/page.tsx · PC-56 STORE-6a · C3 (canon W314) — "Money never queues", under the PLATFORM chrome.
// The SHARED screen; noindex. (`queued` is a reserved organisation slug since migration 0204.)
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { QueuedActionsScreen } from '../../../components/offline/QueuedActionsScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6.queued.title'), robots: { index: false } };
}

export default function Page() {
  return <QueuedActionsScreen chrome={PLATFORM_CHROME} />;
}
