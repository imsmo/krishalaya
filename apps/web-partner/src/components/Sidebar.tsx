// apps/web-partner/src/components/Sidebar.tsx · partner-portal chrome (server component). PC-56 PARTNER-0 · F-13 / Q9: the mark is the
// PLATFORM's (`PLATFORM_BRAND`, packages/tokens) and the organisation is the PARTNER's own name, read from `/v1/partner/me` — never an FPO's
// brand, never a literal. PERSONA-AWARE: it reads the token's `perms` (decoded without verification, persona only) and shows the Lending
// group to a partner holding `partner.applications.read`. Within a visible group, only built routes (`live`) render as real links. The API
// enforces the realm, the partner and the role on every call — this nav never grants access. Sign-out posts to the session route (the API
// session ends, the httpOnly cookies are cleared). No inline styles — all via token-driven CSS classes.
import Link from 'next/link';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { getTranslator } from '../lib/i18n';
import { getPartnerPermissions } from '../lib/partner-auth';
import { partnerClient } from '../lib/api-client';
import { liveNavForPartner, soonNavForPartner } from '../features/nav/nav-model';

export async function Sidebar() {
  const t = getTranslator();
  const perms = getPartnerPermissions();
  const live = liveNavForPartner(perms);
  const soon = soonNavForPartner(perms);
  const orgName = (await partnerClient().partner.me().catch(() => null))?.organisation?.name ?? null;
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')}>
      <Link href="/dashboard" className="kv-brand">
        <span className="kv-brand__mark">{PLATFORM_BRAND.name}</span> <span className="kv-brand__realm">{t.t('nav.brand')}</span>
      </Link>
      <p className="kv-sidebar__org">{orgName ?? t.t('partner.shell.orgUnknown')}</p>
      <ul className="kv-sidebar__nav">
        {live.filter((n) => n.group !== 'account').map((n) => (
          <li key={n.href}><Link href={n.href} className="kv-sidebar__link">{t.t(n.labelKey)}</Link></li>
        ))}
        {soon.map((n) => (
          <li key={n.href}>
            <span className="kv-sidebar__soon" title={t.t('nav.soonTitle')}>{t.t(n.labelKey)} <span className="kv-muted">{t.t('nav.soon')}</span></span>
          </li>
        ))}
      </ul>
      {/* PC-56 PARTNER-1a (D7): the Account group — Settings, Help (built routes only) */}
      <p className="kv-sidebar__group">{t.t('partner1.nav.account')}</p>
      <ul className="kv-sidebar__nav" data-kv-nav-group="account">
        {live.filter((n) => n.group === 'account').map((n) => (
          <li key={n.href}><Link href={n.href} className="kv-sidebar__link">{t.t(n.labelKey)}</Link></li>
        ))}
      </ul>
      <form action="/api/session" method="post" className="kv-sidebar__foot">
        <input type="hidden" name="_action" value="logout" />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
      </form>
    </nav>
  );
}
