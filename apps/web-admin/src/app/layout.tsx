// apps/web-admin/src/app/layout.tsx · god-mode console shell. noindex (never crawlable). Renders the red-brand
// Sidebar chrome only when an admin session cookie is present (otherwise the bare login surface). Each page still
// gates server-side via requireAdmin and admin-api re-enforces owner-RBAC + step-up per call. No inline styles.
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getTranslator, ADMIN_LANG } from '../lib/i18n';
import { isAdminAuthenticated } from '../lib/admin-auth';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import { resolveLanguage } from '@krishalaya/i18n';
import { Sidebar } from '../components/Sidebar';

export const metadata: Metadata = {
  title: { default: env.appName, template: `%s · ${env.appName}` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const t = getTranslator();
  const authed = isAdminAuthenticated();
  // DEV-19: minimal mechanism wiring for this not-yet-on-packages/ui app (see lib/mechanism.ts's own header
  // comment for the disclosed boundary). `dir` is now derived from the real @krishalaya/i18n LanguageDef
  // (previously hardcoded absent entirely — a real gap closed here, not just cosmetic: if hi/gu/an RTL
  // language is ever registered for this realm, `dir` already flows correctly with zero further changes).
  const lang = resolveLanguage(ADMIN_LANG);
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <body>
        <a href="#main" className="kv-skip">{t.t('nav.skipToContent')}</a>
        {authed ? (
          <div className="kv-shell">
            <Sidebar />
            <main className="kv-content" id="main">{children}</main>
          </div>
        ) : (
          <main className="kv-content kv-content--bare" id="main">{children}</main>
        )}
      </body>
    </html>
  );
}
