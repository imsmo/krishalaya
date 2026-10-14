// apps/web-storefront/src/app/(platform)/checkout/page.tsx · the checkout review. PROTECTED + dynamic (requireSession). Reads
// the authoritative cart + the buyer's saved addresses via the authed SDK, and renders the order review: delivery
// address choice, an optional coupon, the serviceable delivery options for the chosen address, and a
// SERVER-COMPUTED bill.
//
// P1-3: the bill is the real server-side preview (DRY-RUN, no order, no money moved) and the delivery options come from
// `checkout.deliveryMethods({pincode})`. Applying a coupon re-previews via a `?coupon=` GET (works without client JS); an invalid coupon
// shows the server's reason and the un-discounted bill. Placement ALWAYS recomputes + redeems the coupon server-side.
//
// PC-56 HOTFIX-4 · C3/C4 (survey F-5a/b/c, C-7; founder D4):
//   • the ADDRESS and the DELIVERY OPTION the buyer picks are a GET choice (`?addr=&dm=`, no JS): the delivery options are quoted for THAT
//     address's pincode (they were quoted for the default address while the buyer could pick another), and the preview is asked WITH that
//     address and option — so a zone organisation's fee shown is the fee placement charges; without an address the bill says delivery
//     needs one (never "0" as if free);
//   • the bill is features/checkout/bill-rows.ts — platform fee and buyer commission each their own row when > 0, rows that sum to the
//     API's total (the buyer commission was inside the total with no row); "price includes platform fee" is said nowhere;
//   • every amount in the DATA's currency (features/discovery/money.ts) — the `'INR'` constant is gone.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import Link from 'next/link';
import type { Cart, Address, CheckoutPreview, DeliveryMethod } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PLACE_REFUSAL_KEYS, couponNoticeKey, normalizeCoupon, pickDefaultMethod, previewCouponOutcome } from '../../../features/checkout/preview';
import { billRows } from '../../../features/checkout/bill-rows';
import { moneyText } from '../../../features/discovery/money';
import { BillRowsView } from '../../../components/BillRowsView';
import { placeOrderAction } from './actions';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.title'), robots: { index: false, follow: false } };
}

function addressLine(a: Address): string {
  return [a.line1, a.line2, a.village, a.pincode].filter(Boolean).join(', ');
}

