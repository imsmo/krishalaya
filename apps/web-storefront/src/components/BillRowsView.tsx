// apps/web-storefront/src/components/BillRowsView.tsx · PC-56 HOTFIX-4 · C3/C4 (survey F-5, founder D4) — the bill a buyer reads, row by row,
// from features/checkout/bill-rows.ts: every figure the API's, every amount in the DATA's currency through features/discovery/money.ts
// (an unknown currency prints "Not available", never a rupee guess). Server component, no client JS. Used on the checkout review, the
// confirmation page and the order detail, so the three agree.
import type { Bill } from '../features/checkout/bill-rows';
import { moneyText } from '../features/discovery/money';
import { getTranslator, getLang } from '../lib/i18n';

export function BillRowsView({ bill }: { bill: Bill }) {
  const t = getTranslator();
  const lang = getLang();
  const money = (minor: string) => moneyText(minor, bill.currencyCode, lang) ?? t.t('money.unavailable');
  return (
    <div className="kv-confirm__totals" data-kv-bill={bill.sums ? 'sums' : 'mismatch'}>
      {bill.rows.map((r) => (
        <p key={r.key} className="kv-confirm__row" data-kv-row={r.key}>
          <span>{t.t(r.labelKey)}</span>{' '}
          {r.pending ? <span className="kv-detail__muted">{t.t('bill.deliveryPending')}</span>
            : <span>{r.sign < 0 ? <span aria-hidden="true">−</span> : null}{money(r.minor)}</span>}
        </p>
      ))}
      <p className="kv-confirm__row kv-confirm__row--total" data-kv-row="total">
        <span>{t.t('bill.total')}</span> <strong>{money(bill.totalMinor)}</strong>
      </p>
      <p className="kv-cart__note">{t.t('bill.taxIncluded')}</p>
    </div>
  );
}
