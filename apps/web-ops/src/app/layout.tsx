// apps/web-ops/src/app/layout.tsx · root layout (PC-30 OW-0). Sets document language + direction from the
// active locale (kvo_lang cookie → Accept-Language), renders the ops shell (sidebar gated on the session
// cookie — anonymous visitors see only the page, e.g. /login). Server component; the only client JS is the
// locale switcher's tiny form. Ops staff ride the MAIN platform API with ops-scoped permissions (§C-2 ruling:
// never admin-api, never god-mode).
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { hasSessionCookie } from '../lib/auth';
import { Sidebar } from '../components/Sidebar';

export const metadata: Metadata = {
  title: { default: `${env.appName} · Ops`, template: `%s · ${env.appName} Ops` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  const signedIn = hasSessionCookie();
  return (
    <html lang={lang.code} dir={lang.dir}>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.skipToContent')}</a>
        <div className="kv-shell">
          {signedIn && <Sidebar />}
          <main className="kv-content" id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
