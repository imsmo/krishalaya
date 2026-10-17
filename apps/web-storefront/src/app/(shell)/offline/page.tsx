// apps/web-storefront/src/app/(shell)/offline/page.tsx · the offline fallback (PC-24c). Pre-cached by the service worker at install and
// served when a navigation fails with no network. Static, no data reads (it must render from cache alone), localized server-side at
// request time, noindex.
// PC-56 HOTFIX-8 · D1 (a): moved from `(platform)/` into the session-free `(shell)` group (its layout prints no session-derived header).
// "Try again" — the shell is ONE cached copy served for whichever navigation failed, so the server cannot know the URL the person asked
// for; the browser can (the address bar keeps the requested URL when the worker answers with the shell). The link is `/` in the HTML (no
// script: still a way back) and a one-line script points it at `location.href` — the requested page — whenever the shell stands in for
// another URL. (`offline.hint` names the platform's mobile app — survey Q10 / F-4, STORE-6a's to settle, untouched here.)
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offline.title'), robots: { index: false, follow: false } };
}

/** Point "Try again" at the URL the person asked for (the shell answered a failed navigation to it). Not exported: a page exports only Next's names. */
const RETRY_SCRIPT = "(function(){var a=document.querySelector('[data-kv-retry]');if(a&&location.pathname!=='/offline'){a.setAttribute('href',location.href)}})()";

export default function OfflinePage() {
  const t = getTranslator();
  return (
    <section className="kv-offline" data-kv-offline="shell" style={{ textAlign: 'center', padding: '48px 16px' }}>
      <h1>{t.t('offline.heading')}</h1>
      <p>{t.t('offline.body')}</p>
      <p className="kv-detail__muted">{t.t('offline.hint')}</p>
      <a href="/" className="kv-btn" data-kv-retry="">{t.t('offline.retry')}</a>
      <script dangerouslySetInnerHTML={{ __html: RETRY_SCRIPT }} />
    </section>
  );
}
