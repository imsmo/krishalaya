// apps/web-tenant/src/components/Sidebar.tsx · DEV-18 REAL consuming-app smoke test (packages/ui port
// batch 4) — rewired from a hand-rolled `<nav>`/`<ul>` (this app's own now-superseded `.kv-sidebar*` CSS,
// `globals.css`) onto `@krishalaya/ui`'s ported `Sidebar` component. The nav item list, feature-flag
// gating, and i18n labels are UNCHANGED from the pre-DEV-18 version — only the render target moved.
//
// `me` (signed-in staff identity) is now fetched ONCE by the parent `layout.tsx` and passed down as a prop,
// shared with `ConsoleTopbar` — the pre-DEV-18 version fetched it again inside this component; now that
// BOTH the sidebar (tenant slot) and the topbar (user-menu slot) need the same identity, fetching it twice
// per request would be a real, avoidable extra round-trip (Golden Law 11 — scale honesty, applies even at
// N=1: the correct shape doesn't change with request volume).
//
// KNOWN INTEGRATION TRADE-OFF (disclosed, not hidden — see `dev18_report.md`): `@krishalaya/ui`'s
// `Sidebar` is framework-agnostic (it cannot import `next/link`) and renders each nav item as a plain
// `<a href>`. The pre-DEV-18 version used Next's `<Link>` for client-side transitions; this rewire trades
// that away for a real, shared cross-app component — every sidebar nav click is now a full page navigation
// (still correct, still accessible, just not a client-side transition). Flagged as a real cost of adopting
// the shared library, not silently absorbed.
import type { UserProfile } from '@krishalaya/sdk-js';
import { Sidebar as UiSidebar } from '@krishalaya/ui';
import type { SidebarNavSection } from '@krishalaya/ui';
import { getTranslator, getLang } from '../lib/i18n';
import { env } from '../lib/env';
import { LocaleSwitcher } from './LocaleSwitcher';

export function Sidebar({ me }: { me: UserProfile | null }) {
  const t = getTranslator();
  const lang = getLang();

  const sections: SidebarNavSection[] = [
    {
      key: 'primary',
      items: [
        { key: 'dashboard', href: '/dashboard', label: t.t('nav.dashboard') },
        { key: 'listings', href: '/listings', label: t.t('nav.listings') },
        { key: 'orders', href: '/orders', label: t.t('nav.orders') },
        { key: 'offers', href: '/offers', label: t.t('nav.offers') },
        { key: 'payouts', href: '/payouts', label: t.t('nav.payouts') },
        { key: 'wallet', href: '/wallet', label: t.t('nav.wallet') },
        ...(env.featureAuctions ? [{ key: 'auctions', href: '/auctions', label: t.t('nav.auctions') }] : []),
        ...(env.featureDairy ? [{ key: 'dairy', href: '/dairy', label: t.t('nav.dairy') }] : []),
        ...(env.featureLabour ? [{ key: 'labour', href: '/labour', label: t.t('nav.labour') }] : []),
        ...(env.featureAmbassadors ? [{ key: 'ambassadors', href: '/ambassadors', label: t.t('nav.ambassadors') }] : []),
        ...(env.featureSchemes ? [{ key: 'schemes', href: '/schemes', label: t.t('nav.schemes') }] : []),
        ...(env.featureGroupLots ? [{ key: 'group-lots', href: '/group-lots', label: t.t('nav.groupLots') }] : []),
        ...(env.featureAuditor ? [{ key: 'auditor', href: '/auditor', label: t.t('nav.auditor') }] : []),
        ...(env.featureAiReview ? [{ key: 'ai-review', href: '/ai-review', label: t.t('nav.aiReview') }] : []),
        { key: 'disputes', href: '/disputes', label: t.t('nav.disputes') },
        { key: 'notifications', href: '/notifications', label: t.t('nav.notifications') },
        { key: 'billing', href: '/billing', label: t.t('nav.billing') },
        { key: 'team', href: '/team', label: t.t('nav.team') },
        { key: 'kyc', href: '/kyc', label: t.t('nav.kyc') },
        { key: 'settings', href: '/settings', label: t.t('nav.settings') },
      ],
    },
  ];

  return (
    <UiSidebar
      brand={{ name: env.appName }}
      tenant={me ? <strong>{me.displayName ?? me.id}</strong> : undefined}
      sections={sections}
      footer={
        <>
          <LocaleSwitcher active={lang} label={t.t('lang.label')} />
          <form action="/api/session" method="post">
            <input type="hidden" name="_action" value="logout" />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
          </form>
        </>
      }
      navLabel={t.t('nav.primary')}
    />
  );
}
