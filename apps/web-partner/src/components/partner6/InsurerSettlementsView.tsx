// apps/web-partner/src/components/partner6/InsurerSettlementsView.tsx · PC-56 PARTNER-6a · W260 CLAIM SETTLEMENTS — COUNTS ONLY (founder 6a-1),
// presentational.
//
// What `GET /v1/partner/insurance/claims/counts` answered, and three statuses of it: of the claims on the insurer's products FILED in the IST
// window, how many are approved and partially approved — each "awaiting a settlement this platform does not make" and each a REAL link to the
// claims queue filtered by that status — the two added together (integer addition of counts only), and paid, which is 0 by construction,
// beside "No claim is paid on this platform." The founder's statement is printed in every state but switched-off. NO rupee total, NO amount,
// NO claimant, NO account, NO run, NO rail — no money formatter is imported here at all. "Release today's run" is DECOR → the W2901–W2903
// chain (`?act=confirm`), labelled with what is true; "View claims" is real; the error state's Retry opens the same DECOR chain, whose Back
// re-reads the counts. Every refused canon line is printed BY NAME (`SettlementRefusals`).
import Link from 'next/link';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from '../partner3/ClaimsSubNav';
import { SettlementRefusals } from './InsurerChain6';
import { asOfText } from '../../features/partner1/dashboard';
import { settlementCounts, settlementsHref, type SettlementsState } from '../../features/partner6/figures';

export function InsurerSettlementsView({ t, lang, state, counts }: { t: Tr; lang: string; state: SettlementsState; counts: PartnerInsuranceClaimCounts | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="settlements" />;
  const self = settlementsHref();
  const s = counts ? settlementCounts(counts.byStatus) : null;
  const win = counts ? (counts.fy ? t.t('partner6.settlements.windowFy', { fy: counts.fy }) : t.t('partner6.settlements.windowRange', { from: counts.from, to: counts.to })) : t.t('partner6.settlements.countsTitle');
  return (
    <section data-kv-insurer="settlements" data-kv-state={state}>
      <h1>{t.t('partner6.settlements.title')}</h1>
      <p className="kv-muted">{t.t('partner6.settlements.lead')}</p>
      <ClaimsSubNav t={t} current="/insurer/settlements" />

      <div className="kv-card" data-kv-statement="settlements">
        <h2 className="kv-card__title">{t.t('partner6.settlements.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.settlements.statement">{t.t('partner6.settlements.statement')}</p>
      </div>

      {state === 'error' || !s || !counts ? (
        <div className="kv-card" role="alert" data-kv-error="counts">
          <h2 className="kv-card__title">{t.t('partner6.settlements.error.title')}</h2>
          <p>{t.t('partner6.settlements.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${self}?act=confirm`} data-kv-decor="retry">{t.t('partner3.retry')}</Link></p>
        </div>
      ) : (
        <div className="kv-card kv-counts" data-kv-counts="settlements">
          <h2 className="kv-card__title">{win}</h2>
          <p className="kv-muted" data-kv-note="filed">{t.t('partner6.settlements.filedNote')}</p>
          {state === 'empty' && (
            <div className="kv-empty-state" data-kv-empty="settlements">
              <h3>{t.t('partner6.settlements.empty.title')}</h3>
              <p>{t.t('partner6.settlements.empty.body')}</p>
            </div>
          )}
          <dl className="kv-counts__list">
            {s.rows.map((r) => (
              <div key={r.id} className="kv-counts__item" data-kv-count={r.id}>
                <dt>{t.t(r.key)}</dt><dd>{r.n}</dd>
                <dd><Link href={r.href} data-kv-claims-link={r.id}>{t.t('partner6.settlements.seeClaims')}</Link></dd>
              </div>
            ))}
            <div className="kv-counts__item" data-kv-count="awaiting"><dt>{t.t('partner6.settlements.awaiting')}</dt><dd>{s.awaiting}</dd></div>
            <div className="kv-counts__item" data-kv-count="paid"><dt>{t.t('partner6.settlements.paid')}</dt><dd>{s.paid}</dd></div>
          </dl>
          <p className="kv-statement" data-kv-statement="partner6.settlements.paidNone">{t.t('partner6.settlements.paidNone')}</p>
          <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner3.asOf', { time: asOfText(counts.computedAt, lang) })}</p>
        </div>
      )}

      <p className="kv-pager" data-kv-acts="settlements">
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="release">{t.t('partner6.settlements.releaseAct')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-real="claims">{t.t('partner6.settlements.viewClaims')}</Link>
      </p>
      <SettlementRefusals t={t} surface="settlements" />
    </section>
  );
}
