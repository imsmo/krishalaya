// apps/web-tenant/src/app/offers/[id]/page.tsx · seller offer detail + negotiation. Server-first: requireSession
// gates it, offers.get(id) returns the offer (tenant-scoped + seller-authorized server-side; a missing/foreign id
// → notFound() = the IDOR guard). Surfaces accept / counter / reject ONLY while the negotiation is live
// (features/offers/negotiation.ts, unit-tested); accept creates the order server-side → we link to it. Money via
// formatMoneyMinor; counter price entered in major units + parsed float-free. All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { isNegotiable, effectivePriceMinor } from '../../../features/offers/negotiation';
import { minorToMajor } from '../../../features/listings/form';
import { acceptOfferAction, counterOfferAction, rejectOfferAction } from './actions';
import type { ListingOffer } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offerDetail.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['accept', 'counter', 'reject', 'price', 'illegal']);
const OK = new Set(['accepted', 'countered', 'rejected']);

export default async function OfferDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/offers/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let offer: ListingOffer;
  try { offer = await tenantClient().offers.get(params.id); }
  catch { notFound(); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const live = isNegotiable(offer.status);

  const facts: Array<[string, string]> = [
    [t.t('offerDetail.status'), offer.status],
    [t.t('offerDetail.quantity'), offer.quantity],
    [t.t('offerDetail.offered'), formatMoneyMinor(offer.offeredPriceMinor, 'INR', lang)],
    [t.t('offerDetail.counter'), offer.counterPriceMinor ? formatMoneyMinor(offer.counterPriceMinor, 'INR', lang) : t.t('common.dash')],
    [t.t('offerDetail.round'), String(offer.round)],
    [t.t('offerDetail.expires'), offer.expiresAt ? formatDate(offer.expiresAt, lang) : t.t('common.dash')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('offerDetail.heading')}</h1>
        <Link href={`/offers?listingId=${encodeURIComponent(offer.listingId)}`} className="kv-btn--link">← {t.t('offers.inboxTitle')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t(`offerDetail.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`offerDetail.error.${errorKey}`)}</p>}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {offer.convertedOrderId && (
        <p><Link href={`/orders/${encodeURIComponent(offer.convertedOrderId)}`} className="kv-btn">{t.t('offerDetail.viewOrder')}</Link></p>
      )}

      {live ? (
        <div className="kv-offer-actions">
          <h2 className="kv-section-title">{t.t('offerDetail.respond')}</h2>
          <div className="kv-actions">
            <form action={acceptOfferAction} className="kv-inline-form">
              <input type="hidden" name="id" value={offer.offerId} />
              <button type="submit" className="kv-btn">{t.t('offerDetail.accept')}</button>
            </form>
            <form action={rejectOfferAction} className="kv-inline-form">
              <input type="hidden" name="id" value={offer.offerId} />
              <button type="submit" className="kv-btn kv-btn--muted">{t.t('offerDetail.reject')}</button>
            </form>
          </div>
          <form action={counterOfferAction} className="kv-form kv-card">
            <h3 className="kv-card__title">{t.t('offerDetail.counterTitle')}</h3>
            <input type="hidden" name="id" value={offer.offerId} />
            <label htmlFor="priceMajor" className="kv-field__label">{t.t('offerDetail.counterPrice')}</label>
            <input id="priceMajor" name="priceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?"
              className="kv-input" required defaultValue={minorToMajor(effectivePriceMinor(offer))} />
            <p className="kv-field__hint">{t.t('offerDetail.counterHint')}</p>
            <button type="submit" className="kv-btn">{t.t('offerDetail.sendCounter')}</button>
          </form>
        </div>
      ) : (
        <p className="kv-muted">{t.t('offerDetail.closed')}</p>
      )}
    </section>
  );
}
