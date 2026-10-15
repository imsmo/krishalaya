// apps/web-storefront/src/app/[tenantSlug]/checkout/page.tsx · PC-56 STORE-2c · C1–C4 — canon W283 (address), W284 (payment), W285 (review & place)
// as ONE route under the ORGANISATION's chrome (founder 2b D3 carried: one store per session), `?step=address|payment|review`; the canon's three
// routes are a recorded DELTA (features/store2/refusals.ts STORE2C_DELTAS.one_route). Dynamic, server-rendered, every act a Server Action, no
// client JS except the Place button's pending lock. The buyer's choices between steps are SERVER-HELD (lib/checkout-flow.ts).
//
//   address (W283)  "Deliver to" cards — the label (the `address_label` vocabulary), the lines, the receiver with the phone MASKED; the selected
//                   address re-quotes the delivery methods (`checkout.deliveryMethods` for ITS postal code) and the preview asked WITH it (the
//                   zone fee placement charges); "+ Add address" = the W3048–W3051 chain inline (values kept, per-field refusals, the new
//                   address SELECTED on success, a named failure); an unserviceable address said kindly; a load error with Retry (W3052–W3054
//                   = a reload, PARITY-DECOR);
//   payment (W284)  online payments ON → "Pay online (UPI, card, netbanking — chosen in the secure sheet)" and, ONLY when the wallet balance
//                   covers the whole bill (D6), "Pay from wallet (balance X)"; OFF → the single honest line "pay on delivery; the organisation
//                   confirms your order" (HOTFIX-4 D2) and no radio; the escrow sentence (D6); the refund sentence as the code has it (D3);
//   review (W285)   one block per seller's order — "Order N of M — <organisation>", its items (title + the price as it will be frozen), its OWN
//                   bill rows (the API's per-seller slice: delivery, platform fee, buyer commission, total) — each paid on its own after
//                   placement (D2); the GST sentence (D5); the quality window FROM THE API; "payment is processed by <platform>" (D8); the
//                   snapshot sentence (true: placement refuses if a price changed since); "Place order" locked while it runs, its key minted
//                   at render; states: nothing to check out, the stock that shrank (with the remainder), the price re-check (→ the cart), etc.
// Every canon claim this build does not make is printed by name (RefusalList, surfaces checkout-address / -payment / -review).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import type { Address, Cart, CheckoutPreview, DeliveryMethod, DeliveryMethodsResult, StorefrontFlags, StorefrontTenant, WalletBalance } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { publicClient, serverClient, sessionTenantClient } from '../../../lib/api-client';
import { resolveSessionToken } from '../../../lib/session';
import { getSessionTenant } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { loadTenantShell } from '../../../lib/storefront-data';
import { readCheckout } from '../../../lib/checkout-flow';
import { moneyText } from '../../../features/discovery/money';
import { reloadHref } from '../../../features/home/load-result';
import { billRows } from '../../../features/checkout/bill-rows';
import { couponNoticeKey, previewCouponOutcome, PLACE_REFUSAL_KEYS } from '../../../features/checkout/preview';
import { cartHref, refusalOf, type CartRefusal } from '../../../features/store2b/cart';
import {
  addressCard, addressFieldKey, checkoutHref, effectivePay, moneyRefusalKey, paymentOffers, readDecimal, readMoneyRefusal, resolveStep, walletCovers,
  CHECKOUT_STEPS, type CheckoutState, type CheckoutStep,
} from '../../../features/store2c/checkout';
import { BillRowsView } from '../../../components/BillRowsView';
import { SubmitButton } from '../../../components/SubmitButton';
import { RefusalList, CartOff } from '../../../components/RefusalList';
import { addAddressAction, applyCouponAction, chooseDeliveryAction, choosePaymentAction, placeOrderAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.title'), robots: { index: false, follow: false } };
}

