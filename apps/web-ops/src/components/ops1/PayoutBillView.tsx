// apps/web-ops/src/components/ops1/PayoutBillView.tsx · PC-56 OPS-1a · the W367 drill-in (FM:18) — ONE bill's own read
// (`GET /v1/dairy/milk-bills/:id`), presentational. The server's gross / deductions / net and the deduction lines as returned (only when the
// server loaded them — "not returned" is said, never `[]` standing in); the state verbatim. No form, no approve, no pay, no sum.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import { moneyText } from '../../features/rtl/money';   // PC-56 RTL-1e: the Indian shape, isolated, under Arabic
import type { MilkBill } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops1/refusals';
import { PAYOUT_PAGE } from '../../features/ops1/payout';

export function PayoutBillView({ t, lang, bill, memberCode, state }: { t: Tr; lang: string; bill: MilkBill | null; memberCode: string | null; state: 'ok' | 'not_found' | 'off' }) {
  const money = (m: string) => moneyText(m, 'INR', lang);
  return (
    <section data-kv-ops1="payout_bill" data-kv-state={state}>
      <h1>{t.t('ops1.payout.billTitle')}</h1>
      <p className="kv-statement" data-kv-statement="ops1.payout.statement">{t.t('ops1.payout.statement')}</p>
      {state === 'off' ? (
        <div className="kv-card" data-kv-off="dairy"><p>{t.t('ops1.payout.off.body')}</p></div>
      ) : state === 'not_found' || !bill ? (
        <div className="kv-card" role="alert" data-kv-error="bill"><p>{t.t('ops1.payout.billNotFound')}</p></div>
      ) : (
        <div className="kv-card" data-kv-bill={bill.id}>
          <p className="kv-muted">{t.t('ops1.payout.billLead')}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colMember')}</dt><dd>{memberCode ?? t.t('ops1.payout.memberUnknown')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colPeriod')}</dt><dd>{formatDate(bill.periodStart, lang)} · {formatDate(bill.periodEnd, lang)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colLitres')}</dt><dd>{bill.totalLitres}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colGross')}</dt><dd data-kv-amount="gross">{money(bill.grossMinor)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colDeductions')}</dt><dd data-kv-amount="deductions">{money(bill.deductionsMinor)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colNet')}</dt><dd data-kv-amount="net"><strong>{money(bill.netMinor)}</strong></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colStatus')}</dt><dd><span className="kv-badge" data-kv-status={bill.status}>{t.t(`ops1.payout.status.${bill.status}`)}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops1.payout.colWindow')}</dt><dd>{bill.disputeWindowEnds ? formatDate(bill.disputeWindowEnds, lang) : t.t('ops1.payout.noWindow')}</dd></div>
          </dl>
          <h2 className="kv-card__title">{t.t('ops1.payout.deductionLines')}</h2>
          {bill.deductions && bill.deductions.length > 0 ? (
            <ul data-kv-lines="deductions">{bill.deductions.map((d) => <li key={d.id} data-kv-line={d.id}>{d.type} · {money(d.amountMinor)}</li>)}</ul>
          ) : <p className="kv-muted" data-kv-lines="none">{t.t('ops1.payout.noLines')}</p>}
        </div>
      )}
      <p className="kv-pager"><Link className="kv-btn--link" href={PAYOUT_PAGE} data-kv-back={PAYOUT_PAGE}>{t.t('ops1.payout.back')}</Link></p>
    </section>
  );
}
