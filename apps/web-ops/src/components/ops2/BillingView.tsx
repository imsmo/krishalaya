// apps/web-ops/src/components/ops2/BillingView.tsx · PC-56 OPS-2c · W378 STORAGE BILLING — A READ OF THE RATE ON FILE, presentational.
//
// What `GET /v1/warehousing/warehouses?box=mine` answered: the warehouses the signed-in person OPERATES, each with its own name (Q14-A), its WDRA
// number "as entered, not checked with WDRA" (Q14-A) and its storage rate ON FILE — the server's minor string through the money formatter, labelled
// "on file now; the rate at release is used, not the rate when the goods arrived" (Q2-A). Above them, in every state but switched-off, the founder's
// two sentences: WHO would receive the fee today (Q1-A — the operator's own wallet; release paused) and HOW it is worked out (Q2-A — in words, never
// a sum). NO quantity, NO depositor (Q9-A), NO bill, NO total, NO "×" or "=", NO percentage, NO input (E3, E7). "Export month-to-date" and "Retry
// run" are DECOR → the W3350–W3354 chains (`?export=queued`, `?act=confirm`), labelled with what is true (Q10-A). Every refused canon line is
// printed BY NAME (`Ops2Refusals`).
import Link from 'next/link';
// PC-56 RTL-1e: the console's money text (features/rtl/money.ts `moneyText`) — the Indian shape, isolated, under Arabic; byte-identical under
// en/hi/gu. Bound to the name `formatMoneyMinor` here so this view's call reads as before (its pinned OPS spec).
import { moneyText as formatMoneyMinor } from '../../features/rtl/money';
import { ltrText } from '../../features/rtl/span';   // PC-56 RTL-1e: a code inside a sentence, isolated under Arabic only
import type { Warehouse } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops2/refusals';
import { BILLING_PAGE, billingHref, isMinorString, type BillingState } from '../../features/ops2/billing';
import { Ops2Refusals } from './Ops2Chain';

export interface BillingViewProps { t: Tr; lang: string; state: BillingState; warehouses: readonly Warehouse[]; nextCursor: string | null }

export function BillingStatement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="billing">
      <h2 className="kv-card__title">{t.t('ops2.billing.statementTitle')}</h2>
      <p className="kv-statement" data-kv-statement="ops2.billing.payee">{t.t('ops2.billing.payee')}</p>
      <p className="kv-statement" data-kv-statement="ops2.billing.rule">{t.t('ops2.billing.rule')}</p>
    </div>
  );
}

export function BillingView({ t, lang, state, warehouses, nextCursor }: BillingViewProps) {
  if (state === 'off') {
    return (
      <section data-kv-ops2="billing" data-kv-state="off">
        <h1>{t.t('ops2.billing.title')}</h1>
        <div className="kv-card" data-kv-off="warehousing"><h2 className="kv-card__title">{t.t('ops2.billing.off.title')}</h2><p>{t.t('ops2.billing.off.body')}</p></div>
        <Ops2Refusals t={t} surface="billing" />
      </section>
    );
  }
  return (
    <section data-kv-ops2="billing" data-kv-state={state}>
      <h1>{t.t('ops2.billing.title')}</h1>
      <p className="kv-muted">{t.t('ops2.billing.lead')}</p>
      <BillingStatement t={t} />

      {state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="rates">
          <h2 className="kv-card__title">{t.t('ops2.billing.error.title')}</h2>
          <p>{t.t('ops2.billing.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={BILLING_PAGE} data-kv-real="reread">{t.t('ops2.billing.error.reread')}</Link></p>
        </div>
      ) : state === 'none' ? (
        <div className="kv-empty-state" data-kv-empty="warehouses"><h2>{t.t('ops2.billing.none.title')}</h2><p>{t.t('ops2.billing.none.body')}</p></div>
      ) : (
        <div className="kv-card" data-kv-rates="billing">
          <h2 className="kv-card__title">{t.t('ops2.billing.ratesTitle')}</h2>
          <p className="kv-muted" data-kv-note="server-values">{t.t('ops2.billing.serverValues')}</p>
          <table className="kv-table">
            <thead><tr><th>{t.t('ops2.billing.colWarehouse')}</th><th>{t.t('ops2.billing.colWdra')}</th><th>{t.t('ops2.billing.colRate')}</th></tr></thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.id} data-kv-warehouse={w.id}>
                  <td data-kv-cell="name">{w.defaultName}</td>
                  <td data-kv-cell="wdra">{w.wdraRegNo ? t.t('ops2.billing.wdraAsEntered', { wdra: ltrText(w.wdraRegNo, lang) }) : t.t('ops2.billing.noWdra')}</td>
                  <td data-kv-cell="rate">
                    {isMinorString(w.ratePerQtlMonthMinor)
                      ? <><span data-kv-rate={w.ratePerQtlMonthMinor}>{formatMoneyMinor(w.ratePerQtlMonthMinor, 'INR', lang)}</span> <span className="kv-muted" data-kv-rate-label="on-file">{t.t('ops2.billing.rateLabel')}</span></>
                      : <span data-kv-rate="none">{t.t('ops2.billing.noRate')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor ? <p className="kv-pager"><Link className="kv-btn" href={billingHref(nextCursor)} data-kv-real="next">{t.t('ops2.billing.next')}</Link></p> : null}
        </div>
      )}

      <p className="kv-pager" data-kv-acts="billing">
        <Link className="kv-btn kv-btn--muted" href={`${BILLING_PAGE}?export=queued`} data-kv-decor="export">{t.t('ops2.billing.exportAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${BILLING_PAGE}?act=confirm`} data-kv-decor="run">{t.t('ops2.billing.runAct')}</Link>
      </p>
      <Ops2Refusals t={t} surface="billing" />
    </section>
  );
}
