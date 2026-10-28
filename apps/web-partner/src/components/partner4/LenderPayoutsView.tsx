// apps/web-partner/src/components/partner4/LenderPayoutsView.tsx · PC-56 PARTNER-4b · W210 (canon `lender/disbursements`) — THE COOLING-OFF
// PIPELINE AS COUNTS (founder 4b-4 / 4b-6 / 4b-7), presentational.
//
// What `GET /v1/partner/loans/pipeline` answered, and nothing else: four COUNTS over this lender's own consented
// applications — every approved one, the ones whose cooling-off instant has passed, the ones still inside it, and the
// ones disbursed inside the window — with the window label and the server's as-of.
// **THERE IS NO TABLE ON THIS PAGE, DELIBERATELY.** The canon's two row columns are the borrower and her bank account:
// one is the wall, and the other is a table this console holds no privilege on at all (0232 asserts nine of them). A
// count is what a lender may be shown here; a list of families with their banks is not.
// What is KEPT because it is TRUE: the cooling-off window is held by the server — it ends at the instant recorded when
// the approval was made, and never a moment earlier in a lender's favour (`coolingOffOpen` never rounds, and the
// comparison is made by the database, not by a browser). The canon's own reassurance said this of a "clock"; the word
// belongs to the SLA clock this console refuses by name, so the sentence says what the platform actually does.
// The one act the canon puts here is DECOR, refused by name through the W2863–W2865 chain; "View queue" and the batch
// page are real links — the second is the inbound edge W210 → W218 the canon never drew (survey F-22).
import Link from 'next/link';
import type { PartnerBookPipeline } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import { batchHref, pipelineRows, windowLabel, type LenderCountsState } from '../../features/partner4/figures';

export function LenderPayoutsView({ t, lang, state, pipeline }: {
  t: Tr; lang: string; state: LenderCountsState; pipeline: PartnerBookPipeline | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="payouts" />;
  const win = windowLabel(pipeline);
  return (
    <section data-kv-lender="payouts" data-kv-state={state}>
      <h1>{t.t('partner4.payouts.title')}</h1>
      <p className="kv-muted">{t.t('partner4.payouts.lead')}</p>
      <LendingSubNav t={t} current="/lender/disbursements" />

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.payouts.error.title')}</h2>
          <p>{t.t('partner4.payouts.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/disbursements?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <div className="kv-card kv-counts" data-kv-counts="pipeline">
            <h2 className="kv-card__title">{win ? t.t(win.key, win.vars) : t.t('partner4.payouts.countsTitle')}</h2>
            <dl className="kv-counts__list">
              {pipelineRows(pipeline).map((r) => (
                <div key={r.id} className="kv-counts__item" data-kv-count={r.id}>
                  <dt>{t.t(r.key)}</dt>
                  <dd>{r.n}</dd>
                </div>
              ))}
            </dl>
            <p className="kv-muted" data-kv-window-note="true">{t.t('partner4.payouts.windowNote')}</p>
            <p className="kv-muted" data-kv-counts-only="true">{t.t('partner4.portfolio.countsOnly')}</p>
            {pipeline && <p className="kv-muted" data-kv-asof={pipeline.computedAt}>{t.t('partner4.asOf', { time: asOfText(pipeline.computedAt, lang) })}</p>}
          </div>

          <div className="kv-card" data-kv-kept="coolingOff">
            <h2 className="kv-card__title">{t.t('partner4.payouts.coolingOffTitle')}</h2>
            <p>{t.t('partner4.payouts.coolingOffServerSide')}</p>
          </div>

          {state === 'empty' && (
            <div className="kv-card kv-empty-state">
              <h2 className="kv-card__title">{t.t('partner4.payouts.empty.title')}</h2>
              <p>{t.t('partner4.payouts.empty.body')}</p>
            </div>
          )}

          <p className="kv-pager" data-kv-acts="payouts">
            <Link className="kv-btn kv-btn--muted" href="/lender/disbursements?act=confirm" data-kv-decor="pay">{t.t('partner4.payouts.payAct')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href={batchHref()} data-kv-real="batch">{t.t('partner4.payouts.batchLink')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/lender/queue?status=approved" data-kv-real="queue">{t.t('partner4.payouts.viewQueue')}</Link>
          </p>
        </>
      )}
      <LenderRefusals t={t} surface="disbursements" />
    </section>
  );
}
