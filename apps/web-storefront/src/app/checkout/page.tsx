// apps/web-storefront/src/app/checkout/page.tsx · the checkout review. PROTECTED + dynamic (requireSession). Reads
// the authoritative cart + the buyer's saved addresses via the authed SDK, and renders the order review: delivery
// address choice, an optional coupon, the serviceable delivery options for the chosen address, and a
// SERVER-COMPUTED bill (subtotal + delivery + platform fee + coupon discount).
//
// P1-3: the bill is the real server-side preview (`checkout.preview({couponCode})` — DRY-RUN, no order, no money
// moved) and the delivery options come from `checkout.deliveryMethods({pincode})`. Applying a coupon re-previews
// via a `?coupon=` GET (works without client JS); an invalid coupon shows the server's reason and the un-discounted
// bill. Placement ALWAYS recomputes + redeems the coupon server-side (the client never sets the total). Both reads
// degrade gracefully — if the preview is unavailable we fall back to the cart subtotal. Money via formatMoneyMinor (Law 2).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Cart, Address, CheckoutPreview, DeliveryMethod } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { normalizeCoupon, pickDefaultMethod } from '../../features/checkout/preview';
import { placeOrderAction } from './actions';

const CURRENCY = 'INR'; // platform settlement currency (cart read-model carries no per-line currency code)

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.title'), robots: { index: false, follow: false } };
}

function addressLine(a: Address): string {
  return [a.line1, a.line2, a.village, a.pincode].filter(Boolean).join(', ');
}

