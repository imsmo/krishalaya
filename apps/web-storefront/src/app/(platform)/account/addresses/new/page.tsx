// apps/web-storefront/src/app/(platform)/account/addresses/new/page.tsx · PC-56 STORE-4a · C1 — "+ Add address" (canon W3034–W3037) under the platform chrome.
// The page is the SHARED screen (components/account/AddressFormScreen.tsx — one copy for both chromes); this file only names the chrome.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../../lib/i18n';
import { AddressFormScreen } from '../../../../../components/account/AddressFormScreen';
import { PLATFORM_CHROME } from '../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4a.form.addTitle'), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  return AddressFormScreen({ chrome: PLATFORM_CHROME, id: null, searchParams });
}
