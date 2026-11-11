// apps/web-ops/src/app/layout.tsx · root layout (PC-30 OW-0). Sets document language + direction from the
// active locale (kvo_lang cookie → Accept-Language; Arabic only from the cookie — PC-56 RTL-1e), renders the ops shell (sidebar gated on the session
// cookie — anonymous visitors see only the page, e.g. /login). Server component; the only client JS is the
// locale switcher's tiny form. Ops staff ride the MAIN platform API with ops-scoped permissions (§C-2 ruling:
// never admin-api, never god-mode).
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { hasSessionCookie } from '../lib/auth';
import { Sidebar } from '../components/Sidebar';
import { PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { en } from '../i18n/en';

export const metadata: Metadata = {
  title: { default: `${env.appName} · Ops`, template: `%s · ${env.appName} Ops` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  const signedIn = hasSessionCookie();
  // PC-56 RTL-1e (founder Q1, web-tenant's RTL-1b-1 banner): while a PREVIEW language (Arabic — a machine draft nobody has reviewed) is the
  // chosen language, every page says so, in that language AND in English (canon lang-ar/W128 `.md-banner-ar`). Under en/hi/gu nothing is
  // drawn. The English line reads the en catalogue directly, never the active language's.
  const draftBanner = PREVIEW_LANGUAGES.includes(lang.code) ? (
    <div className="kv-md-banner" role="note" data-kv-md-banner={lang.code}>
      <p lang={lang.code} dir={lang.dir}>{t.t('rtl.draftBanner')}</p>
      <p lang="en" dir="ltr">{en['rtl.draftBanner']}</p>
    </div>
  ) : null;
  return (
    <html lang={lang.code} dir={lang.dir}>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.skipToContent')}</a>
        {draftBanner}
        <div className="kv-shell">
          {signedIn && <Sidebar />}
          <main className="kv-content" id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
