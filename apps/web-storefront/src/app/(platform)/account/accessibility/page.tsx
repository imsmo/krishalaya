// apps/web-storefront/src/app/(platform)/account/accessibility/page.tsx · PC-56 STORE-5a · C4 — Accessibility (canon W324) under the platform
// chrome. The page is the SHARED screen (components/account/AccessibilityScreen.tsx — one copy for both chromes); this file only names the
// chrome. Dynamic (the modes are this device's cookies); noindex; no sign-in (a device preference, founder D4).
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { AccessibilityScreen } from '../../../../components/account/AccessibilityScreen';
import { PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5a.a11y.title'), robots: { index: false, follow: false } };
}

export default function Page({ searchParams }: { searchParams: SP }) {
  return AccessibilityScreen({ chrome: PLATFORM_CHROME, searchParams });
}
