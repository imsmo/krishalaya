// apps/web-storefront/src/app/(platform)/account/delete/page.tsx · PC-56 STORE-4a · C1 — Delete under the platform chrome. The page is the SHARED screen
// (components/account/DeleteScreen.tsx — one copy for both chromes, founder Q13); this file only names the chrome. PROTECTED + dynamic; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { DeleteScreen } from '../../../../components/account/DeleteScreen';
import { PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4a.delete.title'), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  return DeleteScreen({ chrome: PLATFORM_CHROME, searchParams });
}
