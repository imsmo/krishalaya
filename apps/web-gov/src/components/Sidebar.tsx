// apps/web-gov/src/components/Sidebar.tsx · gov-console nav (PC-40 GW-0). Links ONLY to built routes; GW waves
// (GW-1 schemes · GW-2 DBT · GW-3 regulator · GW-4 verification · GW-5 MGNREGA[gated]) append entries as built.
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';

const NAV: ReadonlyArray<{ href: string; labelKey: string }> = [
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/schemes', labelKey: 'nav.schemes' }, // GW-1
  { href: '/registers', labelKey: 'nav.registers' }, // GW-3
  { href: '/verification', labelKey: 'nav.verification' }, // GW-4 (PC-55 B1)
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
