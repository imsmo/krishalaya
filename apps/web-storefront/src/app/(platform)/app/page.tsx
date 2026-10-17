// apps/web-storefront/src/app/(platform)/app/page.tsx · PC-56 STORE-6a · C3 (canon W319) — the PLATFORM store's app & install page: it installs as
// the platform store (its name from packages/tokens). The SHARED screen; noindex. (`app` is a reserved organisation slug since migration 0204.)
// PC-56 STORE-6b · D3: the invitation is OFF on the platform host (the tenant-scoped switch reads absent there — named); `?install=` is printed.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { InstallScreen } from '../../../components/offline/InstallScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';
import { PLATFORM_BRAND } from '../../../features/branding/brand-theme';
import { readInstallState } from '../../../features/store6b/install';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store6.install.metaTitle'), robots: { index: false } };
}

export default function Page(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <InstallScreen chrome={PLATFORM_CHROME} name={PLATFORM_BRAND.platformStoreName} offlineReads={null} inviteOn={false} installState={readInstallState(props?.searchParams?.install)} />;
}
