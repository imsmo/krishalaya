// apps/web-partner/src/components/partner3/ClaimsSubNav.tsx · PC-56 PARTNER-3a (survey E3 / F-17) — the claims pages' own sub-navigation: the canon
// gives nine claims screens ONE sidebar item (and five of them no inbound link at all), so the claims pages carry their tabs. 3a: Queue ·
// Insights; PARTNER-3b added Evidence · Surveyors · Surveys · Fraud. Only a row whose `live` flag is set is drawn (a route that does not exist
// is never linked), and the four 3b routes are in NO nav group for any kind — this is their only way in. Presentational.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { CLAIMS_SUBNAV, type ClaimsSubNavHref } from '../../features/partner3/refusals';

export function ClaimsSubNav({ t, current }: { t: Tr; current: ClaimsSubNavHref | null }) {
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
