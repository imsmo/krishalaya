'use server';
// apps/web-storefront/src/app/[tenantSlug]/checkout/actions.ts · PC-56 STORE-2c · C1–C4 — the checkout's acts, under the organisation.
// AUTHENTICATED (requireSession bounces anonymous callers to the store's sign-in). Every choice between the steps is written to the server-held
// `kv_checkout` cookie (lib/checkout-flow.ts) — never the URL — and every amount is re-asked from the API at the next render.
//   • chooseDeliveryAction — the address (W283's "Deliver to") and the delivery method quoted FOR THAT ADDRESS; "use this address" re-quotes,
//     "continue" goes on to the payment step;
//   • addAddressAction — the "+ Add address" chain (W3048–W3051): per-field refusals with the values kept (form-error), the API's create
//     (`addresses.create`), success = back to the address step with the NEW address SELECTED (methods re-quoted), failure named;
//   • choosePaymentAction — how the buyer will pay (online / wallet — the page offers only what is true, D6);
//   • applyCouponAction — the coupon (the preview dry-runs it; placement redeems it);
//   • placeOrderAction — placement under ONE Idempotency-Key minted at render (Law 3); where the buyer goes next is the ORDERS' paymentState;
//     the named refusals: a line problem → this store's cart (both numbers / the minimum / the reason), the stock that shrank under the lock →
//     back at review with the remainder (no partial take — refused by name), mixed currencies → named.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { readCheckout, writeCheckout, clearCheckout } from '../../../lib/checkout-flow';
import { addressBody, addressValues, afterPlacement, checkAddress, checkoutHref, moneyRefusalOf } from '../../../features/store2c/checkout';
import { normalizeCoupon, isDeclinedOutcome, placeRefusalStatus } from '../../../features/checkout/preview';
import { refusalOf, cartHref } from '../../../features/store2b/cart';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const slugOf = (fd: FormData): string => { const s = String(fd.get('slug') ?? ''); if (!SLUG.test(s)) redirect('/'); return s; };
const uuidOf = (fd: FormData, k: string): string | null => { const v = String(fd.get(k) ?? ''); return UUID.test(v) ? v : null; };

export async function chooseDeliveryAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  await requireSession(checkoutHref(slug, 'address'));
  const s = readCheckout(slug);
  const addressId = uuidOf(fd, 'addressId');
  const methodId = uuidOf(fd, 'methodId');
  // the page renders the radios with the address it QUOTED (`quotedFor`): a different address chosen now → its methods are re-quoted on the
  // address step first (a method quoted for another address is never carried over); the same address → the method is kept and "continue" goes on
  const quotedFor = uuidOf(fd, 'quotedFor');
  const changedAddress = addressId !== quotedFor;
  writeCheckout({ ...s, addressId, methodId: changedAddress ? null : methodId, draft: null });
  if (!changedAddress && addressId && String(fd.get('go') ?? '') === 'payment') redirect(checkoutHref(slug, 'payment'));
  redirect(checkoutHref(slug, 'address', { status: changedAddress ? 'requoted' : null }));
}

export async function addAddressAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  await requireSession(checkoutHref(slug, 'address'));
  const s = readCheckout(slug);
  const values = addressValues((k) => fd.get(k));
  const errors = checkAddress(values);
  if (Object.keys(errors).length > 0) {
    writeCheckout({ ...s, draft: { values, errors, failure: null } });               // W3048: every field's refusal, the values kept
    redirect(checkoutHref(slug, 'address', { add: '1', status: 'form_error' }));
  }
  let newId: string | null = null; let failure: string | null = null;
  try {
    const r = await serverClient(slug).addresses.create(addressBody(values) as never);
    newId = (r as { id?: string }).id ?? null;
  } catch (e) {
    failure = e instanceof SdkError ? (e.isValidation ? 'validation' : e.status >= 500 ? 'server' : 'refused') : 'network';
  }
  if (!newId) {
    writeCheckout({ ...s, draft: { values, errors: {}, failure: failure ?? 'server' } });   // W3051: named, nothing saved, values kept
    redirect(checkoutHref(slug, 'address', { add: '1', status: 'address_failed' }));
  }
  writeCheckout({ ...s, addressId: newId, methodId: null, draft: null });                 // W3050: the new address SELECTED, methods re-quoted
  redirect(checkoutHref(slug, 'address', { status: 'address_added' }));
}

export async function choosePaymentAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  await requireSession(checkoutHref(slug, 'payment'));
  const s = readCheckout(slug);
  const pay = String(fd.get('pay') ?? '');
  writeCheckout({ ...s, pay: pay === 'wallet' ? 'wallet' : 'online' });
  redirect(checkoutHref(slug, 'review'));
}

export async function applyCouponAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  await requireSession(checkoutHref(slug, 'review'));
  const s = readCheckout(slug);
  writeCheckout({ ...s, coupon: normalizeCoupon(String(fd.get('coupon') ?? '')) });
  redirect(checkoutHref(slug, 'review'));
}

export async function placeOrderAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  await requireSession(checkoutHref(slug, 'review'));
  const idempotencyKey = String(fd.get('idempotencyKey') ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(idempotencyKey)) redirect(checkoutHref(slug, 'review', { status: 'err' }));
  const s = readCheckout(slug);
  let next: string | null = null; let back: string | null = null;
  try {
    const result = await serverClient(slug).checkout.checkout({
      ...(s.addressId ? { deliveryAddressId: s.addressId } : {}), ...(s.methodId ? { deliveryMethodId: s.methodId } : {}), ...(s.coupon ? { couponCode: s.coupon } : {}),
    }, idempotencyKey);
    const declined = isDeclinedOutcome(result.couponNotice?.outcome) ? result.couponNotice!.outcome : null;
    next = afterPlacement(slug, result, declined);
    if (next && s.pay === 'wallet' && next.includes('/checkout/pay?')) next = `${next}&via=wallet`;
  } catch (e) {
    if (e instanceof SdkError) {
      const money = moneyRefusalOf(e.code);
      // STORE-2c · C4: the stock shrank under the row lock at placement — back at review with the LOCKED remainder (no partial take)
      if (money === 'stock') {
        const available = typeof e.details?.available === 'string' ? e.details.available : null;
        back = checkoutHref(slug, 'review', { status: 'stock', available, listing: typeof e.details?.listingId === 'string' ? e.details.listingId : null });
      } else if (money) {
        back = checkoutHref(slug, 'review', { status: money });
      } else {
        const r = refusalOf(e.code, e.details ?? null);
        if (r === 'banned') back = checkoutHref(slug, 'review', { status: 'banned', region: typeof e.details?.region === 'string' ? e.details.region : null });
        else if (r === 'cart_off') back = checkoutHref(slug, 'review', { status: 'cart_off' });
        else if (r !== 'failed' && r !== 'not_a_number') back = cartHref(slug, { status: r });                 // a line problem → this store's cart
        else {
          const kind = placeRefusalStatus(e.code);
          back = checkoutHref(slug, kind === 'err' ? 'review' : 'address', { status: kind });
        }
      }
    } else back = checkoutHref(slug, 'review', { status: 'err' });
  }
  if (!next) redirect(back ?? checkoutHref(slug, 'review', { status: 'err' }));   // nothing was placed in any of these
  clearCheckout();
  redirect(next as string);
}
