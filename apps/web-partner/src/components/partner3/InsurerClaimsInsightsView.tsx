// apps/web-partner/src/components/partner3/InsurerClaimsInsightsView.tsx · PC-56 PARTNER-3a · W264 CLAIMS INSIGHTS — COUNTS, NEVER A MONEY RATIO
// (founder Q1 / E10), presentational.
//
// What `GET /v1/partner/insurance/claims/counts` answered: the window (the FY, April–March in Asia/Kolkata, answered by the platform's database)
// and the COUNTS of the claims filed in it on the insurer's own products — by status, by the platform's eight event type codes + "not recorded",
// and the decided counts (approved, partially approved, rejected). No percentage, no ratio, no typical time, no rupee headline — the canon's
// claims-to-premium figure, event-to-payment time, approval rate, complaint count, funding line and three outcome stories are refused by name.
// "Export" is DECOR (W2855–W2856, `?export=`: no partner export plane — the mailbox line); "Retry" is the W2857–W2859 re-read (`?act=`);
// "View claims" is real.
import Link from 'next/link';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import { decidedRows, eventRows, statusRows, windowLabel, type CountsState } from '../../features/partner3/figures';

export function InsurerClaimsInsightsView({ t, lang, state, counts }: { t: Tr; lang: string; state: CountsState; counts: PartnerInsuranceClaimCounts | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="claims_insights" />;
  const win = windowLabel(counts);
  const table = (id: string, title: string, rows: Array<{ key: string; label: string; n: number }>) => (
    <div className="kv-card" data-kv-insights={id}>
      <h2 className="kv-card__title">{title}</h2>
      <table className="kv-table">
        <tbody>{rows.map((r) => <tr key={r.key} data-kv-row={r.key}><th scope="row">{r.label}</th><td>{r.n}</td></tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <section data-kv-insurer="claims_insights" data-kv-state={state}>
      <h1>{t.t('partner3.insights.title')}</h1>
      <p className="kv-muted">{t.t('partner3.insights.lead')}</p>
      <ClaimsSubNav t={t} current="/insurer/claims/insights" />
      {win && <p className="kv-statement" data-kv-window={counts?.from}>{t.t(win.key, win.vars)}</p>}
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href="/insurer/claims/insights?export=queued" data-kv-decor="export">{t.t('partner3.insights.export')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-view-claims="true">{t.t('partner3.insights.viewClaims')}</Link>
      </p>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner3.insights.error.title')}</h2>
          <p>{t.t('partner3.insights.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/claims/insights?act=confirm">{t.t('partner3.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner3.insights.empty.title')}</h2>
          <p>{t.t('partner3.insights.empty.body')}</p>
        </div>
      ) : counts && (
        <>
          <p data-kv-total={counts.total}>{t.t('partner3.insights.total', { n: counts.total })}</p>
          {table('decided', t.t('partner3.insights.decidedTitle'), decidedRows(counts.decided).map((r) => ({ key: r.id, label: t.t(r.key), n: r.n })))}
          {table('status', t.t('partner3.insights.byStatus'), statusRows(counts.byStatus).map((r) => ({ key: r.status, label: t.t(r.key), n: r.n })))}
          {table('event', t.t('partner3.insights.byEvent'), eventRows(counts.byEvent).map((r) => ({ key: r.code, label: 'key' in r.label ? t.t(r.label.key) : r.label.raw, n: r.n })))}
          <p className="kv-muted">{t.t('partner3.insights.countsOnly')}</p>
        </>
      )}
      {counts && state !== 'error' && <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner3.asOf', { time: asOfText(counts.computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="claims_insights" />
    </section>
  );
}
