// apps/web-storefront/src/components/BuyerActions.tsx · the buyer CTAs on a listing, chosen by sale type. Server
// component (the forms post to Server Actions — no client JS needed). PURCHASABLE listings (direct/both/preorder/
// group_lot) get an Add-to-cart form; OFFER-capable listings (direct/both) also get a Make-an-offer form. Auctions
// and services show a localized note (their buyer flows — live bidding / service contact — land in WAVE 4; and the
// listing read-model exposes no auctionId to deep-link a bid from here, so we don't fake a bid button). Both forms
// carry the tenant slug + listing id + available qty as hidden fields so the action can validate server-side.
import type { ListingCard } from '@krishalaya/sdk-js';
import { getTranslator } from '../lib/i18n';
import { addToCartAction, makeOfferAction } from '../app/[tenantSlug]/listings/[id]/actions';

const PURCHASABLE = new Set(['direct', 'both', 'preorder', 'group_lot']);
const OFFERABLE = new Set(['direct', 'both']);

export function BuyerActions({ listing, tenantSlug }: { listing: ListingCard; tenantSlug: string }) {
  const t = getTranslator();
  const soldOut = listing.quantityAvailable <= 0;
  const purchasable = PURCHASABLE.has(listing.saleType) && !soldOut;
  const offerable = OFFERABLE.has(listing.saleType) && !soldOut;
  const maxQty = Math.max(1, listing.quantityAvailable);

  return (
    <div className="kv-actions">
      {soldOut && <p className="kv-actions__note" role="status">{t.t('listing.soldOut')}</p>}

      {purchasable && (
        <form action={addToCartAction} className="kv-actions__form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="available" value={String(listing.quantityAvailable)} />
          <label htmlFor="qty-cart" className="kv-field__label">{t.t('listing.qtyLabel')}</label>
          <input id="qty-cart" name="quantity" type="number" inputMode="numeric" min={1} max={maxQty} defaultValue={1} step={1} className="kv-field__input kv-actions__qty" />
          <button type="submit" className="kv-btn">{t.t('listing.addToCart')}</button>
        </form>
      )}

      {offerable && (
        <form action={makeOfferAction} className="kv-actions__form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="available" value={String(listing.quantityAvailable)} />
          <label htmlFor="qty-offer" className="kv-field__label">{t.t('listing.qtyLabel')}</label>
          <input id="qty-offer" name="quantity" type="number" inputMode="numeric" min={1} max={maxQty} defaultValue={1} step={1} className="kv-field__input kv-actions__qty" />
          <label htmlFor="offer-price" className="kv-field__label">{t.t('listing.offerPriceLabel', { unit: listing.unitCode })}</label>
          <input id="offer-price" name="offerPrice" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('listing.makeOffer')}</button>
        </form>
      )}

      {listing.saleType === 'auction' && <p className="kv-actions__note">{t.t('listing.auctionNote')}</p>}
      {listing.saleType === 'service' && <p className="kv-actions__note">{t.t('listing.serviceNote')}</p>}
    </div>
  );
}
