// apps/web-storefront/src/app/[tenantSlug]/offers/[id]/page.tsx · PC-56 STORE-3b · C3 — canon W294 "Offer thread" and the response chain W3121
// (confirm) / W3122 (success) / W3123 (failure), under the ORGANISATION's chrome. PROTECTED + dynamic. FLAG-AWARE (F-11): the store's `offers`
// flag first — OFF → the honest state, no offers call. A stranger's id → notFound() (the API answers 404).
//   • H1 "<title> · <qty> <unit> · <status> · round N"; "listed at <price> per <unit> · <available> available" from the PUBLIC listing read
//     (2a) and the organisation's page; the organisation, never a person;
//   • THE THREAD = the API's `rounds` in order (0211; round 1 synthesised for an offer made before it): who (you / the organisation / the
//     clock), the round, the time, the per-unit price — never a name, never a note (founder D3 — refused by name);
//   • "The numbers": the list price, your offer, their counter, and the SERVER's value now (`offerValueMinor` — no client arithmetic);
//   • THE CLOCK FROM THE READ (founder D1): "respond by <respondBy> (<roundTtlHours> h per round; the negotiation ends by <maxLifeEndsAt>)";
//   • THE ACTS ONLY ON THE BUYER'S TURN (`yourTurn` + `allowedActs` — features/store3b/offers.ts `actsFor`, fail-closed): Accept / Counter /
//     Decline, each through a server-rendered confirm (`?act=`) with a key minted when it renders and reused on Retry, plus "or do nothing — it
//     lapses at <respondBy>" (founder D4: no lapse button). The ACCEPT confirm says what it creates (<qty> <unit> at <price> = <value>), the
//     regime (founder D2: arranged with the organisation, no delivery charge), the fees as checkout states them, and that the quantity is
//     RESERVED when you accept. The COUNTER confirm parses the typed price with the LISTING's exponent. The DECLINE confirm has the six reasons;
//   • SUCCESS (W3122): accepted → "your order is being created" + Refresh → the order link once the relay converted it; countered → the new
//     round + its respond-by; declined → the reason. FAILURE (W3123) by name (not your turn · expired · not negotiable · stock short {available}
//     · listing / organisation unavailable · max life · invalid price · reason · flag off · concurrency → Retry with the same key);
//   • "Message seller" REMOVED (founder D6) and refused by name with the mandi / AI hint / farmer's name / notes / checkout-from-offer claims.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import { formatNumber } from '@krishalaya/i18n';
import type { ListingOffer, PublicListingDetail, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { orderStatusKey } from '../../../../features/store3a/order-status';
import {
  offerHref, offersHref, orderHref, offerStatusKey, offerStatusTone, actsFor, readAct, isNegotiable, conversionView, roundKey, counterMinor,
  OFFER_DECLINE_REASON_LIST, declineReasonKey, readDeclineReason, readFailure, readAvailable, readOfferOk, offerActKey, ACT_KEY, offersAgain,
  offerAgainHref, type OfferActName,
} from '../../../../features/store3b/offers';
import { when } from '../../../../components/OrderTimeline';
import { RefusalList } from '../../../../components/RefusalList';
import { SubmitButton } from '../../../../components/SubmitButton';
import { acceptOfferAction, counterOfferAction, declineOfferAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('offers.detailTitle'), robots: { index: false, follow: false } };
}

