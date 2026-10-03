'use server';
// apps/web-storefront/src/app/checkout/actions.ts · place-order. AUTHENTICATED: requireSession bounces anonymous
// callers to /login?next=/checkout before any write. checkout.checkout converts the buyer's cart into one order
// per seller under ONE Idempotency-Key (Law 3): the key is generated server-side when the /checkout form renders
// and submitted as a hidden field, so a refresh / double-submit of the SAME review carries the SAME key and the
// API dedupes — never a double order. The discount/charges/tax are computed SERVER-SIDE and read back on the
// order (the client never computes money). On success we redirect to the pay step for the primary order.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { isDeclinedOutcome, placeRefusalStatus } from '../../features/checkout/preview';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';

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

  let primaryOrderId: string | null = null; let declined: string | null = null; let refusal = 'err';
  try {
    const result = await serverClient().checkout.checkout({ deliveryAddressId, deliveryMethodId, couponCode }, idempotencyKey);
    primaryOrderId = result.orders[0]?.id ?? null;
    // PC-56 TENANT-10b: a coupon the server did not apply means the order was placed at the normal price — the pay page
    // says so kindly (the outcome travels, never an error code).
    declined = isDeclinedOutcome(result.couponNotice?.outcome) ? result.couponNotice!.outcome : null;
  } catch (e) {
    // Invalid coupon / empty cart / stock race / transient — never auto-retry a money mutation; send the buyer
    // back to the cart-reviewed checkout with a generic, non-leaky error. PC-56 TENANT-SW-a: a delivery refusal (a pincode in no
    // active zone, no address, a method that does not serve it) is said kindly instead.
    refusal = placeRefusalStatus(e instanceof SdkError ? e.code : null);
  }
  if (!primaryOrderId && refusal !== 'err') redirect(`/checkout?status=${refusal}`);

  if (!primaryOrderId) redirect('/checkout?status=err'); // nothing was created
  redirect(`/checkout/pay?o=${encodeURIComponent(primaryOrderId)}${declined ? `&cn=${declined}` : ''}`);
}
