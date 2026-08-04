// apps/web-storefront/src/app/offers/[id]/page.tsx · one offer's negotiation detail. PROTECTED + dynamic;
// notFound() on a missing/foreign id (RLS, no IDOR). Shows the offered + countered price, quantity, round, and
// status. While the offer is still open the buyer can accept (the seller's current price), counter back, or
// reject — all Server Actions (the server enforces which are legal). Once converted, we link to the created order.
// A "message seller" action opens a masked chat. Money via formatMoneyMinor (Law 2).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { ListingOffer } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { acceptOfferAction, counterOfferAction, rejectOfferAction, messageSellerAction } from './actions';

const TERMINAL = new Set(['accepted', 'rejected', 'expired', 'withdrawn', 'cancelled', 'converted', 'declined']);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('offers.detailTitle'), robots: { index: false, follow: false } };
}

export default async function OfferDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
  await requireSession(`/offers/${encodeURIComponent(params.id)}`);
  const t = getTranslator();
  const lang = getLang();

  let offer: ListingOffer | null = null;
  try { offer = await serverClient().offers.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); offer = null; }
  if (!offer) {
    return <section className="kv-offer"><h1>{t.t('offers.detailTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('offers.loadError')}</p></section>;
  }

  const statusLabel = (s: string) => { const k = `offers.status.${s.toLowerCase()}`; const l = t.t(k); return l === k ? s : l; };
  const isOpen = !TERMINAL.has(offer.status.toLowerCase()) && !offer.convertedOrderId;
  const current = offer.counterPriceMinor ?? offer.offeredPriceMinor;
  const notice =
    searchParams.status === 'err' ? { kind: 'err', msg: t.t('offers.actionError') } :
    searchParams.status === 'countered' ? { kind: 'ok', msg: t.t('offers.counterSent') } :
    searchParams.status === 'rejected' ? { kind: 'ok', msg: t.t('offers.rejected') } : null;

  return (
    <section className="kv-offer">
      <h1>{t.t('offers.detailTitle')}</h1>
      {notice && <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">{notice.msg}</p>}

      <dl className="kv-offer__facts">
        <div><dt>{t.t('offers.offered')}</dt><dd>{formatMoneyMinor(offer.offeredPriceMinor, 'INR', lang)}</dd></div>
        {offer.counterPriceMinor && <div><dt>{t.t('offers.counter')}</dt><dd>{formatMoneyMinor(offer.counterPriceMinor, 'INR', lang)}</dd></div>}
        <div><dt>{t.t('offers.quantity')}</dt><dd>{offer.quantity}</dd></div>
        <div><dt>{t.t('offers.round')}</dt><dd>{offer.round}</dd></div>
        <div><dt>{t.t('offers.status')}</dt><dd>{statusLabel(offer.status)}</dd></div>
      </dl>

      {offer.convertedOrderId && (
        <p className="kv-form__notice" role="status">
          {t.t('offers.converted')} <Link href={`/orders/${encodeURIComponent(offer.convertedOrderId)}`} className="kv-link">{t.t('offers.viewOrder')}</Link>
        </p>
      )}

      {isOpen && (
        <div className="kv-offer__actions">
          <form action={acceptOfferAction}>
            <input type="hidden" name="offerId" value={offer.offerId} />
            <button type="submit" className="kv-btn">{t.t('offers.accept', { price: formatMoneyMinor(current, 'INR', lang) })}</button>
          </form>

          <form action={counterOfferAction} className="kv-offer__counter">
            <input type="hidden" name="offerId" value={offer.offerId} />
            <label htmlFor="counter-price" className="kv-field__label">{t.t('offers.counterPriceLabel')}</label>
            <input id="counter-price" name="counterPrice" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" required />
            <button type="submit" className="kv-btn kv-btn--ghost">{t.t('offers.counterCta')}</button>
          </form>

          <form action={rejectOfferAction}>
            <input type="hidden" name="offerId" value={offer.offerId} />
            <button type="submit" className="kv-btn--link kv-cart__remove">{t.t('offers.reject')}</button>
          </form>
        </div>
      )}

      <form action={messageSellerAction} className="kv-offer__msg">
        <input type="hidden" name="offerId" value={offer.offerId} />
        <input type="hidden" name="listingId" value={offer.listingId} />
        <button type="submit" className="kv-btn--link">{t.t('offers.messageSeller')}</button>
      </form>

      <p><Link href="/offers" className="kv-btn--link">{t.t('offers.back')}</Link></p>
    </section>
  );
}
