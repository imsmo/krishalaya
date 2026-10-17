// apps/web-storefront/src/app/[tenantSlug]/sync/page.tsx · PC-56 STORE-6b · C3 (canon W315, rebuilt; W3151–W3153) — "On this phone" under the
// ORGANISATION's chrome (`/sync` on its own host — brand-theme.ts `hostRewritePath`): THIS organisation's unsent drafts on this phone, never
// another's. The SHARED screen; noindex; no session read; never marked cacheable.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { SyncScreen } from '../../../components/sync/SyncScreen';
import { tenantChrome } from '../../../features/store4a/account';
import { readSyncState } from '../../../features/store6b/paths';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6b.sync.metaTitle'), robots: { index: false, follow: false } };
}

export default function Page({ params, searchParams }: { params: { tenantSlug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  return <SyncScreen chrome={tenantChrome(params.tenantSlug)} state={readSyncState(searchParams ?? {})} renderedAt={new Date().toISOString()} />;
}
