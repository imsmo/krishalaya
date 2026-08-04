// apps/web-storefront/src/app/cart/page.tsx · the buyer's cart. PROTECTED: requireSession redirects anonymous
// visitors to /login?next=/cart (no flash of private data). The cart is read fresh from the authed SDK on every
// view (dynamic — reading the session cookie opts out of caching), so prices and availability are always the
// server's truth; we never trust a stale client total. Money is rendered with formatMoneyMinor from minor-unit
// strings (Law 2). Quantity update / remove / clear are Server Actions (no client JS). The cart read-model omits
// a currency code; the platform settlement currency is INR (matches formatMoneyMinor's default).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Cart } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { updateCartItemAction, removeCartItemAction, clearCartAction } from './actions';

const CURRENCY = 'INR'; // platform settlement currency; cart read-model carries no per-line currency code

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('cart.title'), robots: { index: false, follow: false } };
}

export default async function CartPage() {
  await requireSession('/cart');
  const t = getTranslator();
  const lang = getLang();

  let cart: Cart | null = null;
  try { cart = await serverClient().cart.get(); } catch { cart = null; }

  if (!cart) {
    return (
      <section className="kv-cart">
        <h1>{t.t('cart.title')}</h1>
        <p className="kv-form__error" role="alert">{t.t('cart.loadError')}</p>
      </section>
    );
  }

  if (cart.items.length === 0) {
    return (
      <section className="kv-cart kv-empty-state">
        <h1>{t.t('cart.title')}</h1>
        <p>{t.t('cart.empty')}</p>
        <Link href="/" className="kv-btn">{t.t('cart.continueShopping')}</Link>
      </section>
    );
  }

  const anyUnpurchasable = cart.items.some((i) => !i.purchasable);

  return (
    <section className="kv-cart">
      <h1>{t.t('cart.title')}</h1>

      <ul className="kv-cart__list">
        {cart.items.map((item) => (
          <li key={item.listingId} className="kv-cart__row">
            <div className="kv-cart__info">
              <span className="kv-cart__title">{item.title ?? t.t('cart.untitled')}</span>
              <span className="kv-cart__unit">{formatMoneyMinor(item.unitPriceMinor, CURRENCY, lang)} {t.t('cart.perUnit')}</span>
              {item.priceChanged && <span className="kv-cart__warn" role="status">{t.t('cart.priceChanged')}</span>}
              {!item.purchasable && <span className="kv-cart__warn" role="status">{t.t('cart.unavailable')}</span>}
            </div>

            <form action={updateCartItemAction} className="kv-cart__qtyform">
              <input type="hidden" name="listingId" value={item.listingId} />
              <label htmlFor={`q-${item.listingId}`} className="kv-visually-hidden">{t.t('cart.quantity')}</label>
              <input id={`q-${item.listingId}`} name="quantity" type="number" inputMode="numeric" min={1} max={Math.max(1, item.available)} step={1} defaultValue={item.quantity} className="kv-field__input kv-cart__qty" />
              <button type="submit" className="kv-btn--link">{t.t('cart.update')}</button>
            </form>

            <span className="kv-cart__line">{formatMoneyMinor(item.lineTotalMinor, CURRENCY, lang)}</span>

            <form action={removeCartItemAction}>
              <input type="hidden" name="listingId" value={item.listingId} />
              <button type="submit" className="kv-btn--link kv-cart__remove">{t.t('cart.remove')}</button>
            </form>
          </li>
        ))}
      </ul>

      <div className="kv-cart__foot">
        <p className="kv-cart__subtotal"><span>{t.t('cart.subtotal')}</span> <strong>{formatMoneyMinor(cart.subtotalMinor, CURRENCY, lang)}</strong></p>
        <p className="kv-cart__note">{t.t('cart.totalsNote')}</p>
        <div className="kv-cart__actions">
          <form action={clearCartAction}><button type="submit" className="kv-btn--link">{t.t('cart.clear')}</button></form>
          {anyUnpurchasable
            ? <span className="kv-cart__warn">{t.t('cart.fixBeforeCheckout')}</span>
            : <Link href="/checkout" className="kv-btn">{t.t('cart.checkout')}</Link>}
        </div>
      </div>
    </section>
  );
}
