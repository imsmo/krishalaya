// apps/web-partner/src/app/layout.tsx · partner-portal shell (server component, noindex). Renders the persona-aware
// Sidebar chrome only when a session cookie is present (otherwise the bare login surface). Each page still gates
// server-side via requirePartner and the platform API re-enforces partner RBAC + RLS per call. No inline styles.
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getTranslator, PARTNER_LANG } from '../lib/i18n';
import { isAuthenticated } from '../lib/partner-auth';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import { resolveLanguage } from '@krishi-verse/i18n';
import { Sidebar } from '../components/Sidebar';

export const metadata: Metadata = {
  title: { default: env.appName, template: `%s · ${env.appName}` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const t = getTranslator();
  const authed = isAuthenticated();
  // DEV-19: minimal mechanism wiring for this not-yet-on-packages/ui app (see lib/mechanism.ts's own header
  // comment for the disclosed boundary). `dir` is now derived from the real @krishi-verse/i18n LanguageDef
  // (previously hardcoded absent entirely — a real gap closed here, not just cosmetic).
  const lang = resolveLanguage(PARTNER_LANG);
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.backToDashboard')}</a>
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
