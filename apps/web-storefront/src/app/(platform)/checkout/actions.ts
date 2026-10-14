'use server';
// apps/web-storefront/src/app/(platform)/checkout/actions.ts · place-order. AUTHENTICATED: requireSession bounces anonymous
// callers to /login?next=/checkout before any write. checkout.checkout converts the buyer's cart into one order
// per seller under ONE Idempotency-Key (Law 3): the key is generated server-side when the /checkout form renders
// and submitted as a hidden field, so a refresh / double-submit of the SAME review carries the SAME key and the
// API dedupes — never a double order. The discount/charges/tax are computed SERVER-SIDE and read back on the
// order (the client never computes money).
// PC-56 HOTFIX-4 · C2 (survey F-1 / C-9, founder D2): where the buyer goes next is the ORDERS' own `paymentState` — one order awaiting
// payment → its Pay step; `none` (online payments OFF: the seller confirms, payment on delivery) → the confirmation, never the payments
// route (it 404s behind its flag); several orders → the GROUP confirmation naming every one (A9 — nothing orphaned behind orders[0]).
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { isDeclinedOutcome, placeRefusalStatus } from '../../../features/checkout/preview';
import { serverClient } from '../../../lib/api-client';
import { afterPlacementHref } from '../../../features/orders/payment-state';
import { requireSession } from '../../../lib/session';
import { checkoutRefusalHref, refusalOf } from '../../../features/store2b/cart';

function isUuidish(v: string): boolean {
  return /^[0-9a-fA-F-]{8,64}$/.test(v);
}

export async function placeOrderAction(formData: FormData): Promise<void> {
  await requireSession('/checkout');

  const idempotencyKey = String(formData.get('idempotencyKey') ?? '');
  if (!idempotencyKey) redirect('/checkout?status=err');

  const addrRaw = String(formData.get('deliveryAddressId') ?? '');
  const methodRaw = String(formData.get('deliveryMethodId') ?? '');
  const couponRaw = String(formData.get('couponCode') ?? '').trim();
  const deliveryAddressId = isUuidish(addrRaw) ? addrRaw : undefined;
  const deliveryMethodId = isUuidish(methodRaw) ? methodRaw : undefined; // buyer's chosen serviceable method
  const couponCode = couponRaw ? couponRaw.slice(0, 40) : undefined;

  let next: string | null = null; let refusal = 'err'; let back: string | null = null;
  try {
    const result = await serverClient().checkout.checkout({ deliveryAddressId, deliveryMethodId, couponCode }, idempotencyKey);
    // PC-56 TENANT-10b: a coupon the server did not apply means the order was placed at the normal price — the next page
    // says so kindly (the outcome travels, never an error code).
    const declined = isDeclinedOutcome(result.couponNotice?.outcome) ? result.couponNotice!.outcome : null;
    next = afterPlacementHref(result, declined);
  } catch (e) {
    // Invalid coupon / empty cart / stock race / transient — never auto-retry a money mutation; send the buyer
    // back to the cart-reviewed checkout with a generic, non-leaky error. PC-56 TENANT-SW-a: a delivery refusal (a pincode in no
    // active zone, no address, a method that does not serve it) is said kindly instead.
    refusal = placeRefusalStatus(e instanceof SdkError ? e.code : null);
    // PC-56 STORE-2b · C6: the cart's named refusals — a line problem (PRICE_CHANGED with both numbers, BELOW_MIN_ORDER, LICENCE_REQUIRED, a
    // line that cannot be bought) sends the buyer BACK TO THE CART, which shows that line; BANNED_IN_REGION stays here with the region named;
    // buying paused stays here, said. Nothing was placed in any of them.
    if (e instanceof SdkError) {
      const r = refusalOf(e.code, e.details ?? null);
      back = r === 'failed' || r === 'not_a_number' ? null : checkoutRefusalHref(r, { region: typeof e.details?.region === 'string' ? e.details.region : null });
    }
  }
  if (!next && back) redirect(back);
  if (!next && refusal !== 'err') redirect(`/checkout?status=${refusal}`);

  if (!next) redirect('/checkout?status=err'); // nothing was created
  redirect(next);
}
