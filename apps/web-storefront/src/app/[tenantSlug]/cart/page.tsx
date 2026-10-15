// apps/web-storefront/src/app/[tenantSlug]/cart/page.tsx · PC-56 STORE-2b · C1 — canon W281, THE ORGANISATION'S CART, under its own header
// (founder D3: the tenant's cart lives at /<slug>/cart under the TenantHeader, "Powered by Krishalaya" per the 13d rule; ONE store per session).
// Dynamic and server-rendered; every act is a Server Action (no client JS); the chain's states live in the URL (features/store2b/cart.ts):
//   • H1 "Your cart — <org>"; the canon's "you have 1 more cart" refused by name (one store per session);
//   • each line: the photo (the signed media route, as the listing page has), the title → the listing, "<org> · <district> · min order N <unit> ·
//     M <unit> available" (the organisation, never a farmer), the quantity field (decimal, 3 places) + Update — its form-error re-renders THIS
//     line with the named refusal and the typed value kept (W3041), success re-renders it with a notice (W3043), failure is named (W3044);
//   • a changed price: BOTH numbers and the server's delta ("<added> → <current> (+<diff>)") + Accept (a confirm with both numbers — the money
//     decision) + Remove; a line that cannot be bought says WHY by name (sold out — the organisation says so · paused · expired · withdrawn ·
//     the seller is suspended · licence required to buy — no buyer licence flow exists) + Remove; Remove is a confirm ("you can add it
//     again") — W3045 / W3046 / W3047;
//   • "Resolve N items to continue" is an anchor to the first problem line and REPLACES the checkout link while any line cannot be bought, is
//     below its minimum, above what is available, or has a price not yet re-agreed;
//   • the summary = the items subtotal ONLY + "delivery, fees and taxes are quoted at checkout" (the canon's delivery estimate, slabs, minimum
//     per shipment, GST on delivery and "prices include GST" refused by name); "Cart never charges anything" + "double-taps can't double-pay"
//     (true — kept);
//   • states: empty (→ THIS store's browse, not /), error ≠ empty with Retry = reload, buying paused (D2), sign-in required (no guest cart),
//     signed in to ANOTHER organisation (D3 — the sentence and both links), refusals printed (RefusalList surface "cart").
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Cart, CartItem, GalleryItem, StorefrontFlags, StorefrontTenant } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, serverClient, sessionTenantClient } from '../../../lib/api-client';
import { resolveSessionToken } from '../../../lib/session';
import { getSessionTenant } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { loadTenantShell } from '../../../lib/storefront-data';
import { moneyText } from '../../../features/discovery/money';
import { reloadHref } from '../../../features/home/load-result';
import { cartChain, cartHref, driftView, lineAnchor, lineProblems, qtyText, refusalKey, resolveState, type CartChain } from '../../../features/store2b/cart';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList, CartOff } from '../../../components/RefusalList';
import { updateCartLineAction, removeCartLineAction, acceptPriceAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('cart.title'), robots: { index: false, follow: false } };
}

/** The first signed photo of a lot (the listing page's own route); none → no image (never a placeholder). */
async function photoOf(slug: string, id: string): Promise<string | null> {
  try { const g: GalleryItem[] = await publicClient(slug).listings.media(id); return g[0]?.url ?? null; } catch { return null; }
}

