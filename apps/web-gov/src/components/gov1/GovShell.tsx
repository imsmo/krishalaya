// apps/web-gov/src/components/gov1/GovShell.tsx · PC-56 GOV-1a · E2 — the console shell, presentational (rendered by app/layout.tsx and by the
// render tests). The sidebar is drawn ONLY when `me` is present — the answer of `GET /v1/gov/me` to this session's token (lib/session.ts
// `govGate`) — never from a cookie's presence: an anonymous visitor, an organisation's or a partner's session, a lapsed or ended session all
// see the bare page. The sidebar names the AUTHORITY first (the API's name for it) and the platform small after it; it links only to the
// routes GOV-1a builds (Dashboard — rebuilt in GOV-1b — and Access). All copy via i18n; no inline styles; no physical direction.
import type { ReactNode } from 'react';
import type { GovMe } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/gov1/refusals';

export const GOV_NAV: ReadonlyArray<{ href: string; labelKey: string }> = Object.freeze([
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/access', labelKey: 'gov1.nav.access' },
]);

export function GovSidebar({ t, me, switcher }: { t: Tr; me: GovMe; switcher?: ReactNode }) {
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')} data-kv-sidebar={me.authority?.id ?? 'authority'}>
      <a href="/dashboard" className="kv-brand" data-kv-authority="">{me.authority?.name ?? t.t('gov1.nav.authority')}</a>
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

export function GovShell({ me, sidebar, skipLabel, children }: { me: GovMe | null; sidebar: ReactNode; skipLabel: string; children: ReactNode }) {
  return (
    <>
      <a href="#main" className="kv-skip">{skipLabel}</a>
      <div className="kv-shell" data-kv-shell={me ? 'gov' : 'bare'}>
        {me ? sidebar : null}
        <main className="kv-content" id="main">{children}</main>
      </div>
    </>
  );
}

/** /dashboard until GOV-1b builds W325: one true sentence; it reads nothing. */
export function RebuiltLater({ t }: { t: Tr }) {
  return (
    <section className="kv-empty-state" data-kv-reads="nothing">
      <h1>{t.t('dash.title')}</h1>
      <p>{t.t('gov1.dash.rebuilt')}</p>
    </section>
  );
}
