// apps/web-partner/src/app/layout.tsx · partner-portal shell (server component, noindex). Renders the persona-aware
// Sidebar chrome only when a session cookie is present (otherwise the bare login surface). Each page still gates
// server-side via requirePartner and the platform API re-enforces partner RBAC + RLS per call. No inline styles.
import type { Metadata } from 'next';
import { PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getTranslator, getLanguageDef } from '../lib/i18n';
import { isAuthenticated } from '../lib/partner-auth';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import { Sidebar } from '../components/Sidebar';
import { en } from '../i18n/en';

export const metadata: Metadata = {
  title: { default: env.appName, template: `%s · ${env.appName}` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const t = getTranslator();
  const authed = isAuthenticated();
  // DEV-19: minimal mechanism wiring for this not-yet-on-packages/ui app (see lib/mechanism.ts's own header
  // comment for the disclosed boundary). `dir` is now derived from the real @krishalaya/i18n LanguageDef
  // (previously hardcoded absent entirely — a real gap closed here, not just cosmetic).
  const lang = getLanguageDef();   // PC-56 PARTNER-0: the kv_lang cookie (en / hi / gu); RTL-1d: the ar machine draft on an explicit choice only
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  // PC-56 RTL-1d (founder Q1 "Draft all, opt-in only"): while a PREVIEW language (Arabic — a machine draft nobody has reviewed) is the chosen
  // language, every page says so, in that language AND in English (canon lang-ar/W128 `.md-banner-ar`) — above the chrome and the bare
  // login surface alike. Under en/hi/gu nothing is drawn. The English line reads the en catalogue directly.
  const draftBanner = PREVIEW_LANGUAGES.includes(lang.code) ? (
    <div className="kv-md-banner" role="note" data-kv-md-banner={lang.code}>
      <p lang={lang.code} dir={lang.dir}>{t.t('rtl.draftBanner')}</p>
      <p lang="en" dir="ltr">{en['rtl.draftBanner']}</p>
    </div>
  ) : null;
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.backToDashboard')}</a>
        {draftBanner}
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
