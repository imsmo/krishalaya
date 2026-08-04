// apps/web-admin/src/components/Sidebar.tsx · the god-mode console chrome (server component). Red-brand "GOD MODE"
// banner signals the elevated realm. The nav links ONLY to built routes (features/nav ADMIN_NAV `live` items);
// not-yet-built surfaces render as non-link "(soon)" labels. Owner-RBAC is enforced by admin-api per call — this
// nav reflects route existence, never grants access. Sign-out posts to the logout route (clears the httpOnly
// admin cookie). No inline styles — all via token-driven CSS classes.
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';
import { liveNav, soonNav } from '../features/nav/nav-model';

export function Sidebar() {
  const t = getTranslator();
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')}>
      <Link href="/dashboard" className="kv-brand">Krishalaya Admin <span className="kv-godmode">{t.t('nav.godmode')}</span></Link>
      <ul className="kv-sidebar__nav">
        {liveNav().map((n) => (
          <li key={n.href}><Link href={n.href} className="kv-sidebar__link">{t.t(n.labelKey)}</Link></li>
        ))}
        {soonNav().map((n) => (
          <li key={n.href}>
            <span className="kv-sidebar__soon" title={t.t('nav.soonTitle')}>{t.t(n.labelKey)} <span className="kv-muted">{t.t('nav.soon')}</span></span>
          </li>
        ))}
      </ul>
      <form action="/api/session" method="post" className="kv-sidebar__foot">
        <input type="hidden" name="_action" value="logout" />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
      </form>
    </nav>
  );
}
