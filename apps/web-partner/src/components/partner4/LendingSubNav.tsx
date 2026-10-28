// apps/web-partner/src/components/partner4/LendingSubNav.tsx · PC-56 PARTNER-4a (survey E2 / F-22) — the lending pages' own sub-navigation:
// the canon's lender sidebar has FIVE lending items for NINE lending screens, and cannot reach W215, W216, W217 or W218 at all, so the
// lending pages carry their tabs. 4a drew Queue · Portfolio; PARTNER-4b made its Pay-outs and Repayments rows live.
// PC-56 PARTNER-4c adds the KCC row, which is the inbound edge the canon never drew to W216 — and it is the one row whose route needs a LOAN
// ID (`/lender/kcc/[id]`), so it is drawn only where a loan is in scope: the loan page and the two KCC pages pass `loanId`. Everywhere else
// the row is absent rather than dead (a route that cannot be addressed is never linked). Presentational.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LENDING_SUBNAV, type LendingSubNavHref } from '../../features/partner4/refusals';
import { kccHref } from '../../features/partner4/figures';

export function LendingSubNav({ t, current, loanId }: { t: Tr; current: LendingSubNavHref | null; loanId?: string }) {
  const rows = LENDING_SUBNAV.filter((i) => i.live && (!i.needsLoanId || !!loanId));
  return (
    <nav className="kv-subnav" aria-label={t.t('partner4.subnav.label')} data-kv-subnav="lending">
      {rows.map((i) => {
        const href = i.needsLoanId && loanId ? kccHref(loanId) : i.href;
        return (
          <Link key={i.href} href={href} className={`kv-chip${current === i.href ? ' is-active' : ''}`} aria-current={current === i.href ? 'page' : undefined} data-kv-subnav-item={i.href}>
            {t.t(i.key)}
          </Link>
        );
      })}
    </nav>
  );
}
