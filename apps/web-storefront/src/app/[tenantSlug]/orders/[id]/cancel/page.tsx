// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/cancel/page.tsx · PC-56 STORE-3a · C3 — canon W291 "Cancellations & Refunds" and the
// cancel chain W3083 (confirm) / W3085 (failure), under the ORGANISATION's chrome. PROTECTED + dynamic. A stranger's id → notFound().
//   • THE RULES AS THE CODE HAS THEM (founder D1): free, with a full refund to the source, through `ready`; closed once the order is picked up;
//     a PAID order is refunded to its source automatically; an unpaid one has nothing to refund. The canon's fee ladder, "3–5 bank days", "we
//     chase", "refuse at the gate" and "the organisation is notified with your reason" are refused BY NAME (features/store3a/refusals.ts);
//   • THE CONFIRM (W3083): the order (number, primary item, organisation), what comes back (the payment read's captured amount "back to your
//     source", or "nothing was paid — nothing to refund"), THE AUCTION WARNING (unpaid: your deposit is forfeited to the organisation; paid:
//     your deposit and your payment are returned — HOTFIX-5 D4), the reason radios from the store's `cancel_reason` vocabulary (labels from
//     this storefront's catalogue by code; an unknown code prints the vocabulary's own name), the note (required for a reason that says so,
//     ≤ 280), the Idempotency-Key minted HERE (kept across a refused submit — Retry is the same request), the pending lock, "Keep order";
//   • FAILURE (W3085) by name — it has moved forward (+ the dispute door), not a party, the reason / note refusals (values kept), a concurrency
//     refusal (Retry with the same key), anything else ("nothing changed — nothing was refunded or lost"); SUCCESS (W3084) is the order page;
//   • NOT CANCELLABLE (picked up or later): said, with the way to raise a problem.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { formatNumber } from '@krishalaya/i18n';
import type { OrderDetail, OrderPaymentAttempts, LookupValue } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { moneyText } from '../../../../../features/discovery/money';
import { reloadHref } from '../../../../../features/home/load-result';
import { orderStatusKey } from '../../../../../features/store3a/order-status';
import {
  cancelHref, orderHref, ordersHref, canCancel, reasonOptions, cancelReasonKey, whatComesBack, auctionCancelWarning, readCancelOutcome, actKey, CANCEL_NOTE_MAX,
} from '../../../../../features/store3a/orders';
import { CANCEL_DRAFT_COOKIE, decodeCancelDraft } from '../../../../../features/store3a/cancel-draft';
import { RefusalList } from '../../../../../components/RefusalList';
import { SubmitButton } from '../../../../../components/SubmitButton';
import { cancelOrderAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('store3a.cancel.title'), robots: { index: false, follow: false } };
}

