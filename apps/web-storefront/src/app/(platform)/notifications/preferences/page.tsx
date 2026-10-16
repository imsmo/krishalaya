// apps/web-storefront/src/app/(platform)/notifications/preferences/page.tsx · PC-56 STORE-4c · C1 (the route DELTA kept as a DOOR) — preferences
// are PERSON-level (founder Q13): canon W302 lives at /account/preferences under whichever chrome the person is in
// (components/account/PreferencesScreen.tsx). This old address sends the person there, carrying nothing (the page reads its own state).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslator } from '../../../../lib/i18n';
import { accountHref, PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4c.prefs.title'), robots: { index: false, follow: false } };
}

export default function PreferencesDoor(): never {
  redirect(accountHref(PLATFORM_CHROME, 'preferences'));
}