export default async function TenantOfferThread({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const self = offerHref(slug, params.id);
  await requireSession(self);
  const t = getTranslator();
  const lang = getLang();

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.offers !== true) {
    return (
      <section className="kv-offer" data-kv-store={slug} data-kv-state="offers-off">
        <h1>{t.t('offers.detailTitle')}</h1>
        <div className="kv-state" role="status" data-kv-state="flag-off">
          <p><strong>{t.t('store3b.off.title')}</strong></p>
          <p>{t.t('store3b.off.body')}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-cta="browse">{t.t('store3b.list.find')}</Link>
        </div>
      </section>
    );
  }

  let offer: ListingOffer | null = null;
  if (flags !== null) {
    try { offer = await serverClient(slug).offers.get(params.id); }
    catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); offer = null; }
  }
  if (!offer) {
    return (
      <section className="kv-offer" data-kv-store={slug}>
        <h1>{t.t('offers.detailTitle')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3b.thread.error')}</p>
          <a href={reloadHref(self, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          <Link href={offersHref(slug)} className="kv-btn--link">{t.t('offers.back')}</Link>
        </div>
        <RefusalList surface="offer" />
      </section>
    );
  }

  // the PUBLIC listing read (2a) — the list price and what is available now; best-effort (an off-sale lot simply has no "listed at" line)
  let listing: PublicListingDetail | null = null;
  try { listing = await publicClient(slug).listings.getPublic(offer.listingId); } catch { listing = null; }

  const cur = offer.currencyCode ?? null;
  const unit = offer.unitCode ?? listing?.unitCode ?? '';
  const qty = formatNumber(Number(offer.quantity), lang);
  const money = (minor: string | null | undefined, c: string | null = cur) => moneyText(minor ?? null, c, lang) ?? t.t('money.unavailable');
  const acts = actsFor(offer);
  const act = readAct(searchParams.act);
  const showing: OfferActName | null = act && acts.includes(act) ? act : null;
  const failure = readFailure(searchParams.error);
  const available = readAvailable(searchParams.av);
  const ok = readOfferOk(searchParams.ok);
  const conv = conversionView(offer);
  const k = one(searchParams.k);
  const keyFor = (a: OfferActName) => (k && ACT_KEY.test(k) ? k : offerActKey(a, offer!.offerId, randomUUID()));
  const typedPrice = (one(searchParams.price) ?? '').slice(0, 24);
  const counterParsed = typedPrice ? counterMinor(typedPrice, cur) : null;
  const keptReason = readDeclineReason(searchParams.r);
  const respondBy = offer.respondBy ? when(String(offer.respondBy), lang) : null;
  const endsBy = offer.maxLifeEndsAt ? when(String(offer.maxLifeEndsAt), lang) : null;
  const regime = <p className="kv-detail__muted" data-kv-regime="offer">{t.t('store3b.regime')}</p>;
  const failureLine = failure && (
    <div className="kv-form__error" role="alert" data-kv-failure={failure}>
      <p>{failure === 'stock_short' && available ? t.t('store3b.err.stock_short', { available: formatNumber(Number(available), lang), unit }) : t.t(`store3b.err.${failure}`)}</p>
    </div>
  );

  return (
    <section className="kv-offer" data-kv-store={slug} data-kv-offer={offer.offerId} data-kv-status={offer.status} data-kv-your-turn={String(offer.yourTurn === true)}>
      <h1>
        {t.t('store3b.thread.h1', { title: offer.listingTitle ?? t.t('store3b.row.untitled'), qty, unit })}{' · '}
        <span className={`kv-chip kv-chip--${offerStatusTone(offer.status)}`} data-kv-chip={offer.status}>{t.t(offerStatusKey(offer.status))}</span>
        {' · '}{t.t('store3b.row.round', { n: formatNumber(offer.round, lang) })}
      </h1>
      {listing && (
        <p className="kv-detail__muted" data-kv-listed="public">
          {t.t('store3b.thread.listedAt', { price: money(listing.priceMinor, listing.currencyCode), unit: listing.unitCode, available: formatNumber(listing.quantityAvailable, lang) })}
        </p>
      )}
      {offer.organisation && (
        <p className="kv-detail__muted" data-kv-seller="organisation">
          {t.t('checkout.soldBy', { org: offer.organisation.name })} · <Link href={`/${encodeURIComponent(slug)}/sellers`} className="kv-link" data-kv-org-link="sellers">{t.t('store3b.thread.aboutOrg')}</Link>
        </p>
      )}

      {ok && <p className="kv-form__notice" role="status" data-kv-ok={ok}>{t.t(`store3b.ok.${ok}`)}</p>}
      {/* W3123 when no act can be shown any more (the turn moved, it lapsed, it was answered): the named failure still prints */}
      {acts.length === 0 && failureLine}

      {/* W3122 — the accepted offer's order */}
      {conv?.kind === 'creating' && (
        <div className="kv-state" role="status" data-kv-conversion="creating">
          <p><strong>{t.t('store3b.conversion.creating')}</strong></p>
          <p><a href={self} className="kv-btn" data-kv-refresh="conversion">{t.t('store3b.conversion.refresh')}</a></p>
          {regime}
        </div>
      )}
      {conv?.kind === 'converted' && (
        <div className="kv-state" role="status" data-kv-conversion="converted">
          <p>
            <Link href={orderHref(slug, conv.orderId)} className="kv-btn" data-kv-order-link={conv.orderId}>
              {offer.convertedOrderStatus ? t.t('store3b.row.becameOrder', { status: t.t(orderStatusKey(offer.convertedOrderStatus)) }) : t.t('store3b.row.becameOrderPlain')}
            </Link>
          </p>
          {regime}
        </div>
      )}
      {offer.status === 'rejected' && (
        <p className="kv-detail__muted" data-kv-declined={offer.declineReasonCode ?? 'none'}>
          {offer.declineReasonCode
            ? t.t(offer.declinedBy === 'buyer' ? 'store3b.row.youDeclined' : 'store3b.row.orgDeclined', { reason: t.t(declineReasonKey(offer.declineReasonCode)) })
            : t.t('store3b.thread.declinedNoReason')}
        </p>
      )}
      {offer.status === 'expired' && <p className="kv-detail__muted" data-kv-expired={offer.offerId}>{t.t('store3b.thread.lapsed', { date: when(String(offer.expiresAt), lang) })}</p>}
      {offersAgain(offer.status) && (
        <p><Link href={offerAgainHref(slug, offer.listingId, offer.quantity, offer.currentPriceMinor ?? offer.offeredPriceMinor, cur)} className="kv-btn--link" data-kv-offer-again={offer.offerId}>{t.t('store3b.row.offerAgain')}</Link></p>
      )}

      <section className="kv-order__section" aria-labelledby="thread-h" data-kv-thread="rounds">
        <h2 id="thread-h">{t.t('store3b.thread.title')}</h2>
        <ol className="kv-timeline">
          {(offer.rounds ?? []).map((r, i) => (
            <li key={`${r.round}-${r.act}-${i}`} data-kv-round={r.round} data-kv-act={r.act} data-kv-party={r.party}>
              {t.t(roundKey(r), { n: formatNumber(r.round, lang) })}
              {' · '}<time dateTime={r.at}>{when(r.at, lang)}</time>
              {r.priceMinor && <> · {t.t('store3b.thread.perUnit', { price: money(r.priceMinor), unit })}</>}
            </li>
          ))}
        </ol>
      </section>

      <aside className="kv-order__section" aria-labelledby="numbers-h" data-kv-numbers="server">
        <h2 id="numbers-h">{t.t('store3b.numbers.title')}</h2>
        <ul className="kv-detail__facts">
          {listing && <li data-kv-number="list">{t.t('store3b.numbers.list', { price: money(listing.priceMinor, listing.currencyCode), unit })}</li>}
          <li data-kv-number="yours">{t.t('store3b.numbers.yours', { price: money(offer.offeredPriceMinor), unit })}</li>
          {offer.counterPriceMinor && <li data-kv-number="theirs">{t.t('store3b.numbers.theirs', { price: money(offer.counterPriceMinor), unit })}</li>}
          {offer.offerValueMinor && <li data-kv-number="value"><strong>{t.t('store3b.numbers.value', { qty, unit, amount: money(offer.offerValueMinor) })}</strong></li>}
        </ul>
      </aside>

      {isNegotiable(offer.status) && respondBy && (
        <p className="kv-detail__muted" data-kv-clock="read">
          {t.t(offer.yourTurn ? 'store3b.clock.yours' : 'store3b.clock.theirs', { date: respondBy })}{' '}
          {t.t('store3b.clock.rule', { hours: formatNumber(offer.roundTtlHours ?? 0, lang), ends: endsBy ?? t.t('money.unavailable') })}
        </p>
      )}

      {acts.length > 0 && (
        <section className="kv-order__section" aria-labelledby="respond-h" data-kv-acts={acts.join(' ')}>
          <h2 id="respond-h">{t.t('store3b.acts.title')}</h2>
          {showing === null && (
            <>
              {failureLine}
              <ul className="kv-cart__actions">
                {acts.map((a) => <li key={a}><Link href={offerHref(slug, offer!.offerId, { act: a })} className={a === 'accept' ? 'kv-btn' : 'kv-btn kv-btn--ghost'} data-kv-act-start={a}>{t.t(`store3b.acts.${a}`)}</Link></li>)}
              </ul>
              {respondBy && <p className="kv-detail__muted" data-kv-lapse="copy">{t.t('store3b.acts.lapse', { date: respondBy })}</p>}
            </>
          )}

          {showing === 'accept' && (
            <form action={acceptOfferAction} className="kv-form" data-kv-confirm="accept">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={offer.offerId} />
              <input type="hidden" name="key" value={keyFor('accept')} />
              {failureLine}
              <p><strong>{t.t('store3b.accept.creates', { qty, unit, price: money(offer.currentPriceMinor ?? null), amount: money(offer.offerValueMinor ?? null) })}</strong></p>
              {regime}
              <p className="kv-detail__muted" data-kv-fees="as-checkout">{t.t('store3b.accept.fees')}</p>
              <p className="kv-detail__muted" data-kv-reserve="on-accept">{t.t('store3b.accept.reserved')}</p>
              <SubmitButton idle={t.t('store3b.accept.yes')} busy={t.t('store3b.busy')} />{' '}
              <Link href={self} className="kv-btn--link">{t.t('store3b.notNow')}</Link>
            </form>
          )}

          {showing === 'counter' && (counterParsed === null ? (
            <form method="get" action={self} className="kv-form" data-kv-counter="price">
              <input type="hidden" name="act" value="counter" />
              {(failure === 'invalid_price' || (typedPrice && counterParsed === null)) && (
                <div className="kv-form__error" role="alert" data-kv-failure="invalid_price"><p>{t.t('store3b.err.invalid_price')}</p></div>
              )}
              {failure && failure !== 'invalid_price' && failureLine}
              <label htmlFor="counter-price" className="kv-form__label">{t.t('store3b.counter.label', { unit })}</label>
              <input id="counter-price" name="price" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" defaultValue={typedPrice} required />
              <button type="submit" className="kv-btn">{t.t('store3b.counter.review')}</button>{' '}
              <Link href={self} className="kv-btn--link">{t.t('store3b.notNow')}</Link>
            </form>
          ) : (
            <form action={counterOfferAction} className="kv-form" data-kv-confirm="counter">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={offer.offerId} />
              <input type="hidden" name="key" value={keyFor('counter')} />
              <input type="hidden" name="price" value={typedPrice} />
              {failureLine}
              <p><strong data-kv-counter-price={counterParsed}>{t.t('store3b.counter.confirm', { price: money(counterParsed), unit, qty })}</strong></p>
              <p className="kv-detail__muted">{t.t('store3b.counter.clock', { hours: formatNumber(offer.roundTtlHours ?? 0, lang) })}</p>
              <SubmitButton idle={t.t('store3b.counter.yes')} busy={t.t('store3b.busy')} />{' '}
              <Link href={offerHref(slug, offer.offerId, { act: 'counter', price: typedPrice })} className="kv-btn--link">{t.t('store3b.counter.change')}</Link>
            </form>
          ))}

          {showing === 'decline' && (
            <form action={declineOfferAction} className="kv-form" data-kv-confirm="decline">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={offer.offerId} />
              <input type="hidden" name="key" value={keyFor('decline')} />
              {failureLine}
              <fieldset className="kv-form__fieldset">
                <legend className="kv-form__label">{t.t('store3b.decline.reason')}</legend>
                {OFFER_DECLINE_REASON_LIST.map((r) => (
                  <label key={r} className="kv-radio" data-kv-reason={r}>
                    <input type="radio" name="reason" value={r} required defaultChecked={r === keptReason} /> {t.t(declineReasonKey(r))}
                  </label>
                ))}
              </fieldset>
              <p className="kv-detail__muted">{t.t('store3b.decline.noNote')}</p>
              <SubmitButton idle={t.t('store3b.decline.yes')} busy={t.t('store3b.busy')} />{' '}
              <Link href={self} className="kv-btn--link">{t.t('store3b.notNow')}</Link>
            </form>
          )}
        </section>
      )}
      {acts.length === 0 && isNegotiable(offer.status) && (
        <div data-kv-acts="none">
          <p className="kv-detail__muted" data-kv-waiting="organisation">{t.t('store3b.thread.waiting')}</p>
        </div>
      )}

      {!conv && isNegotiable(offer.status) && regime}
      <p className="kv-detail__muted" data-kv-one-key="per-act">{t.t('store3b.thread.oneKey')}</p>
      <p><Link href={offersHref(slug)} className="kv-btn--link">{t.t('offers.back')}</Link></p>
      <RefusalList surface="offer" />
    </section>
  );
}
