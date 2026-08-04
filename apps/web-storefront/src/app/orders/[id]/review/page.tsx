// apps/web-storefront/src/app/orders/[id]/review/page.tsx · write a verified-purchase review for a completed
// order. PROTECTED + dynamic. We read the order (notFound on missing/foreign id — RLS, no IDOR) and only show the
// form once the order is COMPLETE (the server also enforces eligibility); otherwise we explain when reviewing
// becomes available. The form is no-JS: an accessible star radio-group (1–5) + an optional comment, posting to a
// Server Action. The one-review-per-order rule is stated up front. noindex.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { orderTimeline, ORDER_STEPS } from '../../../../features/orders/timeline';
import { submitReviewAction } from './actions';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('review.title'), robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
  await requireSession(`/orders/${encodeURIComponent(params.id)}/review`);
  const t = getTranslator();

  let order: OrderDetail | null = null;
  try { order = await serverClient().orders.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }
  if (!order) {
    return <section className="kv-review"><h1>{t.t('review.title')}</h1>
      <p className="kv-form__error" role="alert">{t.t('order.loadError')}</p></section>;
  }

  const tl = orderTimeline(order.status);
  const isComplete = tl.currentIndex === ORDER_STEPS.length - 1;
  const backToOrder = <Link href={`/orders/${encodeURIComponent(order.id)}`} className="kv-btn--link">{t.t('order.backToList')}</Link>;

  if (!isComplete) {
    return (
      <section className="kv-review">
        <h1>{t.t('review.title')}</h1>
        <p className="kv-detail__muted">{t.t('review.notYet')}</p>
        {backToOrder}
      </section>
    );
  }

  return (
    <section className="kv-review">
      <h1>{t.t('review.title')}</h1>
      <p className="kv-checkout__orderno">{t.t('order.orderNo', { no: order.orderNo })}</p>
      <p className="kv-detail__muted">{t.t('review.rule')}</p>
      {searchParams.status === 'err' && <p className="kv-form__error" role="alert">{t.t('review.error')}</p>}

      <form action={submitReviewAction} className="kv-form">
        <input type="hidden" name="orderId" value={order.id} />

        <fieldset className="kv-stars">
          <legend className="kv-field__label">{t.t('review.ratingLabel')}</legend>
          {/* radios in reverse so the CSS sibling-fill highlights up to the checked star; semantics stay 1–5 */}
          <div className="kv-stars__row">
            {[5, 4, 3, 2, 1].map((n) => (
              <label key={n} className="kv-stars__star">
                <input type="radio" name="stars" value={n} required />
                <span aria-hidden="true">★</span>
                <span className="kv-visually-hidden">{t.t('review.starsN', { n: String(n) })}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="kv-field">
          <label htmlFor="review-body" className="kv-field__label">{t.t('review.commentLabel')}</label>
          <textarea id="review-body" name="body" rows={4} maxLength={2000} className="kv-field__input" placeholder={t.t('review.commentPlaceholder')} />
        </div>

        <div className="kv-cart__actions">
          <button type="submit" className="kv-btn">{t.t('review.submit')}</button>
          {backToOrder}
        </div>
      </form>
    </section>
  );
}