export default async function TenantCart({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const self = cartHref(slug);
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;
  const chain = cartChain(searchParams);
  const head = <h1 data-kv-cart-org={slug}>{t.t('cart.titleOrg', { org })}</h1>;

  // SIGN-IN REQUIRED: there is no guest cart — sign in to THIS store to see it (the canon's "guest cart on this device" refused by name)
  const token = await resolveSessionToken();
  if (!token) {
    return (
      <section className="kv-cart">
        {head}
        <div className="kv-state" role="status" data-kv-state="signin">
          <p>{t.t('cart.signinRequired', { org })}</p>
          <a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-btn">{t.t('cart.signinCta', { org })}</a>
        </div>
        <RefusalList surface="cart" />
      </section>
    );
  }

  // D3 · ONE STORE PER SESSION: signed in to another organisation → say so, with both doors (never another store's cart under this name)
  const sessionTenant = getSessionTenant();
  if (shell.kind === 'ok' && sessionTenant && sessionTenant !== shell.tenant.tenantId) {
    let home: StorefrontTenant | null = null;
    try { home = await sessionTenantClient().storefront.tenant(); } catch { home = null; }
    return (
      <section className="kv-cart">
        {head}
        <div className="kv-state" role="status" data-kv-state="wrong-store">
          <p>{home ? t.t('cart.otherStore', { current: home.displayName, store: org }) : t.t('cart.otherStoreUnknown', { store: org })}</p>
          <a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-btn" data-kv-signin="store">{t.t('cart.signinCta', { org })}</a>
          {home?.slug && <p><a href={cartHref(home.slug)} className="kv-btn--link" data-kv-home-cart={home.slug}>{t.t('cart.yourCartAt', { org: home.displayName })}</a></p>}
        </div>
        <RefusalList surface="cart" />
      </section>
    );
  }

  // D2 · buying paused (the flags read first: the SDK retries a 5xx, so a page asks the switch before it asks the cart)
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags && flags.storefront_cart === false) {
    return <section className="kv-cart">{head}<CartOff /><RefusalList surface="cart" /></section>;
  }

  let cart: Cart | null = null; let off = false;
  try { cart = await serverClient(slug).cart.get(); } catch (e) { off = e instanceof SdkError && e.code === 'STOREFRONT_CART_OFF'; cart = null; }
  if (off) return <section className="kv-cart">{head}<CartOff /><RefusalList surface="cart" /></section>;
  if (!cart) {
    // ERROR ≠ EMPTY: said, with Retry = a reload of this URL (the canon's "changes stay saved on this phone" refused — nothing is on the phone)
    return (
      <section className="kv-cart">
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('cart.loadErrorServer')}</p>
          <a href={reloadHref(self, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="cart" />
      </section>
    );
  }

  const notice = noticeOf(chain);
  if (cart.items.length === 0) {
    return (
      <section className="kv-cart kv-empty-state">
        {head}
        {notice && <p className="kv-form__notice" role="status" data-kv-notice={notice}>{t.t(notice)}</p>}
        <div className="kv-empty" data-kv-state="empty">
          <p>{t.t('cart.emptyOrg', { org })}</p>
          <a href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-browse="store">{t.t('cart.browseStore', { org })}</a>
        </div>
        <RefusalList surface="cart" />
      </section>
    );
  }

  const photos = await Promise.all(cart.items.map((l) => photoOf(slug, l.listingId)));
  const resolve = resolveState(cart);
  const unavailable = t.t('money.unavailable');

  return (
    <section className="kv-cart" aria-labelledby="kv-cart-h">
      <h1 id="kv-cart-h" data-kv-cart-org={slug}>{t.t('cart.titleOrg', { org })}</h1>
      {notice && <p className="kv-form__notice" role="status" data-kv-notice={notice}>{t.t(notice)}</p>}
      {chain.status && chain.status !== 'cart_off' && (
        <p className="kv-form__error" role="alert" data-kv-status={chain.status}>{t.t('cart.fromCheckout')} {t.t(`cart.status.${statusGroup(chain.status)}`)}</p>
      )}

      <ul className="kv-cart__list">
        {cart.items.map((item, i) => (
          <CartLine key={item.listingId} item={item} photo={photos[i]} slug={slug} org={org} chain={chain} lang={lang} />
        ))}
      </ul>

      <aside className="kv-cart__foot" aria-labelledby="kv-cart-sum" data-kv-summary="items-only">
        <h2 id="kv-cart-sum">{t.t('cart.summaryTitle')}</h2>
        <p className="kv-cart__subtotal"><span>{t.t('cart.itemsSubtotal')}</span> <strong>{moneyText(cart.subtotalMinor, cart.currencyCode, lang) ?? unavailable}</strong></p>
        <p className="kv-cart__note" data-kv-quoted="checkout">{t.t('cart.quotedAtCheckout')}</p>
        <div className="kv-cart__actions">
          {resolve.blocked > 0
            ? <a href={`#${resolve.first}`} className="kv-btn" data-kv-resolve={String(resolve.blocked)}>{t.t('cart.resolveN', { count: String(resolve.blocked) })}</a>
            : <Link href={`/${encodeURIComponent(slug)}/checkout`} className="kv-btn" data-kv-checkout="go">{t.t('cart.checkout')}</Link>}
        </div>
        <p className="kv-cart__note" data-kv-never-charges="true">{t.t('cart.neverCharges')}</p>
      </aside>

      <RefusalList surface="cart" />
    </section>
  );
}

/** The success notice a chain step leaves (W3043 / W3046) — a sentence, never "audit entry written". */
function noticeOf(c: CartChain): string | null {
  if (c.done === 'updated') return 'cart.done.updated';
  if (c.done === 'removed') return 'cart.done.removed';
  if (c.done === 'accepted') return 'cart.done.accepted';
  return null;
}
/** A checkout refusal that sent the buyer back here, grouped into the sentence that says what to do. */
function statusGroup(s: string): 'price' | 'minimum' | 'line' {
  if (s === 'price_changed') return 'price';
  if (s === 'below_min' || s === 'above_available') return 'minimum';
  return 'line';
}

function CartLine({ item, photo, slug, org, chain, lang }: { item: CartItem; photo: string | null; slug: string; org: string; chain: CartChain; lang: string }) {
  const t = getTranslator();
  const id = item.listingId;
  const anchor = lineAnchor(id);
  const unit = item.unitCode ?? '';
  const sells = item.organisation?.name ?? org;
  const min = item.minOrderQty && item.minOrderQty !== '0.000' ? qtyText(item.minOrderQty) : null;
  const available = item.quantityAvailable ? qtyText(item.quantityAvailable) : null;
  const meta = [
    item.district ? t.t('cart.line.orgDistrict', { org: sells, district: item.district }) : t.t('cart.line.org', { org: sells }),
    ...(min ? [t.t('cart.line.minOrder', { qty: min, unit })] : []),
    ...(available !== null && item.reason == null ? [t.t('cart.line.available', { qty: available, unit })] : []),
  ].join(' · ');
  const reason = item.reason !== undefined ? item.reason : (item.purchasable ? null : 'not_found');
  const drift = reason ? null : driftView(item, lang);
  const problems = lineProblems(item);
  const mine = chain.line === id;
  const kept = mine && chain.step === 'error' ? chain.qty : null;
  const qtyValue = kept ?? qtyText(item.quantityDecimal ?? String(item.quantity));
  const vars = { min: min ?? '', unit, available: available ?? '', store: org, org: sells, region: '' };
  const unavailable = t.t('money.unavailable');
  const price = moneyText(item.currentPriceMinor ?? item.unitPriceMinor, item.currencyCode, lang) ?? unavailable;

  return (
    <li id={anchor} className="kv-cart__row" data-kv-line={id} data-kv-reason={reason ?? 'none'} data-kv-problems={problems.join(' ') || 'none'}>
      {photo && <img className="kv-cart__photo" src={photo} alt={t.t('cart.photoAlt', { title: item.title ?? t.t('cart.untitled') })} loading="lazy" decoding="async" />}
      <div className="kv-cart__info">
        <a href={`/${encodeURIComponent(slug)}/listings/${encodeURIComponent(id)}`} className="kv-cart__title">{item.title ?? t.t('cart.untitled')}</a>
        <span className="kv-cart__unit" data-kv-line-meta="org">{meta}</span>
        <span className="kv-cart__unit">{price} {t.t('cart.perUnitOf', { unit })}</span>

        {mine && chain.done === 'updated' && <span className="kv-form__notice" role="status" data-kv-line-notice="updated">{t.t('cart.done.lineUpdated')}</span>}
        {mine && chain.step === 'error' && chain.err && (
          <span className="kv-form__error" role="alert" data-kv-line-refusal={chain.err}>{t.t(refusalKey(chain.err), vars)}</span>
        )}
        {reason && (
          <div className="kv-cart__reason" role="status" data-kv-line-reason={reason}>
            <p>{t.t(`cart.reason.${reason}`)}</p>
            <a href={cartHref(slug, { step: 'confirm', act: 'remove', line: id }, anchor)} className="kv-btn--link kv-cart__remove" data-kv-act="remove">{t.t('cart.remove')}</a>
          </div>
        )}
        {!reason && item.belowMin && <span className="kv-cart__warn" role="status" data-kv-line-problem="below_min">{t.t('cart.line.belowMin', { qty: min ?? '', unit })}</span>}
        {!reason && item.overAvailable && <span className="kv-cart__warn" role="status" data-kv-line-problem="over_available">{t.t('cart.line.overAvailable', { qty: available ?? '', unit })}</span>}
        {drift && (
          <div className="kv-cart__drift" role="alert" data-kv-drift={id}>
            <p><strong>{t.t('cart.drift.title')}</strong> {t.t('cart.drift.addedAt')} <span data-kv-price="added">{drift.added}</span> <DirArrow /> {t.t('cart.drift.now')} <span data-kv-price="current">{drift.current}</span> {t.t('cart.perUnitOf', { unit })} (<span data-kv-price="delta">{drift.delta}</span>)</p>
            <p>{t.t('cart.drift.body')}</p>
            <p className="kv-cart__actions">
              <a href={cartHref(slug, { step: 'confirm', act: 'accept', line: id }, anchor)} className="kv-btn" data-kv-act="accept">{t.t('cart.drift.accept', { price: drift.current, unit })}</a>
              <a href={cartHref(slug, { step: 'confirm', act: 'remove', line: id }, anchor)} className="kv-btn kv-btn--ghost" data-kv-act="remove">{t.t('cart.remove')}</a>
            </p>
          </div>
        )}

        {/* W3045 · the confirm step, inline on THIS line */}
        {mine && chain.step === 'confirm' && chain.act === 'remove' && (
          <form action={removeCartLineAction} className="kv-cart__confirm" data-kv-confirm="remove">
            <input type="hidden" name="tenantSlug" value={slug} />
            <input type="hidden" name="listingId" value={id} />
            <p>{t.t('cart.confirm.remove', { title: item.title ?? t.t('cart.untitled') })}</p>
            <button type="submit" className="kv-btn">{t.t('cart.confirm.removeYes')}</button>
            <a href={cartHref(slug, {}, anchor)} className="kv-btn--link" data-kv-cancel="remove">{t.t('cart.confirm.cancel')}</a>
          </form>
        )}
        {mine && chain.step === 'confirm' && chain.act === 'accept' && drift && (
          <form action={acceptPriceAction} className="kv-cart__confirm" data-kv-confirm="accept">
            <input type="hidden" name="tenantSlug" value={slug} />
            <input type="hidden" name="listingId" value={id} />
            <input type="hidden" name="expectedPriceMinor" value={item.currentPriceMinor ?? ''} />
            <p>{t.t('cart.confirm.accept', { added: drift.added, current: drift.current, unit })}</p>
            <button type="submit" className="kv-btn">{t.t('cart.drift.accept', { price: drift.current, unit })}</button>
            <a href={cartHref(slug, {}, anchor)} className="kv-btn--link" data-kv-cancel="accept">{t.t('cart.confirm.cancel')}</a>
          </form>
        )}
        {/* W3047 · a named failure of Remove / Accept: the price changed AGAIN (this line now shows the newest two numbers) or the line is gone */}
        {mine && chain.step === 'failure' && chain.err && (
          <span className="kv-form__error" role="alert" data-kv-line-failure={chain.err}>
            {t.t(chain.act === 'accept' && chain.err === 'price_changed' ? 'cart.failure.priceAgain' : refusalKey(chain.err), vars)}
          </span>
        )}
      </div>

      {!reason && (
        <form action={updateCartLineAction} className="kv-cart__qtyform" data-kv-form="quantity">
          <input type="hidden" name="tenantSlug" value={slug} />
          <input type="hidden" name="listingId" value={id} />
          <input type="hidden" name="min" value={item.minOrderQty ?? ''} />
          <input type="hidden" name="available" value={item.quantityAvailable ?? ''} />
          <label htmlFor={`q-${id}`} className="kv-visually-hidden">{t.t('cart.quantityOf', { unit })}</label>
          <input id={`q-${id}`} name="quantity" type="text" inputMode="decimal" defaultValue={qtyValue} className="kv-field__input kv-cart__qty" aria-invalid={kept !== null || undefined} />
          <button type="submit" className="kv-btn--link">{t.t('cart.update')}</button>
        </form>
      )}

      <span className="kv-cart__line" data-kv-line-total={id}>{reason ? '' : (moneyText(item.lineTotalMinor, item.currencyCode, lang) ?? unavailable)}</span>

      {!reason && !drift && !(mine && chain.step === 'confirm') && (
        <a href={cartHref(slug, { step: 'confirm', act: 'remove', line: id }, anchor)} className="kv-btn--link kv-cart__remove" data-kv-act="remove">{t.t('cart.remove')}</a>
      )}
    </li>
  );
}
