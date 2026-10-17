// apps/web-storefront/src/app/[tenantSlug]/offline/page.tsx · PC-56 STORE-6a · C3 (canon W313, founder D6) — THE ORGANISATION's offline page:
// the rules and, on its own host (`/offline` is rewritten here), the worker's fallback. Rendered inside the organisation's layout in its
// SESSION-FREE shell chrome (the middleware's `x-kv-shell: offline`): the organisation named from the PUBLIC brand read, its
// `storefront_offline_reads` from the PUBLIC flags read (an unreadable answer reads OFF) — no session read, so the copy the worker keeps is the
// same for every person on the phone. noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadTenantShell } from '../../../lib/storefront-data';
import { OfflineScreen } from '../../../components/offline/OfflineScreen';
import { tenantChrome } from '../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offline.title'), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const shell = await loadTenantShell(params.tenantSlug);
  const name = shell.kind === 'ok' ? (shell.branding?.brand?.displayName || shell.branding?.displayName || shell.tenant.displayName) : params.tenantSlug;
  let reads = false;
  try { reads = (await publicClient(params.tenantSlug).storefront.flags()).storefront_offline_reads === true; } catch { reads = false; }
  return <OfflineScreen chrome={tenantChrome(params.tenantSlug)} orgName={name} offlineReads={reads} searchParams={searchParams} />;
}