export default async function TenantCancelPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  await requireSession(cancelHref(slug, params.id));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(slug);

  let order: OrderDetail | null = null;
  try { order = await api.orders.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }
  if (!order) {
    return (
      <section className="kv-cancel" data-kv-store={slug}>
        <h1>{t.t('store3a.cancel.title')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3a.detail.error')}</p>
          <a href={reloadHref(cancelHref(slug, params.id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          <Link href={ordersHref(slug)} className="kv-btn--link">{t.t('order.backToList')}</Link>
        </div>
      </section>
    );
  }

  const first = order.items[0];
  const what = (
    <p className="kv-detail__muted" data-kv-the-order={order.id}>
      <code className="kv-mono">{order.orderNo}</code>
      {first && <> · {t.t('store3a.row.item', { title: first.title_snapshot, qty: formatNumber(Number(first.quantity), lang), unit: first.unit_code })}</>}
      {order.organisation && <> · {t.t('checkout.soldBy', { org: order.organisation.name })}</>}
    </p>
  );
  const rules = (
    <section className="kv-order__section" aria-labelledby="rules-h" data-kv-rules="code">
      <h2 id="rules-h">{t.t('store3a.cancel.rulesTitle')}</h2>
      <ul>
        <li>{t.t('store3a.cancel.rule.free')}</li>
        <li>{t.t('store3a.cancel.rule.closed')}</li>
        <li>{t.t('store3a.cancel.rule.paid')}</li>
        <li>{t.t('store3a.cancel.rule.unpaid')}</li>
        <li>{t.t('store3a.cancel.rule.recorded')}</li>
      </ul>
    </section>
  );

  if (!canCancel(order.status)) {
    return (
      <section className="kv-cancel" data-kv-store={slug} data-kv-state="not-cancellable">
        <h1>{t.t('store3a.cancel.title')}</h1>
        {what}
        <div className="kv-state" role="status">
          <p><strong>{t.t('store3a.cancel.closed', { status: t.t(orderStatusKey(order.status)) })}</strong></p>
          <p><Link href={`${orderHref(slug, order.id)}#problem`} className="kv-link" data-kv-dispute-door="problem">{t.t('store3a.cancel.raiseProblem')}</Link></p>
        </div>
        {rules}
        <p><Link href={orderHref(slug, order.id)} className="kv-btn--link">{t.t('store3a.cancel.backToOrder')}</Link></p>
        <RefusalList surface="cancel" />
      </section>
    );
  }

  let attempts: OrderPaymentAttempts | null = null;
  if (order.paymentState === 'paid') { try { attempts = await api.payments.orderAttempts(order.id); } catch { attempts = null; } }
  let values: LookupValue[] | null = null;
  try { values = await api.lookups.values('cancel_reason'); } catch { values = null; }
  const options = reasonOptions(values);
  const back = whatComesBack(order, attempts);
  const warning = auctionCancelWarning(order);
  const failure = readCancelOutcome(searchParams.error);
  const keptReason = one(searchParams.r) ?? '';
  const keptNote = failure ? decodeCancelDraft(cookies().get(CANCEL_DRAFT_COOKIE)?.value, order.id) ?? '' : '';
  const k = one(searchParams.k);
  const key = k && KEY.test(k) ? k : actKey('cancel', order.id, randomUUID());
  const label = (o: { code: string; name: string }) => { const kk = cancelReasonKey(o.code); const v = t.t(kk); return v === kk ? o.name : v; };

  return (
    <section className="kv-cancel" data-kv-store={slug} data-kv-order={order.id} data-kv-payment-state={order.paymentState}>
      <h1>{t.t('store3a.cancel.title')}</h1>
      {rules}

      <section className="kv-order__section" aria-labelledby="confirm-h" data-kv-confirm="cancel">
        <h2 id="confirm-h">{t.t('store3a.cancel.confirmTitle', { no: order.orderNo })}</h2>
        {what}
        {failure && (
          <div className="kv-form__error" role="alert" data-kv-failure={failure}>
            <p>{t.t(`store3a.cancel.err.${failure}`)}</p>
            {failure === 'moved' && <p><Link href={`${orderHref(slug, order.id)}#problem`} className="kv-link" data-kv-dispute-door="problem">{t.t('store3a.cancel.raiseProblem')}</Link></p>}
          </div>
        )}
        <p data-kv-back={back.kind}>
          {back.kind === 'back_to_source'
            ? t.t('store3a.cancel.back.source', { amount: moneyText(back.amountMinor, back.currencyCode ?? order.currencyCode, lang) ?? t.t('money.unavailable') })
            : t.t(`store3a.cancel.back.${back.kind === 'nothing_paid' ? 'nothing' : 'sourceNoAmount'}`)}
        </p>
        {warning && <p className="kv-form__error" role="note" data-kv-auction-warning={warning}>{t.t(`store3a.cancel.auction.${warning}`)}</p>}

        {options.length === 0 ? (
          <div className="kv-state kv-state--error" role="alert" data-kv-state="reasons-unavailable">
            <p>{t.t('store3a.cancel.reasonsUnavailable')}</p>
            <a href={reloadHref(cancelHref(slug, order.id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        ) : (
          <form action={cancelOrderAction} data-kv-act-class="money" data-kv-needs-signal-reason="cancelRefund" className="kv-form" data-kv-form="cancel">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="key" value={key} />
            <fieldset className="kv-form__fieldset">
              <legend className="kv-form__label">{t.t('store3a.cancel.reason')}</legend>
              {options.map((o) => (
                <label key={o.id} className="kv-radio" data-kv-reason={o.code}>
                  <input type="radio" name="reasonId" value={o.id} required defaultChecked={o.id === keptReason} /> {label(o)}
                  {o.textRequired && <span className="kv-detail__muted"> {t.t('store3a.cancel.noteNeeded')}</span>}
                </label>
              ))}
            </fieldset>
            <label htmlFor="c-note" className="kv-form__label">{t.t('store3a.cancel.note')}</label>
            <textarea id="c-note" name="note" className="kv-field__input" rows={3} maxLength={CANCEL_NOTE_MAX} defaultValue={keptNote} data-kv-note="other" />
            <p className="kv-detail__muted">{t.t('store3a.cancel.noteHint', { max: formatNumber(CANCEL_NOTE_MAX, lang) })}</p>
            <SubmitButton idle={t.t('store3a.cancel.submit')} busy={t.t('store3a.cancel.busy')} className="kv-btn kv-btn--money" />{' '}
            <Link href={orderHref(slug, order.id)} className="kv-btn--link" data-kv-keep="order">{t.t('store3a.cancel.keep')}</Link>
          </form>
        )}
      </section>
      <RefusalList surface="cancel" />
    </section>
  );
}
