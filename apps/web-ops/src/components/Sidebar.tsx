// apps/web-ops/src/components/Sidebar.tsx · the ops-console nav (PC-30 OW-0). Links ONLY to built routes
// (the law): OW-0 ships the dashboard; each OW wave adds its entry as it lands. No client JS.
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';

const NAV: ReadonlyArray<{ href: string; labelKey: string }> = [
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/kiosk', labelKey: 'nav.kiosk' }, // OW-1
  { href: '/warehouse', labelKey: 'nav.warehouse' }, // OW-2
  // OW-1 kiosk · OW-2 warehouse · OW-3 equipment/CHC · OW-4 dairy POS · OW-5 assisted money · OW-6 insights
  // are appended here by their waves (OPS_BUILD_BACKLOG.md) — never linked before they exist.
];

export function Sidebar() {
  const t = getTranslator();
  const lang = getLang();
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')}>
      <a href="/dashboard" className="kv-brand">{t.t('nav.brand')}</a>
      <ul className="kv-sidebar__nav">
        {NAV.map((n) => (
          <li key={n.href}><a href={n.href} className="kv-sidebar__link">{t.t(n.labelKey)}</a></li>
        ))}
      </ul>
      <div className="kv-sidebar__footer">
        <LocaleSwitcher active={lang} label={t.t('lang.label')} />
        <form action="/api/session" method="post">
          <input type="hidden" name="_action" value="logout" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
        </form>
      </div>
    </nav>
  );
}
