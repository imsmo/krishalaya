// apps/web-storefront/src/features/store2c/checkout.ts · PC-56 STORE-2c · C1–C5 — THE CHECKOUT'S PURE HALF (no React, no Next, no I/O; the cookie
// half is lib/checkout-flow.ts; unit-tested in test/store2c-checkout.spec.ts).
//
// ONE ROUTE, THREE STEPS (canon W283 address → W284 payment → W285 review; the canon's three routes are a recorded DELTA): `/<slug>/checkout
// ?step=address|payment|review`. What the buyer chose between steps — the address, the delivery method (the zone `deliveryMethods` quoted for
// THAT address), how they will pay, a coupon, an add-address draft — is SERVER-HELD in the httpOnly `kv_checkout` cookie (30 minutes), never in
// the URL beyond the step and named statuses (the lib/signup-flow.ts pattern). A step cannot be reached past its prerequisite.
//
// NO MONEY ARITHMETIC. Every amount on these pages is the API's (the preview's per-seller slices, the order's total, the wallet's balance), printed
// through `moneyText` in the data's own currency. The ONE comparison here (`walletCovers`) is a BigInt comparison that decides whether a
// method is OFFERED — it prints nothing (test/store2c-checkout.spec.ts greps this file for `*` / `+` on a minor).
import { maskForDisplay } from '../chain/mask';

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* STEPS                                                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const CHECKOUT_STEPS = ['address', 'payment', 'review'] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];
export type PayChoice = 'online' | 'wallet';

/** The server-held state between the steps. */
export interface CheckoutState {
  v: 1;
  /** The organisation this checkout belongs to (one store per session — a state from another store is ignored). */
  slug: string;
  addressId: string | null;
  methodId: string | null;
  pay: PayChoice | null;
  coupon: string | null;
  /** The add-address chain's draft (W3048 form-error keeps the values; W3051 failure is named). */
  draft: AddressDraft | null;
}
export interface AddressDraft { values: AddressValues; errors: Partial<Record<keyof AddressValues, AddressFieldRefusal>>; failure: string | null }
export interface AddressValues { line1: string; line2: string; village: string; pincode: string; countryCode: string; contactName: string; contactPhone: string; labelId: string }
export type AddressFieldRefusal = 'required' | 'too_short' | 'too_long' | 'postal' | 'phone' | 'label' | 'country';

export const EMPTY_STATE = (slug: string): CheckoutState => ({ v: 1, slug, addressId: null, methodId: null, pay: null, coupon: null, draft: null });

/** Which step a request may be on: payment and review need a chosen address; anything unknown is the address step. */
export function resolveStep(raw: unknown, s: CheckoutState | null): CheckoutStep {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const wanted: CheckoutStep = (CHECKOUT_STEPS as readonly string[]).includes(String(v ?? '')) ? (v as CheckoutStep) : 'address';
  if (wanted !== 'address' && !s?.addressId) return 'address';
  return wanted;
}

/** The tenant's checkout (and its steps / statuses). Only plain words and numbers ever ride in this URL — never an id the buyer typed. */
export function checkoutHref(slug: string, step?: CheckoutStep | null, q: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  if (step) p.set('step', step);
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v !== '') p.set(k, v.slice(0, 80));
  const qs = p.toString();
  return `/${encodeURIComponent(slug)}/checkout${qs ? `?${qs}` : ''}`;
}
export function payHref(slug: string, orderId: string, groupId?: string | null): string {
  return `/${encodeURIComponent(slug)}/checkout/pay?o=${encodeURIComponent(orderId)}${groupId ? `&g=${encodeURIComponent(groupId)}` : ''}`;
}
export function confirmHref(slug: string, orderId: string, groupId?: string | null): string {
  return groupId ? `/${encodeURIComponent(slug)}/checkout/confirm?g=${encodeURIComponent(groupId)}` : `/${encodeURIComponent(slug)}/checkout/confirm?o=${encodeURIComponent(orderId)}`;
}
/** After placement: one order awaiting payment → its pay step; anything else → the confirmation naming every order (HOTFIX-4 · A9, now under
 *  the organisation's own chrome). `paymentState` is the ORDER's own word. */
