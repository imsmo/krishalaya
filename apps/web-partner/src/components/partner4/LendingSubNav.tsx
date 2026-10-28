// apps/web-partner/src/components/partner4/LendingSubNav.tsx · PC-56 PARTNER-4a (survey E2 / F-22) — the lending pages' own sub-navigation:
// the canon's lender sidebar has FIVE lending items for NINE lending screens, and cannot reach W215, W216, W217 or W218 at all, so the
// lending pages carry their tabs. 4a draws Queue · Portfolio; PARTNER-4b's Disbursements and Repayments rows are `live: false` and are NOT
// drawn (a route that does not exist is never linked). Presentational.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LENDING_SUBNAV, type LendingSubNavHref } from '../../features/partner4/refusals';

export function LendingSubNav({ t, current }: { t: Tr; current: LendingSubNavHref | null }) {
  return (
    <nav className="kv-subnav" aria-label={t.t('partner4.subnav.label')} data-kv-subnav="lending">
      {LENDING_SUBNAV.filter((i) => i.live).map((i) => (
        <Link key={i.href} href={i.href} className={`kv-chip${current === i.href ? ' is-active' : ''}`} aria-current={current === i.href ? 'page' : undefined} data-kv-subnav-item={i.href}>
          {t.t(i.key)}
        </Link>
      ))}
    </nav>
  );
}
