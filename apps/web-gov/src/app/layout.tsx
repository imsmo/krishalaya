// apps/web-gov/src/app/layout.tsx · root layout of the GOVERNMENT console. Sets document language + direction from the active locale
// (kvg_lang cookie → Accept-Language; Arabic only from the cookie — PC-56 RTL-1f). PC-56 GOV-1a · E2 (survey C-3 / F-4): the sidebar is drawn ONLY from a session the API has verified —
// `govGate()` asks `GET /v1/gov/me` with this request's access token — never from a cookie's presence; anything else (anonymous, an
// organisation's or a partner's session, an ended one) renders the bare page. Each page still gates server-side through requireGov, and the
// API re-enforces the gov realm on every call. (C-8: the header used to say it rendered "the ops shell" for "gov-persona scoped tokens".)
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { govGate } from '../lib/session';
import { GovFooter, GovShell } from '../components/gov1/GovShell';
import { Sidebar } from '../components/Sidebar';
import { PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { en } from '../i18n/en';

export const metadata: Metadata = {
  title: { default: `${env.appName} · Gov`, template: `%s · ${env.appName} Gov` },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  const gate = await govGate();
  const me = gate.kind === 'gov' ? gate.me : null;
  // PC-56 RTL-1f (founder Q1, web-tenant's RTL-1b-1 banner): while a PREVIEW language (Arabic — a machine draft nobody has reviewed) is the
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
        <GovShell me={me} sidebar={me ? <Sidebar me={me} /> : null} footer={me ? <GovFooter t={t} /> : null} skipLabel={t.t('common.skipToContent')} banner={draftBanner}>{children}</GovShell>
      </body>
    </html>
  );
}
