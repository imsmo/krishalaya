// apps/web-storefront/src/lib/checkout-flow.ts · PC-56 STORE-2c · C1 — what the checkout's three steps carry BETWEEN steps, kept out of the URL
// (the lib/signup-flow.ts pattern).
//
// ONE short-lived httpOnly cookie, `kv_checkout` (30 minutes; JavaScript cannot read it; SameSite=Lax; Secure in production; path "/"): the
// organisation it belongs to, the chosen address, the chosen delivery method, how the buyer will pay, a coupon, and the add-address draft (its
// values and per-field refusals — W3048 keeps the values). The codec is pure (features/store2c/checkout.ts: every field re-validated on the way
// in, a state for ANOTHER store ignored). Nothing here is money: the bill is always re-asked from the API.
import 'server-only';
import { cookies } from 'next/headers';
import { decodeState, encodeState, EMPTY_STATE, type CheckoutState } from '../features/store2c/checkout';

export const CHECKOUT_COOKIE = 'kv_checkout';
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const CHECKOUT_MAX_AGE_SEC = 30 * 60;

/** The state for THIS store (a fresh empty one when there is none, or when the cookie belongs to another store / is malformed). */
export function readCheckout(slug: string): CheckoutState {
  return decodeState(cookies().get(CHECKOUT_COOKIE)?.value, slug) ?? EMPTY_STATE(slug);
}
export function writeCheckout(s: CheckoutState): void {
  cookies().set(CHECKOUT_COOKIE, encodeState(s), { ...OPTS, maxAge: CHECKOUT_MAX_AGE_SEC });
}
export function clearCheckout(): void {
  cookies().delete(CHECKOUT_COOKIE);
}