export default async function CheckoutPage({ searchParams }: { searchParams: { status?: string; coupon?: string; addr?: string; dm?: string } }) {
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

  // HOTFIX-4 · C3: the CHOSEN address (?addr=, one of the buyer's own) else the default
  const chosenAddr = addresses.find((a) => a.id === searchParams.addr) ?? addresses.find((a) => a.isDefault) ?? addresses[0];
  const idempotencyKey = randomUUID(); // per-render; resubmits of THIS review dedupe server-side

  const appliedCoupon = normalizeCoupon(searchParams.coupon);
  // delivery options quoted for the CHOSEN address's pincode (survey F-5b)
  const methodsResult = chosenAddr?.pincode
    ? await serverClient().checkout.deliveryMethods({ pincode: chosenAddr.pincode }).catch(() => null)
    : null;
  const deliveryMethods: DeliveryMethod[] = methodsResult?.methods ?? [];
  const chosenMethod = deliveryMethods.find((m) => m.id === searchParams.dm) ?? pickDefaultMethod(deliveryMethods);
  // the preview WITH the chosen address + option (survey F-5a) — the fee placement will charge
  const preview = await serverClient().checkout.preview({
    ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
    ...(chosenAddr ? { deliveryAddressId: chosenAddr.id } : {}),
    ...(chosenMethod ? { deliveryMethodId: chosenMethod.id } : {}),
  }).catch((): CheckoutPreview | null => null);

  // A coupon was sent but the server applied no discount → surface the reason (the bill stays un-discounted).
  const couponRejected = !!appliedCoupon && !!preview && BigInt(preview.discountMinor) <= 0n;
  // PC-56 TENANT-10b: the server says WHY in a kind message key (never an error code) — the same decision placement makes.
  const couponNotice = couponRejected ? couponNoticeKey(previewCouponOutcome(preview)) : null;
  const unavailable = t.t('money.unavailable');

  return (
    <section className="kv-checkout">
      <h1>{t.t('checkout.title')}</h1>
      {searchParams.status === 'err' && <p className="kv-form__error" role="alert">{t.t('checkout.placeError')}</p>}
      {searchParams.status && searchParams.status in PLACE_REFUSAL_KEYS && (
        <p className="kv-form__notice" role="alert">{t.t(PLACE_REFUSAL_KEYS[searchParams.status as keyof typeof PLACE_REFUSAL_KEYS])}</p>
      )}

      {/* Coupon application is a GET re-preview (no JS needed). The chosen address / option ride along so the bill keeps them. */}
      <form method="get" action="/checkout" className="kv-checkout__coupon-form" role="search">
        {chosenAddr && <input type="hidden" name="addr" value={chosenAddr.id} />}
        {chosenMethod && <input type="hidden" name="dm" value={chosenMethod.id} />}
        <label htmlFor="coupon" className="kv-field__label">{t.t('checkout.couponLabel')}</label>
        <div className="kv-checkout__coupon-row">
          <input id="coupon" name="coupon" type="text" maxLength={40} defaultValue={appliedCoupon ?? ''}
            className="kv-field__input kv-checkout__coupon" autoCapitalize="characters" inputMode="text" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('checkout.couponApply')}</button>
        </div>
        {appliedCoupon && !couponRejected && <p className="kv-form__notice" role="status">{t.t('checkout.couponApplied', { code: appliedCoupon })}</p>}
        {couponRejected && <p className="kv-form__notice" role="status">{t.t(couponNotice ?? 'checkout.couponRejected')}</p>}
        {!appliedCoupon && <p className="kv-field__hint">{t.t('checkout.couponHint')}</p>}
      </form>

      {/* HOTFIX-4 · C3: the address and the delivery option are a GET choice — the options and the bill are re-quoted for THEM. */}
      <form method="get" action="/checkout" className="kv-checkout__form" data-kv-form="delivery">
        {appliedCoupon && <input type="hidden" name="coupon" value={appliedCoupon} />}
        <fieldset className="kv-checkout__section">
          <legend>{t.t('checkout.deliveryAddress')}</legend>
          {addresses.length === 0 ? (
            <p className="kv-detail__muted">{t.t('checkout.noAddress')}</p>
          ) : (
            <ul className="kv-checkout__addrs">
              {addresses.map((a) => (
                <li key={a.id}>
                  <label className="kv-checkout__addr">
                    <input type="radio" name="addr" value={a.id} defaultChecked={a.id === chosenAddr?.id} />
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
                    <input type="radio" name="dm" value={m.id} defaultChecked={m.id === chosenMethod?.id} />
                    <span>{m.name}</span>
                    <span className="kv-checkout__method-fee">{moneyText(m.feeMinor, methodsResult?.currencyCode, lang) ?? unavailable}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {addresses.length > 0 && <button type="submit" className="kv-btn kv-btn--ghost">{t.t('checkout.deliveryUpdate')}</button>}
      </form>

      <form action={placeOrderAction} className="kv-checkout__form" data-kv-form="place">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {/* the applied coupon, the chosen address and option ride along so placement charges exactly what the buyer previewed */}
        {appliedCoupon && <input type="hidden" name="couponCode" value={appliedCoupon} />}
        {chosenAddr && <input type="hidden" name="deliveryAddressId" value={chosenAddr.id} />}
        {chosenMethod && <input type="hidden" name="deliveryMethodId" value={chosenMethod.id} />}

        <div className="kv-checkout__summary">
          {preview ? (
            <BillRowsView bill={billRows(preview)} />
          ) : (
            <p className="kv-cart__subtotal"><span>{t.t('cart.subtotal')}</span> <strong>{moneyText(cart.subtotalMinor, cart.currencyCode, lang) ?? unavailable}</strong></p>
          )}
          <p className="kv-cart__note">{t.t('checkout.totalsNote')}</p>
          <button type="submit" className="kv-btn">{t.t('checkout.placeOrder')}</button>
          <Link href="/cart" className="kv-btn--link">{t.t('checkout.backToCart')}</Link>
        </div>
      </form>
    </section>
  );
}
