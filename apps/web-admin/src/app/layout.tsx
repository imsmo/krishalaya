// apps/web-admin/src/app/layout.tsx · god-mode console shell. noindex (never crawlable). Renders the
// packages/ui-ported AppShell/Sidebar/Topbar chrome only when an admin session cookie is present (otherwise
// the bare login surface). Each page still gates server-side via requireAdmin and admin-api re-enforces
// owner-RBAC + step-up per call. No inline styles.
//
// DEV-61 (UI Port Program batch 4, shell adoption): rewired from this app's own hand-rolled `.kv-shell`/
// `.kv-content` div + ad-hoc `<Sidebar>` onto `@krishalaya/ui`'s ported `AppShell`/`Sidebar`/`Topbar` — the
// SAME rewire `web-tenant` already proved at DEV-18 (`apps/web-tenant/src/app/layout.tsx` is the direct
// precedent this file mirrors: `<KvUiGlobalStyles/>` once in `<head>`, `<AppShell sidebar=.. topbar=..>` for
// the authed branch, the bare `<main className="kv-content kv-content--bare">` branch UNCHANGED for login).
// Preserved byte-for-byte: the skip-link (`.kv-skip`, still app-local — engineering-owed a11y affordance
// canon's static mockups never model, same disclosed shape `web-tenant` also kept local rather than moving
// into the package), the `id="main"` skip-link target, the authed-vs-bare branch, `lang`/`dir` from the real
// `@krishalaya/i18n` `LanguageDef`, `data-theme`, `data-senior`.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getTranslator, ADMIN_LANG } from '../lib/i18n';
import { isAdminAuthenticated } from '../lib/admin-auth';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import { resolveLanguage } from '@krishalaya/i18n';
import { AppShell, KvUiGlobalStyles } from '@krishalaya/ui';
import { Sidebar } from '../components/Sidebar';
import { AdminTopbar } from '../components/AdminTopbar';

export const metadata: Metadata = {
  title: { default: env.appName, template: `%s · ${env.appName}` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const t = getTranslator();
  const authed = isAdminAuthenticated();
  // DEV-19: minimal mechanism wiring, unchanged by this batch's shell swap — `dir` is derived from the real
  // @krishalaya/i18n LanguageDef (if hi/gu/an RTL language is ever registered for this realm, `dir` already
  // flows correctly with zero further changes).
  const lang = resolveLanguage(ADMIN_LANG);
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  // DEV-61: the current pathname, forwarded by `middleware.ts` (new this batch) as `x-pathname` — this Server
  // Component cannot call the client-only `usePathname()` hook, and this is the standard Next.js App Router
  // substitute. Drives `Sidebar`'s real `aria-current="page"` active-nav highlight (see middleware.ts's own
  // header comment for why this is a genuine ADDITION, not a preserved pre-existing behavior).
  const pathname = headers().get('x-pathname') ?? '';
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <head>
        <KvUiGlobalStyles />
      </head>
      <body>
        <a href="#main" className="kv-skip">{t.t('nav.skipToContent')}</a>
        {authed ? (
          <AppShell sidebar={<Sidebar pathname={pathname} />} topbar={<AdminTopbar />} realm="admin">
            <div id="main">{children}</div>
          </AppShell>
        ) : (
          <main className="kv-content kv-content--bare" id="main">{children}</main>
        )}
      </body>
    </html>
  );
}
