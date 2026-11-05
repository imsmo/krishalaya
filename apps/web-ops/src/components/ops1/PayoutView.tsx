// apps/web-ops/src/components/ops1/PayoutView.tsx · PC-56 OPS-1a · W367 THE PAYOUT RUN — A READ (founder 1a-1, Q2-A), presentational.
//
// What `GET /v1/dairy/milk-bills?box=all` answered, one keyset page: each bill's member (the member code, as the memberships read prints it —
// never a name the list does not carry), period, litres, and the SERVER's gross / deductions / net minor strings through the money formatter,
// the state verbatim and the dispute window's end. NO total (the list returns none), NO page count, NO sum, NO percentage, NO approve, NO pay.
// The founder's statement is printed in every state but switched-off. The ONE control is the GET page-size `<select>`. A row → the bill's own
// read (`/payout/[id]`). "Send to tenant payout desk" is DECOR → the W3332–W3334 chain (`?act=confirm`), labelled with what is true; the error
// state's Retry opens the same chain, whose Back re-reads the bills. Every refused canon line is printed BY NAME (`Ops1Refusals`).
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { MilkBill } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops1/refusals';
import { billHref, payoutHref, PAGE_SIZES, PAYOUT_PAGE, type PageSize, type PayoutState } from '../../features/ops1/payout';
import { Ops1Refusals } from './Ops1Chain';

export interface PayoutViewProps {
  t: Tr; lang: string; state: PayoutState; bills: readonly MilkBill[];
  /** membershipId to member code, from the memberships read (absent: the "not on this list" words, never an id). */
  memberCodes: Readonly<Record<string, string>>;
  size: PageSize; nextCursor: string | null;
}

export function PayoutView({ t, lang, state, bills, memberCodes, size, nextCursor }: PayoutViewProps) {
  if (state === 'off') {
    return (
      <section data-kv-ops1="payout" data-kv-state="off">
        <h1>{t.t('ops1.payout.title')}</h1>
        <div className="kv-card" data-kv-off="dairy"><h2 className="kv-card__title">{t.t('ops1.payout.off.title')}</h2><p>{t.t('ops1.payout.off.body')}</p></div>
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  return (
    <section data-kv-ops1="payout" data-kv-state={state}>
      <h1>{t.t('ops1.payout.title')}</h1>
      <p className="kv-muted">{t.t('ops1.payout.lead')}</p>

      <div className="kv-card" data-kv-statement="payout">
        <h2 className="kv-card__title">{t.t('ops1.payout.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="ops1.payout.statement">{t.t('ops1.payout.statement')}</p>
      </div>

      {state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="bills">
          <h2 className="kv-card__title">{t.t('ops1.payout.error.title')}</h2>
          <p>{t.t('ops1.payout.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${PAYOUT_PAGE}?act=confirm`} data-kv-decor="retry">{t.t('ops1.payout.retry')}</Link></p>
        </div>
      ) : state === 'no_cycle' ? (
        <div className="kv-empty-state" data-kv-empty="no_cycle"><h2>{t.t('ops1.payout.noCycle.title')}</h2><p>{t.t('ops1.payout.noCycle.body')}</p></div>
      ) : state === 'empty' ? (
        <div className="kv-empty-state" data-kv-empty="bills"><h2>{t.t('ops1.payout.empty.title')}</h2><p>{t.t('ops1.payout.empty.body')}</p></div>
      ) : (
        <div className="kv-card" data-kv-bills="payout">
          <p className="kv-muted" data-kv-note="server-amounts">{t.t('ops1.payout.serverAmounts')}</p>
          <table className="kv-table">
            <thead><tr>
              <th>{t.t('ops1.payout.colMember')}</th><th>{t.t('ops1.payout.colPeriod')}</th><th>{t.t('ops1.payout.colLitres')}</th>
              <th>{t.t('ops1.payout.colGross')}</th><th>{t.t('ops1.payout.colDeductions')}</th><th>{t.t('ops1.payout.colNet')}</th>
              <th>{t.t('ops1.payout.colStatus')}</th><th>{t.t('ops1.payout.colWindow')}</th>
            </tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} data-kv-bill={b.id}>
                  <td><Link href={billHref(b.id)} className="kv-link" data-kv-drill={b.id}>{memberCodes[b.membershipId] ?? t.t('ops1.payout.memberUnknown')}</Link></td>
                  <td>{formatDate(b.periodStart, lang)} · {formatDate(b.periodEnd, lang)}</td>
                  <td>{b.totalLitres}</td>
                  <td data-kv-amount="gross">{money(b.grossMinor)}</td>
                  <td data-kv-amount="deductions">{money(b.deductionsMinor)}</td>
                  <td data-kv-amount="net"><strong>{money(b.netMinor)}</strong></td>
                  <td><span className="kv-badge" data-kv-status={b.status}>{t.t(`ops1.payout.status.${b.status}`)}</span></td>
                  <td>{b.disputeWindowEnds ? formatDate(b.disputeWindowEnds, lang) : t.t('ops1.payout.noWindow')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && <p className="kv-pager"><Link href={payoutHref(size, nextCursor)} className="kv-btn--link" data-kv-next="bills">{t.t('ops1.payout.next')}</Link></p>}
        </div>
      )}

      <form method="get" action={PAYOUT_PAGE} className="kv-inline-form" data-kv-page-size="payout">
        <label htmlFor="po-size" className="kv-field__label">{t.t('ops1.payout.pageSize')}</label>
        <select id="po-size" name="size" className="kv-input" defaultValue={String(size)}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops1.payout.show')}</button>
      </form>

      <p className="kv-pager" data-kv-acts="payout">
        <Link className="kv-btn kv-btn--muted" href={`${PAYOUT_PAGE}?act=confirm`} data-kv-decor="send">{t.t('ops1.payout.sendAct')}</Link>
      </p>
      <Ops1Refusals t={t} surface="payout" />
    </section>
  );
}
