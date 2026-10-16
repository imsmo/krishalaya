// apps/web-storefront/src/app/[tenantSlug]/account/addresses/page.tsx · PC-56 STORE-4a · C1 — Addresses under the organisation's chrome (/<slug>/…). The page is the SHARED screen
// (components/account/AddressesScreen.tsx — one copy for both chromes, founder Q13); this file only names the chrome. PROTECTED + dynamic; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { AddressesScreen } from '../../../../components/account/AddressesScreen';
import { tenantChrome } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4a.addresses.title'), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  return AddressesScreen({ chrome: tenantChrome(params.tenantSlug), searchParams });
}
