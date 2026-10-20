// apps/web-partner/src/components/partner3/ClaimsSubNav.tsx · PC-56 PARTNER-3a (survey E3 / F-17) — the claims pages' own sub-navigation: the canon
// gives nine claims screens ONE sidebar item (and five of them no inbound link at all), so the claims pages carry their tabs. 3a: Queue ·
// Insights. PARTNER-3b adds Evidence · Surveyors · Surveys · Fraud — built routes only, so they are not drawn yet. Presentational.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { CLAIMS_SUBNAV } from '../../features/partner3/refusals';

export function ClaimsSubNav({ t, current }: { t: Tr; current: '/insurer/claims' | '/insurer/claims/insights' | null }) {
  return (
    <nav className="kv-subnav" aria-label={t.t('partner3.subnav.label')} data-kv-subnav="claims">
      {CLAIMS_SUBNAV.filter((i) => i.live).map((i) => (
        <Link key={i.href} href={i.href} className={`kv-chip${current === i.href ? ' is-active' : ''}`} aria-current={current === i.href ? 'page' : undefined} data-kv-subnav-item={i.href}>
          {t.t(i.key)}
        </Link>
      ))}
    </nav>
  );
}