export function afterPlacement(slug: string, result: { orders: Array<{ id: string; paymentState?: unknown }>; checkoutGroupId: string | null }, couponNotice: string | null = null): string | null {
  const orders = result.orders ?? [];
  if (orders.length === 0) return null;
  const cn = couponNotice ? `&cn=${encodeURIComponent(couponNotice)}` : '';
  if (orders.length === 1 && orders[0].paymentState === 'pending') return `${payHref(slug, orders[0].id)}${cn}`;
  return `${confirmHref(slug, orders[0].id, result.checkoutGroupId)}${cn}`;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE SERVER-HELD STATE — a codec (base64url JSON), every field re-validated on the way in                                           */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const COUPON = /^[A-Z0-9_-]{3,40}$/;
const FIELDS: ReadonlyArray<keyof AddressValues> = ['line1', 'line2', 'village', 'pincode', 'countryCode', 'contactName', 'contactPhone', 'labelId'];
const REFUSALS: ReadonlyArray<AddressFieldRefusal> = ['required', 'too_short', 'too_long', 'postal', 'phone', 'label', 'country'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

export function encodeState(s: CheckoutState): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
}
export function decodeState(raw: string | null | undefined, slug: string): CheckoutState | null {
  if (!raw || raw.length > 6000) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  if (!o || o.v !== 1 || typeof o.slug !== 'string' || !SLUG.test(o.slug) || o.slug !== slug) return null;   // another store's state is ignored
  const d = o.draft as Record<string, unknown> | null | undefined;
  let draft: AddressDraft | null = null;
  if (d && typeof d === 'object') {
    const vals = (d.values ?? {}) as Record<string, unknown>;
    const errs = (d.errors ?? {}) as Record<string, unknown>;
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(vals[f], 250)])) as unknown as AddressValues;
    const errors: AddressDraft['errors'] = {};
    for (const f of FIELDS) if ((REFUSALS as readonly string[]).includes(String(errs[f]))) errors[f] = errs[f] as AddressFieldRefusal;
    draft = { values, errors, failure: typeof d.failure === 'string' ? d.failure.slice(0, 60) : null };
  }
  return {
    v: 1, slug: o.slug, addressId: id(o.addressId), methodId: id(o.methodId),
    pay: o.pay === 'online' || o.pay === 'wallet' ? o.pay : null,
    coupon: typeof o.coupon === 'string' && COUPON.test(o.coupon) ? o.coupon : null,
    draft,
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE ADD-ADDRESS CHAIN (W3048–W3051) — the identity DTO's rule, field by field, values kept                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** The address book's postal rule (apps/api shared/utils/postal-code.ts — 4–10 digits, any country): the SAME rule, so the form never refuses
 *  what the API accepts nor sends what it refuses. */
export const POSTAL_CODE_RE = /^\d{4,10}$/;
const PHONE_RE = /^\+?[0-9 ]{6,20}$/;

/** Read a submitted form into values (trimmed, bounded) — these are what the form re-renders on a refusal. */
export function addressValues(get: (k: string) => unknown): AddressValues {
  const v = (k: keyof AddressValues, max: number) => String(get(k) ?? '').trim().slice(0, max);
  return { line1: v('line1', 250), line2: v('line2', 250), village: v('village', 150), pincode: v('pincode', 12), countryCode: v('countryCode', 2).toUpperCase(),
    contactName: v('contactName', 150), contactPhone: v('contactPhone', 20), labelId: v('labelId', 36) };
}
/** Per-field refusals before the API is asked (it re-validates): line 1 required (3–250), a postal code by the one rule, a phone shape. */
export function checkAddress(v: AddressValues): AddressDraft['errors'] {
  const e: AddressDraft['errors'] = {};
  if (!v.line1) e.line1 = 'required'; else if (v.line1.length < 3) e.line1 = 'too_short';
  if (!v.pincode) e.pincode = 'required'; else if (!POSTAL_CODE_RE.test(v.pincode)) e.pincode = 'postal';
  if (v.contactPhone && !PHONE_RE.test(v.contactPhone)) e.contactPhone = 'phone';
  if (v.labelId && !UUID.test(v.labelId)) e.labelId = 'label';
  if (!/^[A-Z]{2}$/.test(v.countryCode)) e.countryCode = 'country';
  return e;
}
/** The API body for `addresses.create` (empty optionals omitted). The country is the buyer's (two letters — the address book stores it; the
 *  postal rule is the same for every country, as the API's is). */
export function addressBody(v: AddressValues): Record<string, unknown> {
  const b: Record<string, unknown> = { line1: v.line1, pincode: v.pincode, countryCode: v.countryCode };
  if (v.line2) b.line2 = v.line2;
  if (v.village) b.village = v.village;
  if (v.contactName) b.contactName = v.contactName;
  if (v.contactPhone) b.contactPhone = v.contactPhone;
  if (v.labelId) b.labelId = v.labelId;
  return b;
}
export function addressFieldKey(r: AddressFieldRefusal): string { return `store2c.address.err.${r}`; }

/** An address card (W283): its label (from the `address_label` vocabulary, when the address has one), the lines, and who receives it — the
 *  phone MASKED (features/chain/mask.ts, the five-of-ten policy). */
export interface AddressCard { id: string; label: string | null; lines: string; receiver: string | null; phoneMasked: string | null; isDefault: boolean }
export function addressCard(a: { id: string; line1: string; line2?: string | null; village?: string | null; pincode?: string | null; labelId?: string | null; contactName?: string | null; contactPhone?: string | null; isDefault: boolean }, labels: ReadonlyMap<string, string>): AddressCard {
  return {
    id: a.id, label: a.labelId ? labels.get(a.labelId) ?? null : null,
    lines: [a.line1, a.line2, a.village, a.pincode].filter((x) => typeof x === 'string' && x.trim() !== '').join(', '),
    receiver: a.contactName?.trim() || null, phoneMasked: a.contactPhone ? maskForDisplay(a.contactPhone) : null, isDefault: a.isDefault,
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* PAYMENT METHODS (W284, founder D6 / HOTFIX-4 D2)                                                                                    */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type PaymentOffer = 'online' | 'wallet' | 'on_delivery';
/** Does the wallet cover the bill? A BigInt COMPARISON of two API figures in the SAME currency — it decides whether wallet pay is offered and
 *  prints nothing. A different currency, a malformed figure or no balance → false (never offered on a guess). */
export function walletCovers(balance: { availableMinor?: string | null; currencyCode?: string | null } | null, bill: { totalMinor?: string | null; currencyCode?: string | null } | null): boolean {
  if (!balance || !bill) return false;
  const a = balance.availableMinor; const t = bill.totalMinor;
  if (typeof a !== 'string' || typeof t !== 'string' || !/^\d+$/.test(a) || !/^\d+$/.test(t)) return false;
  if (String(balance.currencyCode ?? '').toUpperCase() !== String(bill.currencyCode ?? '').toUpperCase()) return false;
  return BigInt(a) >= BigInt(t);
}
/** What the payment step offers: online payments OFF → ONLY "pay on delivery; the organisation confirms" (no radio, HOTFIX-4 D2); ON → "pay
 *  online (the sheet chooses UPI / card / netbanking)" and — only when the wallet covers the whole bill (D6) — "pay from wallet". */
export function paymentOffers(onlinePayments: boolean, walletOk: boolean): PaymentOffer[] {
  if (!onlinePayments) return ['on_delivery'];
  return walletOk ? ['online', 'wallet'] : ['online'];
}
/** The buyer's choice, kept only while it is still offered (a wallet choice whose balance no longer covers falls back to online). */
export function effectivePay(choice: PayChoice | null, offers: readonly PaymentOffer[]): PaymentOffer {
  if (choice === 'wallet' && offers.includes('wallet')) return 'wallet';
  return offers.includes('online') ? 'online' : 'on_delivery';
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE NAMED MONEY REFUSALS (brief §B9 / §C4 / §C5)                                                                                     */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
// PC-56 STORE-3c · C4 (founder D2): + `amount_mismatch` (ORDER_PAYMENT_AMOUNT_MISMATCH — a payment that is not the amount DUE), by name
export const MONEY_REFUSALS = ['stock', 'mixed_currency', 'attempt_live', 'wallet_short', 'charge_method', 'not_awaiting', 'amount_mismatch', 'failed'] as const;
export type MoneyRefusal = (typeof MONEY_REFUSALS)[number];
export function moneyRefusalOf(code: string | null | undefined): MoneyRefusal | null {
  switch (code) {
    case 'LISTING_INSUFFICIENT_STOCK': return 'stock';
    case 'MIXED_CURRENCY': return 'mixed_currency';
    case 'PAYMENT_ATTEMPT_LIVE': return 'attempt_live';
    case 'WALLET_INSUFFICIENT_BALANCE': return 'wallet_short';
    case 'CHARGE_METHOD_UNSUPPORTED': return 'charge_method';
    case 'ORDER_NOT_AWAITING_PAYMENT': return 'not_awaiting';
    case 'ORDER_PAYMENT_AMOUNT_MISMATCH': return 'amount_mismatch';
    default: return null;
  }
}
export function moneyRefusalKey(r: MoneyRefusal): string { return `store2c.refused.${r}`; }
export function readMoneyRefusal(raw: unknown): MoneyRefusal | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string' || s === '') return null;
  return (MONEY_REFUSALS as readonly string[]).includes(s) ? (s as MoneyRefusal) : 'failed';
}
/** A 3-place decimal read back from the URL (the stock-shrank state's "N remain") — anything else is dropped, never printed. */
export function readDecimal(raw: unknown): string | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === 'string' && /^\d{1,9}(\.\d{1,3})?$/.test(s) ? s : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* PAYMENT PROCESSING (W286) — the real payment states, from the payment read                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type ProcessingView = 'none' | 'live' | 'authorized' | 'success' | 'failed' | 'expired' | 'refunding' | 'refunded';
/** The view of the order's NEWEST attempt. `initiated` / `pending` past their `expiresAt` read as `expired` (the server lapses them when the
 *  next attempt is asked for). */
export function processingView(latest: { status?: string | null; expiresAt?: string | null } | null | undefined, now: Date): ProcessingView {
  if (!latest || typeof latest.status !== 'string') return 'none';
  switch (latest.status) {
    case 'success': return 'success';
    case 'failed': return 'failed';
    case 'expired': return 'expired';
    case 'authorized': return 'authorized';
    case 'refund_initiated': return 'refunding';
    case 'refunded': case 'partially_refunded': return 'refunded';
    case 'initiated': case 'pending': {
      const exp = latest.expiresAt ? Date.parse(latest.expiresAt) : NaN;
      return Number.isFinite(exp) && exp <= now.getTime() ? 'expired' : 'live';
    }
    default: return 'none';
  }
}
/** The gateway's failure, as the code the API sent (apps/api payments/domain/payment-attempt.ts) → its catalogue key. */
export const FAILURE_REASONS = ['cancelled', 'timed_out', 'declined', 'insufficient_funds', 'authentication_failed', 'limit_exceeded', 'gateway_error', 'unknown'] as const;
export function failureReasonKey(code: unknown): string {
  return `store2c.fail.${(FAILURE_REASONS as readonly string[]).includes(String(code)) ? String(code) : 'unknown'}`;
}
/** "Send again" (W3061 — the act is re-requesting payment; nothing is charged by asking) is offered only after a failure or a lapse. */
export function canSendAgain(v: ProcessingView): boolean { return v === 'failed' || v === 'expired'; }
/** The attempt the NEXT sheet opens: the live one again (a refresh of the same key replays the same gateway order), else the next number. */
export function attemptToOpen(view: ProcessingView, a: { attempts: number; nextAttempt: number }): number {
  return view === 'live' ? Math.max(1, a.attempts) : Math.max(1, a.nextAttempt);
}
/** The Idempotency-Key of ONE payment attempt (the API keys an attempt by it). */
export const attemptKey = (orderId: string, attempt: number) => `order-pay:${orderId}:${attempt}`;
