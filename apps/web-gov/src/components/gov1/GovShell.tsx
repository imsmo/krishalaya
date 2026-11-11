// apps/web-gov/src/components/gov1/GovShell.tsx · PC-56 GOV-1a · E2 — the console shell, presentational (rendered by app/layout.tsx and by the
// render tests). The sidebar is drawn ONLY when `me` is present — the answer of `GET /v1/gov/me` to this session's token (lib/session.ts
// `govGate`) — never from a cookie's presence: an anonymous visitor, an organisation's or a partner's session, a lapsed or ended session all
// see the bare page. The sidebar names the AUTHORITY first (the API's name for it) and the platform small after it; it links only to the
// routes GOV-1a builds (Dashboard — rebuilt in GOV-1b — and Access) and, since PC-56 GOV-2b, Schemes (W326); since GOV-2c, Applications (W330); since GOV-3a, Benefit payments (W332). All copy via i18n; no inline styles; no physical direction.
// PC-56 GOV-1b · E12 (W358): beside the authority's name, the GOV mark; a signed-in shell carries the blue top edge (globals.css,
// `.kv-shell[data-kv-shell="gov"]`); a footer links to the console's rules (`/canon/chrome`) — from the footer, never the sidebar. No emblem,
// no glyph, no image: the authority's name is text.
import type { ReactNode } from 'react';
import type { GovMe } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/gov1/refusals';

export const GOV_NAV: ReadonlyArray<{ href: string; labelKey: string }> = Object.freeze([
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/schemes', labelKey: 'gov2.nav.schemes' },
  { href: '/applications', labelKey: 'gov2.nav.applications' },
  { href: '/dbt', labelKey: 'gov3.nav.dbt' },
  { href: '/access', labelKey: 'gov1.nav.access' },
]);

export function GovSidebar({ t, me, switcher }: { t: Tr; me: GovMe; switcher?: ReactNode }) {
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')} data-kv-sidebar={me.authority?.id ?? 'authority'}>
      <a href="/dashboard" className="kv-brand" data-kv-authority="">{me.authority?.name ?? t.t('gov1.nav.authority')}</a>
      <span className="kv-gov-pill" data-kv-pill="gov">{t.t('gov1.chrome.pill')}</span>
      <p className="kv-fine">{t.t('nav.brand')}</p>
      <ul className="kv-sidebar__nav">
        {GOV_NAV.map((n) => <li key={n.href}><a href={n.href} className="kv-sidebar__link">{t.t(n.labelKey)}</a></li>)}
      </ul>
      <div className="kv-sidebar__footer">
        {switcher}
        <form action="/api/session" method="post">
          <input type="hidden" name="_action" value="logout" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
        </form>
      </div>
    </nav>
  );
}

/** The signed-in footer: the console's rules (W358), linked from here and never from the sidebar. */
export function GovFooter({ t }: { t: Tr }) {
  return (
    <footer className="kv-footer" data-kv-footer="">
      <a className="kv-link" href="/canon/chrome" data-kv-footer-link="chrome">{t.t('gov1.footer.chrome')}</a>
    </footer>
  );
}

export function GovShell({ me, sidebar, footer, skipLabel, children }: { me: GovMe | null; sidebar: ReactNode; footer?: ReactNode; skipLabel: string; children: ReactNode }) {
  return (
    <>
      <a href="#main" className="kv-skip">{skipLabel}</a>
      <div className="kv-shell" data-kv-shell={me ? 'gov' : 'bare'}>
        {me ? sidebar : null}
        <main className="kv-content" id="main">
          {children}
          {me ? footer : null}
        </main>
      </div>
    </>
  );
}