export default async function CheckoutPage({ searchParams }: { searchParams: { status?: string; coupon?: string } }) {
  await requireSession('/checkout');
  const t = getTranslator();
  const lang = getLang();

  let cart: Cart | null = null;
  let addresses: Address[] = [];
  try {
    [cart, addresses] = await Promise.all([serverClient().cart.get(), serverClient().addresses.list()]);
  } catch {
    cart = null;
  }

  if (!cart) {
    return (
      <section className="kv-checkout"><h1>{t.t('checkout.title')}</h1>
        <p className="kv-form__error" role="alert">{t.t('checkout.loadError')}</p>
      </section>
    );
  }
  if (cart.items.length === 0) redirect('/cart'); // nothing to check out

  const defaultAddr = addresses.find((a) => a.isDefault) ?? addresses[0];
  const idempotencyKey = randomUUID(); // per-render; resubmits of THIS review dedupe server-side

  // P1-3 — server-authoritative bill + delivery options (both degrade to null/[] so the page never breaks).
  const appliedCoupon = normalizeCoupon(searchParams.coupon);
  const [preview, deliveryMethods] = await Promise.all([
    serverClient().checkout.preview(appliedCoupon ? { couponCode: appliedCoupon } : {}).catch((): CheckoutPreview | null => null),
    defaultAddr?.pincode
      ? serverClient().checkout.deliveryMethods({ pincode: defaultAddr.pincode }).then((r) => r.methods).catch((): DeliveryMethod[] => [])
      : Promise.resolve<DeliveryMethod[]>([]),
  ]);
  // A coupon was sent but the server applied no discount → surface the reason (the bill stays un-discounted).
  const couponRejected = !!appliedCoupon && !!preview && BigInt(preview.discountMinor) <= 0n;
  const defaultMethod = pickDefaultMethod(deliveryMethods);

  return (
    <section className="kv-checkout">
      <h1>{t.t('checkout.title')}</h1>
      {searchParams.status === 'err' && <p className="kv-form__error" role="alert">{t.t('checkout.placeError')}</p>}

      {/* Coupon application is a GET re-preview (no JS needed): submitting reloads /checkout?coupon=CODE and the
          server re-computes the DRY-RUN bill below. The chosen code is carried into the place-order form as a
          hidden field; placement validates + redeems it server-side. */}
      <form method="get" action="/checkout" className="kv-checkout__coupon-form" role="search">
        <label htmlFor="coupon" className="kv-field__label">{t.t('checkout.couponLabel')}</label>
        <div className="kv-checkout__coupon-row">
          <input id="coupon" name="coupon" type="text" maxLength={40} defaultValue={appliedCoupon ?? ''}
            className="kv-field__input kv-checkout__coupon" autoCapitalize="characters" inputMode="text" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('checkout.couponApply')}</button>
        </div>
        {appliedCoupon && !couponRejected && <p className="kv-form__notice" role="status">{t.t('checkout.couponApplied', { code: appliedCoupon })}</p>}
        {couponRejected && <p className="kv-form__error" role="alert">{t.t('checkout.couponRejected')}</p>}
        {!appliedCoupon && <p className="kv-field__hint">{t.t('checkout.couponHint')}</p>}
      </form>

      <form action={placeOrderAction} className="kv-checkout__form">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {/* the applied coupon rides along so placement redeems exactly what the buyer previewed */}
        {appliedCoupon && <input type="hidden" name="couponCode" value={appliedCoupon} />}

        <fieldset className="kv-checkout__section">
          <legend>{t.t('checkout.deliveryAddress')}</legend>
          {addresses.length === 0 ? (
            <p className="kv-detail__muted">{t.t('checkout.noAddress')}</p>
          ) : (
            <ul className="kv-checkout__addrs">
              {addresses.map((a) => (
                <li key={a.id}>
                  <label className="kv-checkout__addr">
                    <input type="radio" name="deliveryAddressId" value={a.id} defaultChecked={a.id === defaultAddr?.id} />
                    <span>{a.contactName ? `${a.contactName} — ` : ''}{addressLine(a)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {deliveryMethods.length > 0 && (
          <fieldset className="kv-checkout__section">
            <legend>{t.t('checkout.deliveryMethodLegend')}</legend>
            <ul className="kv-checkout__methods">
              {deliveryMethods.map((m) => (
                <li key={m.id}>
                  <label className="kv-checkout__method">
                    <input type="radio" name="deliveryMethodId" value={m.id} defaultChecked={m.id === defaultMethod?.id} />
                    <span>{m.name}</span>
                    <span className="kv-checkout__method-fee">{formatMoneyMinor(m.feeMinor, CURRENCY, lang)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <div className="kv-checkout__summary">
          {preview ? (
            <dl className="kv-checkout__bill">
              <div><dt>{t.t('cart.subtotal')}</dt><dd>{formatMoneyMinor(preview.subtotalMinor, preview.currencyCode, lang)}</dd></div>
              <div><dt>{t.t('checkout.billDelivery')}</dt><dd>{formatMoneyMinor(preview.deliveryFeeMinor, preview.currencyCode, lang)}</dd></div>
              <div><dt>{t.t('checkout.billPlatformFee')}</dt><dd>{formatMoneyMinor(preview.platformFeeMinor, preview.currencyCode, lang)}</dd></div>
              {BigInt(preview.discountMinor) > 0n && (
                <div className="kv-checkout__bill-discount"><dt>{t.t('checkout.billDiscount')}</dt><dd>−{formatMoneyMinor(preview.discountMinor, preview.currencyCode, lang)}</dd></div>
              )}
              <div className="kv-checkout__bill-total"><dt>{t.t('checkout.billTotal')}</dt><dd><strong>{formatMoneyMinor(preview.grandTotalMinor, preview.currencyCode, lang)}</strong></dd></div>
            </dl>
          ) : (
            <p className="kv-cart__subtotal"><span>{t.t('cart.subtotal')}</span> <strong>{formatMoneyMinor(cart.subtotalMinor, CURRENCY, lang)}</strong></p>
          )}
          <p className="kv-cart__note">{t.t('checkout.totalsNote')}</p>
          <button type="submit" className="kv-btn">{t.t('checkout.placeOrder')}</button>
          <Link href="/cart" className="kv-btn--link">{t.t('checkout.backToCart')}</Link>
        </div>
      </form>
    </section>
  );
}
