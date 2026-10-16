// apps/web-storefront/src/app/(platform)/account/preferences/page.tsx · PC-56 STORE-4c · C1 — Preferences (canon W302) under the platform chrome.
// The page is the SHARED screen (components/account/PreferencesScreen.tsx — one copy for both chromes, founder Q13); this file only names the
// chrome. PROTECTED + dynamic; noindex. The old /notifications/preferences is a door to here.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { PreferencesScreen } from '../../../../components/account/PreferencesScreen';
import { PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4c.prefs.title'), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  return PreferencesScreen({ chrome: PLATFORM_CHROME, searchParams });
}
