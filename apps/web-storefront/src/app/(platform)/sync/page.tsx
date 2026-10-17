// apps/web-storefront/src/app/(platform)/sync/page.tsx · PC-56 STORE-6b · C3 (canon W315, rebuilt; W3151–W3153) — "On this phone" under the PLATFORM
// chrome: the unsent drafts THIS phone keeps for every store on this host (path stores). The SHARED screen; noindex; no session read (the list
// is the phone's, read by the page itself). `sync` is a reserved organisation slug since migration 0204 (0204:150).
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { SyncScreen } from '../../../components/sync/SyncScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';
import { readSyncState } from '../../../features/store6b/paths';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6b.sync.metaTitle'), robots: { index: false, follow: false } };
}

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SyncScreen chrome={PLATFORM_CHROME} state={readSyncState(searchParams ?? {})} renderedAt={new Date().toISOString()} />;
}
