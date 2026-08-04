// apps/web-tenant/src/app/layout.tsx · console shell. Server component. Sets <html lang/dir> from the active
// locale; renders the console chrome only when a session cookie is present (otherwise the bare login surface).
// Every page is noindex (authenticated app, no SEO surface). Each page still gates server-side via requireSession
// and the API re-enforces RBAC per call.
//
// DEV-18 REAL consuming-app smoke test (packages/ui port batch 4): the hand-rolled `.kv-shell`/`.kv-content`
// div + ad-hoc `<Sidebar>` chrome is rewired onto `@krishalaya/ui`'s ported `AppShell`/`Sidebar`/`Topbar`
// (the first real usage of the port in a running app — see `dev18_report.md`). `<KvUiGlobalStyles />` is
// rendered once here, in `<head>`, per that component's own integration requirement
// (`packages/ui/src/GlobalStyles.tsx`'s header comment: "a consuming app renders `<KvUiGlobalStyles />` ONCE,
// near its root layout"). The identity fetch (`auth.me()`) moved here from the old `Sidebar` component so it
// happens exactly ONCE per request and is shared by both `Sidebar`'s tenant slot and `ConsoleTopbar`'s user
// menu (Golden Law 11 — scale honesty, not just a stylistic choice: the previous per-component-fetch shape
// would now cost 2 real API round-trips per page load instead of 1). This layout is now `async` (Next.js App
// Router server layouts support this natively) — a real, honest behavior change, not a workaround.
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { hasSessionCookie } from '../lib/auth';
import { tenantClient } from '../lib/api-client';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import type { UserProfile } from '@krishalaya/sdk-js';
import { AppShell, KvUiGlobalStyles } from '@krishalaya/ui';
import { Sidebar } from '../components/Sidebar';
import { ConsoleTopbar } from '../components/ConsoleTopbar';

export const metadata: Metadata = {
  title: { default: env.appName, template: `%s · ${env.appName}` },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  const authed = hasSessionCookie();
  let me: UserProfile | null = null;
  if (authed) {
    try { me = await tenantClient().auth.me(); } catch { me = null; }
  }
  // DEV-19: theme (dark/light/system) + senior-mode attrs, resolved SERVER-SIDE from cookies (see
  // `lib/mechanism.ts`) — rendered directly into the initial HTML, so there is no client-side flash/hydration
  // mismatch to guard against (see `@krishalaya/ui`'s `mechanisms/theme.ts` header comment for the full
  // SSR-strategy rationale). `data-senior` mirrors the same cookie-driven, zero-client-JS pattern.
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <head>
        <KvUiGlobalStyles />
      </head>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.skipToContent')}</a>
        {authed ? (
          <AppShell sidebar={<Sidebar me={me} />} topbar={<ConsoleTopbar me={me} />}>
            <div id="main">{children}</div>
          </AppShell>
        ) : (
          <main className="kv-content kv-content--bare" id="main">{children}</main>
        )}
      </body>
    </html>
  );
}