/** The three steps as a navigation list (the current one marked); a step past its prerequisite is not a link. */
function Steps({ slug, step, state }: { slug: string; step: CheckoutStep; state: CheckoutState }) {
  const t = getTranslator();
  return (
    <ol className="kv-checkout__steps" data-kv-steps={step}>
      {CHECKOUT_STEPS.map((s, i) => {
        const reachable = s === 'address' || !!state.addressId;
        const label = t.t(`store2c.step.${s}`, { n: String(i + 1) });
        return (
          <li key={s} aria-current={s === step ? 'step' : undefined} data-kv-step={s}>
            {s !== step && reachable ? <Link href={checkoutHref(slug, s)}>{label}</Link> : <span>{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default async function TenantCheckout({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;
  const head = <h1 data-kv-checkout-org={slug}>{t.t('store2c.title', { org })}</h1>;
  const status = one(searchParams.status) ?? null;

  // SIGN-IN: a checkout is a signed-in buyer's (the store's own sign-in, coming back here)
  const token = await resolveSessionToken();
  if (!token) {
    const self = checkoutHref(slug);
    return (
      <section className="kv-checkout">{head}
        <div className="kv-state" role="status" data-kv-state="signin">
          <p>{t.t('cart.signinRequired', { org })}</p>
          <a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-btn">{t.t('cart.signinCta', { org })}</a>
        </div>
      </section>
    );
  }
  // ONE STORE PER SESSION (2b D3): signed in to another organisation → said, with both doors — never another store's cart under this name
  const sessionTenant = getSessionTenant();
  if (shell.kind === 'ok' && sessionTenant && sessionTenant !== shell.tenant.tenantId) {
    let home: StorefrontTenant | null = null;
    try { home = await sessionTenantClient().storefront.tenant(); } catch { home = null; }
    return (
      <section className="kv-checkout">{head}
        <div className="kv-state" role="status" data-kv-state="wrong-store">
          <p>{home ? t.t('cart.otherStore', { current: home.displayName, store: org }) : t.t('cart.otherStoreUnknown', { store: org })}</p>
          {home?.slug && <p><a href={checkoutHref(home.slug)} className="kv-btn--link" data-kv-home-checkout={home.slug}>{t.t('store2c.yourCheckoutAt', { org: home.displayName })}</a></p>}
        </div>
      </section>
    );
  }

  // the switches first (the SDK retries a 5xx): buying paused (2b D2) is said, platform-wide
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags?.storefront_cart === false || status === 'cart_off') return <section className="kv-checkout">{head}<CartOff /><RefusalList surface="checkout" /></section>;
  const onlinePayments = flags?.online_payments === true;

  const state = readCheckout(slug);
  const step = resolveStep(searchParams.step, state);
  const api = serverClient(slug);
  let cart: Cart | null = null; let addresses: Address[] = [];
  let paused = false;
  try { [cart, addresses] = await Promise.all([api.cart.get(), api.addresses.list()]); }
  catch (e) { paused = e instanceof SdkError && e.code === 'STOREFRONT_CART_OFF'; cart = null; }
  // the API's own named refusal (the flags read may lag the switch): buying paused — said, platform-wide
  if (paused) return <section className="kv-checkout">{head}<CartOff /><RefusalList surface="checkout" /></section>;
  if (!cart) {
    // W3052–W3054 (PARITY-DECOR): Retry is a reload of this step — a read; your address and cart are unchanged
    return (
      <section className="kv-checkout">{head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store2c.loadError')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/checkout`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="checkout-address" />
      </section>
    );
  }
  if (cart.items.length === 0) {
    // W285 "No items left": every item was removed or already ordered
    return (
      <section className="kv-checkout">{head}
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t('store2c.noItems')}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn">{t.t('store2c.browseStore', { org })}</Link>
        </div>
      </section>
    );
  }

  const chosen = addresses.find((a) => a.id === state.addressId) ?? null;
  // the preview, asked WITH the chosen address + method + coupon (the fee placement charges) — its named refusal kept, never a bill it would refuse
  let preview: CheckoutPreview | null = null; let previewRefusal: { code: string; details: Record<string, unknown> | null } | null = null;
  try {
    preview = await api.checkout.preview({ ...(chosen ? { deliveryAddressId: chosen.id } : {}), ...(state.methodId ? { deliveryMethodId: state.methodId } : {}), ...(state.coupon ? { couponCode: state.coupon } : {}) });
  } catch (e) { if (e instanceof SdkError) previewRefusal = { code: e.code, details: e.details ?? null }; preview = null; }

  return (
    <section className="kv-checkout" data-kv-checkout-step={step}>
      {head}
      <Steps slug={slug} step={step} state={state} />
      {step === 'address' && await AddressStep({ slug, state, addresses, chosen, preview, previewRefusal, status, add: one(searchParams.add) === '1', lang })}
      {step === 'payment' && await PaymentStep({ slug, state, preview, onlinePayments, lang })}
      {step === 'review' && ReviewStep({ slug, org, state, preview, previewRefusal, onlinePayments, status, available: readDecimal(searchParams.available), region: one(searchParams.region) ?? null, lang })}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* W283 · ADDRESS                                                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
async function AddressStep({ slug, state, addresses, chosen, preview, previewRefusal, status, add, lang }: {
  slug: string; state: CheckoutState; addresses: Address[]; chosen: Address | null; preview: CheckoutPreview | null;
  previewRefusal: { code: string; details: Record<string, unknown> | null } | null; status: string | null; add: boolean; lang: string;
}) {
  const t = getTranslator();
  let labels = new Map<string, string>();
  try { labels = new Map((await publicClient(slug).lookups.values('address_label')).map((v) => [v.id, v.name])); } catch { labels = new Map(); }
  const selected = chosen ?? addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  // the delivery methods quoted FOR THE SELECTED address's postal code (survey F-5b) — a load error is said with a Retry
  let methods: DeliveryMethodsResult | null = null; let methodsFailed = false;
  if (selected?.pincode) {
    try { methods = await serverClient(slug).checkout.deliveryMethods({ pincode: selected.pincode }); } catch { methodsFailed = true; }
  }
  const list: DeliveryMethod[] = methods?.methods ?? [];
  const unserviceable = previewRefusal?.code === 'UNSERVICEABLE_PINCODE' || (!!selected && !!chosen && list.length === 0 && preview?.deliveryNeedsAddress === true);
  const chargeMethod = previewRefusal?.code === 'CHARGE_METHOD_UNSUPPORTED';
  const draft = add ? state.draft : null;
  const values = draft?.values;
  const err = (f: keyof NonNullable<typeof values>) => draft?.errors[f] ? <p className="kv-form__error" role="alert" data-kv-field-error={f}>{t.t(addressFieldKey(draft.errors[f]!))}</p> : null;

  return (
    <div className="kv-checkout__step" data-kv-step-body="address">
      {status === 'address_added' && <p className="kv-form__notice" role="status" data-kv-chain="success">{t.t('store2c.address.added')}</p>}
      {status === 'requoted' && <p className="kv-form__notice" role="status">{t.t('store2c.address.requoted')}</p>}
      {status && status in PLACE_REFUSAL_KEYS && <p className="kv-form__error" role="alert">{t.t(PLACE_REFUSAL_KEYS[status as keyof typeof PLACE_REFUSAL_KEYS])}</p>}

      <form action={chooseDeliveryAction} className="kv-checkout__form" data-kv-form="delivery">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="quotedFor" value={selected?.id ?? ''} />
        <fieldset className="kv-checkout__section">
          <legend>{t.t('store2c.address.legend')}</legend>
          {addresses.length === 0 ? (
            <p className="kv-detail__muted" data-kv-state="no-address">{t.t('store2c.address.none')}</p>
          ) : (
            <ul className="kv-checkout__addrs">
              {addresses.map((a) => {
                const c = addressCard(a, labels);
                return (
                  <li key={a.id} data-kv-address={a.id}>
                    <label className="kv-checkout__addr">
                      <input type="radio" name="addressId" value={a.id} defaultChecked={a.id === selected?.id} />
                      <span className="kv-checkout__addr-body">
                        {c.label && <span className="kv-badge" data-kv-address-label="">{c.label}</span>}
                        <span>{c.lines}</span>
                        {(c.receiver || c.phoneMasked) && (
                          <span className="kv-detail__muted" data-kv-receiver="">{t.t('store2c.address.receiving', { who: [c.receiver, c.phoneMasked].filter(Boolean).join(' · ') })}</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {addresses.length > 0 && <button type="submit" name="go" value="requote" className="kv-btn kv-btn--ghost">{t.t('store2c.address.use')}</button>}
        </fieldset>

        {selected && (
          <fieldset className="kv-checkout__section" data-kv-methods-for={selected.id}>
            <legend>{t.t('store2c.method.legend')}</legend>
            {methodsFailed ? (
              <div className="kv-state kv-state--error" role="alert" data-kv-state="methods-error">
                <p>{t.t('store2c.method.loadError')}</p>
                <a href={checkoutHref(slug, 'address')} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
              </div>
            ) : unserviceable ? (
              <p className="kv-form__notice" role="status" data-kv-state="unserviceable">{t.t('store2c.method.unserviceable')}</p>
            ) : list.length === 0 ? (
              <p className="kv-detail__muted" data-kv-state="no-zones">{t.t('store2c.method.storeDelivers')}</p>
            ) : (
              <ul className="kv-checkout__methods">
                {list.map((m) => (
                  <li key={m.id}>
                    <label className="kv-checkout__method">
                      <input type="radio" name="methodId" value={m.id} defaultChecked={m.id === (state.methodId ?? list[0]?.id)} />
                      <span>{m.name}</span>
                      <span className="kv-checkout__method-fee">{moneyText(m.feeMinor, methods?.currencyCode, lang) ?? t.t('money.unavailable')}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {chargeMethod && <p className="kv-form__error" role="alert" data-kv-refused="charge_method">{t.t(moneyRefusalKey('charge_method'))}</p>}
            <p className="kv-field__hint">{t.t('store2c.method.valueSlabs')}</p>
          </fieldset>
        )}
        {selected && !unserviceable && !methodsFailed && <button type="submit" name="go" value="payment" className="kv-btn" data-kv-go="payment">{t.t('store2c.continuePayment')}</button>}
      </form>

      {/* "+ Add address" — the W3048–W3051 chain, inline (W3049's review page is a DELTA: an address is not a money act) */}
      {!add ? (
        <p><a href={checkoutHref(slug, 'address', { add: '1' })} className="kv-btn kv-btn--ghost" data-kv-add-address="open">{t.t('store2c.address.add')}</a></p>
      ) : (
        <form action={addAddressAction} className="kv-checkout__form kv-checkout__add" data-kv-form="add-address" noValidate>
          <input type="hidden" name="slug" value={slug} />
          <h2>{t.t('store2c.address.addTitle')}</h2>
          {status === 'form_error' && <p className="kv-form__error" role="alert" data-kv-chain="form-error">{t.t('store2c.address.formError')}</p>}
          {status === 'address_failed' && <p className="kv-form__error" role="alert" data-kv-chain="failure">{t.t(`store2c.address.failed.${draft?.failure ?? 'server'}`)}</p>}
          <label className="kv-field__label" htmlFor="a-line1">{t.t('store2c.address.line1')}</label>
          <input id="a-line1" name="line1" className="kv-field__input" defaultValue={values?.line1 ?? ''} required maxLength={250} aria-invalid={draft?.errors.line1 ? true : undefined} />
          {err('line1')}
          <label className="kv-field__label" htmlFor="a-line2">{t.t('store2c.address.line2')}</label>
          <input id="a-line2" name="line2" className="kv-field__input" defaultValue={values?.line2 ?? ''} maxLength={250} />
          <label className="kv-field__label" htmlFor="a-village">{t.t('store2c.address.village')}</label>
          <input id="a-village" name="village" className="kv-field__input" defaultValue={values?.village ?? ''} maxLength={150} />
          <label className="kv-field__label" htmlFor="a-pincode">{t.t('store2c.address.postal')}</label>
          <input id="a-pincode" name="pincode" className="kv-field__input" inputMode="numeric" defaultValue={values?.pincode ?? ''} maxLength={10} aria-invalid={draft?.errors.pincode ? true : undefined} />
          {err('pincode')}
          <label className="kv-field__label" htmlFor="a-country">{t.t('store2c.address.country')}</label>
          <input id="a-country" name="countryCode" className="kv-field__input" defaultValue={values?.countryCode || (process.env.NEXT_PUBLIC_PLATFORM_COUNTRY ?? 'IN')} maxLength={2} autoCapitalize="characters" aria-invalid={draft?.errors.countryCode ? true : undefined} />
          {err('countryCode')}
          {labels.size > 0 && (
            <>
              <label className="kv-field__label" htmlFor="a-label">{t.t('store2c.address.label')}</label>
              <select id="a-label" name="labelId" className="kv-field__input" defaultValue={values?.labelId ?? ''}>
                <option value="">{t.t('store2c.address.noLabel')}</option>
                {[...labels].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              {err('labelId')}
            </>
          )}
          <label className="kv-field__label" htmlFor="a-contact">{t.t('store2c.address.receiver')}</label>
          <input id="a-contact" name="contactName" className="kv-field__input" defaultValue={values?.contactName ?? ''} maxLength={150} />
          <label className="kv-field__label" htmlFor="a-phone">{t.t('store2c.address.phone')}</label>
          <input id="a-phone" name="contactPhone" className="kv-field__input" inputMode="tel" defaultValue={values?.contactPhone ?? ''} maxLength={20} aria-invalid={draft?.errors.contactPhone ? true : undefined} />
          {err('contactPhone')}
          <SubmitButton idle={t.t('store2c.address.save')} busy={t.t('store2c.address.saving')} />
          <a href={checkoutHref(slug, 'address')} className="kv-btn--link">{t.t('store2c.address.cancel')}</a>
        </form>
      )}
      <RefusalList surface="checkout-address" />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* W284 · PAYMENT                                                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
async function PaymentStep({ slug, state, preview, onlinePayments, lang }: { slug: string; state: CheckoutState; preview: CheckoutPreview | null; onlinePayments: boolean; lang: string }) {
  const t = getTranslator();
  // D6: the wallet is offered ONLY when online payments are ON and the balance covers the whole bill (the API's figures, same currency)
  let balance: WalletBalance | null = null;
  if (onlinePayments && preview) { try { balance = await serverClient(slug).wallet.balance(preview.currencyCode); } catch { balance = null; } }
  const walletOk = walletCovers(balance, preview ? { totalMinor: preview.grandTotalMinor, currencyCode: preview.currencyCode } : null);
  const offers = paymentOffers(onlinePayments, walletOk);
  const chosen = effectivePay(state.pay, offers);
  return (
    <div className="kv-checkout__step" data-kv-step-body="payment">
      {onlinePayments ? (
        <form action={choosePaymentAction} className="kv-checkout__form" data-kv-form="pay-method">
          <input type="hidden" name="slug" value={slug} />
          <fieldset className="kv-checkout__section">
            <legend>{t.t('store2c.pay.legend')}</legend>
            <ul className="kv-checkout__methods">
              <li><label className="kv-checkout__method" data-kv-offer="online">
                <input type="radio" name="pay" value="online" defaultChecked={chosen === 'online'} />
                <span>{t.t('store2c.pay.online')}</span>
              </label></li>
              {offers.includes('wallet') && balance && (
                <li><label className="kv-checkout__method" data-kv-offer="wallet">
                  <input type="radio" name="pay" value="wallet" defaultChecked={chosen === 'wallet'} />
                  <span>{t.t('store2c.pay.wallet', { balance: moneyText(balance.availableMinor, balance.currencyCode, lang) ?? t.t('money.unavailable') })}</span>
                </label></li>
              )}
            </ul>
            {!offers.includes('wallet') && <p className="kv-field__hint" data-kv-wallet="not-offered">{t.t('store2c.pay.walletOnlyWhenCovers')}</p>}
          </fieldset>
          <p className="kv-cart__note" data-kv-escrow="">{t.t('store2c.escrow')}</p>
          <p className="kv-cart__note" data-kv-refund="">{t.t('store2c.refund.true')}</p>
          <button type="submit" className="kv-btn" data-kv-go="review">{t.t('store2c.continueReview')}</button>
        </form>
      ) : (
        <div className="kv-checkout__section" data-kv-offer="on_delivery">
          <p className="kv-form__notice" role="status">{t.t('store2c.pay.offLine')}</p>
          <Link href={checkoutHref(slug, 'review')} className="kv-btn" data-kv-go="review">{t.t('store2c.continueReview')}</Link>
        </div>
      )}
      <RefusalList surface="checkout-payment" />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* W285 · REVIEW & PLACE                                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
function ReviewStep({ slug, org, state, preview, previewRefusal, onlinePayments, status, available, region, lang }: {
  slug: string; org: string; state: CheckoutState; preview: CheckoutPreview | null; previewRefusal: { code: string; details: Record<string, unknown> | null } | null;
  onlinePayments: boolean; status: string | null; available: string | null; region: string | null; lang: string;
}) {
  const t = getTranslator();
  const idempotencyKey = randomUUID();   // minted at render: a double submit of THIS review is one placement
  const money = (minor: string) => (preview ? moneyText(minor, preview.currencyCode, lang) : null) ?? t.t('money.unavailable');
  const money2 = readMoneyRefusal(status);
  const lineRefusal: CartRefusal | null = previewRefusal ? (() => { const r = refusalOf(previewRefusal.code, previewRefusal.details); return r === 'failed' || r === 'not_a_number' ? null : r; })() : null;
  const previewMoneyRefusal = previewRefusal?.code === 'MIXED_CURRENCY' ? 'mixed_currency' : previewRefusal?.code === 'CHARGE_METHOD_UNSUPPORTED' ? 'charge_method' : null;
  const sellers = preview?.sellers ?? [];
  const couponNotice = state.coupon && preview && BigInt(preview.discountMinor) <= 0n ? couponNoticeKey(previewCouponOutcome(preview)) : null;
  return (
    <div className="kv-checkout__step" data-kv-step-body="review">
      {/* the named states of W285 */}
      {status === 'stock' && (
        <div className="kv-form__error" role="alert" data-kv-refused="stock">
          <p>{available ? t.t('store2c.refused.stockN', { available }) : t.t(moneyRefusalKey('stock'))}</p>
          <p><Link href={cartHref(slug)} className="kv-link">{t.t('store2c.reduceInCart')}</Link></p>
        </div>
      )}
      {money2 && money2 !== 'stock' && <p className="kv-form__error" role="alert" data-kv-refused={money2}>{t.t(moneyRefusalKey(money2))}</p>}
      {previewMoneyRefusal && <p className="kv-form__error" role="alert" data-kv-refused={previewMoneyRefusal}>{t.t(moneyRefusalKey(previewMoneyRefusal))}</p>}
      {status === 'banned' && <p className="kv-form__error" role="alert" data-kv-refused="banned">{t.t('cart.refused.banned', { region: (region ?? '').slice(0, 80) || t.t('checkout.regionUnknown') })}</p>}
      {status === 'err' && <p className="kv-form__error" role="alert">{t.t('store2c.placeError')}</p>}
      {lineRefusal && (
        // a line problem (the price changed — both numbers —, below the minimum, sold out, …) is shown on the line itself, in this store's cart
        <p className="kv-form__error" role="alert" data-kv-refused={lineRefusal}>{t.t('checkout.resolveInCart')} <Link href={cartHref(slug, { status: lineRefusal })} className="kv-link">{t.t('checkout.backToCart')}</Link></p>
      )}

      {sellers.map((s, i) => (
        <article key={s.sellerUserId} className="kv-confirm__order" data-kv-seller-block={i + 1}>
          <h2 className="kv-checkout__orderno">{t.t('store2c.review.orderOf', { n: String(i + 1), count: String(sellers.length), org })}</h2>
          <ul className="kv-confirm__items">
            {s.items.map((it) => (
              <li key={it.listingId} className="kv-confirm__item" data-kv-line={it.listingId}>
                <span>{t.t('store2c.review.line', { title: it.title, qty: String(it.quantity), unit: it.unitCode, price: money(it.unitPriceMinor) })}</span>
                <span>{money(it.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
          <BillRowsView bill={billRows({ currencyCode: preview!.currencyCode, subtotalMinor: s.subtotalMinor, deliveryFeeMinor: s.deliveryFeeMinor, discountMinor: s.discountMinor,
            platformFeeMinor: s.platformFeeMinor, buyerCommissionMinor: s.buyerCommissionMinor, totalMinor: s.totalMinor, deliveryNeedsAddress: preview!.deliveryNeedsAddress })} />
          {onlinePayments && sellers.length > 1 && <p className="kv-detail__muted" data-kv-paid-separately="">{t.t('store2c.review.paidSeparately')}</p>}
        </article>
      ))}
      {preview && sellers.length > 1 && (
        <p className="kv-cart__subtotal" data-kv-grand=""><span>{t.t('store2c.review.allOrders', { count: String(sellers.length) })}</span> <strong>{money(preview.grandTotalMinor)}</strong></p>
      )}

      <form action={applyCouponAction} className="kv-checkout__coupon-form" data-kv-form="coupon">
        <input type="hidden" name="slug" value={slug} />
        <label htmlFor="coupon" className="kv-field__label">{t.t('checkout.couponLabel')}</label>
        <div className="kv-checkout__coupon-row">
          <input id="coupon" name="coupon" type="text" maxLength={40} defaultValue={state.coupon ?? ''} className="kv-field__input kv-checkout__coupon" autoCapitalize="characters" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('checkout.couponApply')}</button>
        </div>
        {couponNotice && <p className="kv-form__notice" role="status">{t.t(couponNotice)}</p>}
      </form>

      <p className="kv-cart__note" data-kv-snapshot="">{t.t('store2c.review.snapshot')}</p>
      {preview?.qualityWindowHours !== undefined && <p className="kv-cart__note" data-kv-quality-window="">{t.t('store2c.review.qualityWindow', { hours: String(preview.qualityWindowHours) })}</p>}
      {onlinePayments ? (
        <>
          <p className="kv-cart__note" data-kv-processed-by="">{t.t('store2c.review.processedBy', { platform: PLATFORM_BRAND.name })}</p>
          <p className="kv-cart__note">{t.t('store2c.escrow')}</p>
          <p className="kv-cart__note">{t.t('store2c.refund.true')}</p>
          <p className="kv-cart__note" data-kv-pay-via={state.pay ?? 'online'}>{t.t(state.pay === 'wallet' ? 'store2c.review.viaWallet' : 'store2c.review.viaOnline')}</p>
        </>
      ) : <p className="kv-cart__note">{t.t('store2c.pay.offLine')}</p>}

      <form action={placeOrderAction} className="kv-checkout__form" data-kv-form="place">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {preview && !lineRefusal && !previewMoneyRefusal && <SubmitButton idle={t.t('checkout.placeOrder')} busy={t.t('checkout.placing')} />}
        <p className="kv-field__hint">{t.t('store2c.review.lockNote')}</p>
        <Link href={cartHref(slug)} className="kv-btn--link">{t.t('checkout.backToCart')}</Link>
      </form>
      <RefusalList surface="checkout-review" />
    </div>
  );
}
