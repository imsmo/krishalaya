// apps/web-storefront/src/app/[tenantSlug]/app/page.tsx · PC-56 STORE-6a · C3 (canon W319) — the ORGANISATION's app & install page (`/app` on its
// own host): it installs as THIS organisation. The organisation's name from the PUBLIC brand read; its `storefront_offline_reads` from the
// PUBLIC flags read (unreadable → OFF). The SHARED screen; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadTenantShell } from '../../../lib/storefront-data';
import { InstallScreen } from '../../../components/offline/InstallScreen';
import { tenantChrome } from '../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6.install.metaTitle'), robots: { index: false } };
}

export default async function Page({ params }: { params: { tenantSlug: string } }) {
  const shell = await loadTenantShell(params.tenantSlug);
  const name = shell.kind === 'ok' ? (shell.branding?.brand?.displayName || shell.branding?.displayName || shell.tenant.displayName) : params.tenantSlug;
  let reads = false;
  try { reads = (await publicClient(params.tenantSlug).storefront.flags()).storefront_offline_reads === true; } catch { reads = false; }
  return <InstallScreen chrome={tenantChrome(params.tenantSlug)} name={name} offlineReads={reads} />;
}
