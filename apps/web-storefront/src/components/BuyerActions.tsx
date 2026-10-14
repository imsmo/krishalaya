// apps/web-storefront/src/components/BuyerActions.tsx · the buyer CTAs on a listing, chosen by sale type. Server
// component (the forms post to Server Actions — no client JS needed). PURCHASABLE listings (direct/both/preorder/
// group_lot) get an Add-to-cart form; OFFER-capable listings (direct/both) also get a Make-an-offer form. Auctions
// and services show a localized note (PC-56 HOTFIX-4, survey C-4: the detail read DOES carry the auction id now — the page renders the
// auction CTA beside this; the old "no auctionId / WAVE 4" note here was stale). Both forms
// carry the tenant slug + listing id + available qty as hidden fields so the action can validate server-side.
// HOTFIX-4 · A6: the page's allow-listed view model (no seller person, no coordinates)
import type { PublicListingView } from '../features/listing/public-view';
import { getTranslator } from '../lib/i18n';
import { addToCartAction, makeOfferAction } from '../app/[tenantSlug]/listings/[id]/actions';

const PURCHASABLE = new Set(['direct', 'both', 'preorder', 'group_lot']);
const OFFERABLE = new Set(['direct', 'both']);

// PC-56 STORE-2a · C3: the offer form shows ONLY when the store's `offers` flag is ON (survey F-16: it showed while the flag was OFF, every
// submit failed and the buyer was told to "check your entry"); the quantity inputs take DECIMALS (numeric(14,3) — up to 3 places, `step`
// 0.001, parsed as a decimal string server-side by features/store2a/listing.ts parseQuantity; the API re-validates). The stepper's own
// chain (W3099–W3102) is STORE-2b.
export function BuyerActions({ listing, tenantSlug, offers = false }: { listing: PublicListingView; tenantSlug: string; offers?: boolean }) {
  const t = getTranslator();
  const soldOut = listing.quantityAvailable <= 0;
  const purchasable = PURCHASABLE.has(listing.saleType) && !soldOut;
  const offerable = offers && OFFERABLE.has(listing.saleType) && !soldOut;
  const maxQty = listing.quantityAvailable > 0 ? listing.quantityAvailable : 1;

  return (
    <div className="kv-actions">
      {soldOut && <p className="kv-actions__note" role="status">{t.t('listing.soldOut')}</p>}

      {purchasable && (
        <form action={addToCartAction} className="kv-actions__form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="available" value={String(listing.quantityAvailable)} />
          <label htmlFor="qty-cart" className="kv-field__label">{t.t('listing.qtyLabel')}</label>
          <input id="qty-cart" name="quantity" type="number" inputMode="decimal" min={0.001} max={maxQty} defaultValue={1} step={0.001} className="kv-field__input kv-actions__qty" />
          <button type="submit" className="kv-btn">{t.t('listing.addToCart')}</button>
        </form>
      )}

      {offerable && (
        <form action={makeOfferAction} className="kv-actions__form" data-kv-offer="form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="listingId" value={listing.id} />
          <input type="hidden" name="available" value={String(listing.quantityAvailable)} />
          <label htmlFor="qty-offer" className="kv-field__label">{t.t('listing.qtyLabel')}</label>
          <input id="qty-offer" name="quantity" type="number" inputMode="decimal" min={0.001} max={maxQty} defaultValue={1} step={0.001} className="kv-field__input kv-actions__qty" />
          <label htmlFor="offer-price" className="kv-field__label">{t.t('listing.offerPriceLabel', { unit: listing.unitCode })}</label>
          <input id="offer-price" name="offerPrice" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('listing.makeOffer')}</button>
        </form>
      )}

      {listing.saleType === 'auction' && <p className="kv-actions__note">{t.t('listing.auctionNote', { platform: t.t('brand.platform') })}</p>}
      {listing.saleType === 'service' && <p className="kv-actions__note">{t.t('listing.serviceNote', { platform: t.t('brand.platform') })}</p>}
    </div>
  );
}
