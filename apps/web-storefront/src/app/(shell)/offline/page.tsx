// apps/web-storefront/src/app/(shell)/offline/page.tsx · the offline fallback (PC-24c). Pre-cached by the service worker at install and
// served when a navigation fails with no network. Static, no data reads (it must render from cache alone), localized server-side at
// request time, noindex.
// PC-56 HOTFIX-8 · D1 (a): moved from `(platform)/` into the session-free `(shell)` group (its layout prints no session-derived header).
// "Try again" — the shell is ONE cached copy served for whichever navigation failed, so the server cannot know the URL the person asked
// for; the browser can (the address bar keeps the requested URL when the worker answers with the shell). The link is `/` in the HTML (no
// script: still a way back) and a one-line script points it at `location.href` — the requested page — whenever the shell stands in for
// another URL.
// PC-56 STORE-6a · C3 (canon W313): the page is now ALSO the rules — components/offline/OfflineScreen.tsx, the ONE screen the organisation's
// `/<slug>/offline` renders too. Still no session read and no API call here: the platform's sentence about kept pages is printed (the
// platform host's own pages read the flag OFF). `?form=…` prints the W3127–W3130 DECOR states. `offline.hint` (the platform's mobile-app
// plug) is retired (founder D7).
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { OfflineScreen } from '../../../components/offline/OfflineScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offline.title'), robots: { index: false, follow: false } };
}

export default function OfflinePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <OfflineScreen chrome={PLATFORM_CHROME} orgName={null} offlineReads={null} searchParams={searchParams ?? {}} />;
}
