// apps/web-gov/src/app/layout.tsx · root layout of the GOVERNMENT console. Sets document language + direction from the active locale
// (kvg_lang cookie → Accept-Language). PC-56 GOV-1a · E2 (survey C-3 / F-4): the sidebar is drawn ONLY from a session the API has verified —
// `govGate()` asks `GET /v1/gov/me` with this request's access token — never from a cookie's presence; anything else (anonymous, an
// organisation's or a partner's session, an ended one) renders the bare page. Each page still gates server-side through requireGov, and the
// API re-enforces the gov realm on every call. (C-8: the header used to say it rendered "the ops shell" for "gov-persona scoped tokens".)
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { govGate } from '../lib/session';
import { GovShell } from '../components/gov1/GovShell';
import { Sidebar } from '../components/Sidebar';

export const metadata: Metadata = {
  title: { default: `${env.appName} · Gov`, template: `%s · ${env.appName} Gov` },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  const gate = await govGate();
  const me = gate.kind === 'gov' ? gate.me : null;
  return (
    <html lang={lang.code} dir={lang.dir}>
      <body>
        <GovShell me={me} sidebar={me ? <Sidebar me={me} /> : null} skipLabel={t.t('common.skipToContent')}>{children}</GovShell>
      </body>
    </html>
  );
}
