// apps/web-storefront/src/app/(platform)/account/addresses/[id]/edit/page.tsx · PC-56 STORE-4a · C1 — "Edit" an address (canon W3034–W3037) under the platform chrome.
// The page is the SHARED screen (components/account/AddressFormScreen.tsx — one copy for both chromes); a malformed id is "not found".
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslator } from '../../../../../../lib/i18n';
import { AddressFormScreen } from '../../../../../../components/account/AddressFormScreen';
import { PLATFORM_CHROME } from '../../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4a.form.editTitle'), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  if (!UUID.test(params.id)) notFound();
  return AddressFormScreen({ chrome: PLATFORM_CHROME, id: params.id, searchParams });
}
