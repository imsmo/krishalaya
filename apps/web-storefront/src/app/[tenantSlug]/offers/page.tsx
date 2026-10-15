// apps/web-storefront/src/app/[tenantSlug]/offers/page.tsx · PC-56 STORE-3b · C1 / C2 — canon W293 "My offers", under the ORGANISATION's chrome
// (one store per session; the platform's /offers is a door — lib/store-door.ts). PROTECTED + dynamic. FLAG-AWARE (survey F-11): the store's
// `offers` flag is read FIRST — OFF → the honest "offers are not open in this store" state and NO offers call (it would 404).
//   • status chips (all + the six statuses the machine has — E9) with the API's BOUNDED counts (`offers.counts()`; past the cap "(n+)"), the
//     current chip from `?status=`;
//   • each row: the listing title · quantity + unit, the ORGANISATION (never a farmer), whose price is on the table ("you offered …" / "the
//     organisation countered …"), whose turn, the round, "respond by" while it is negotiable, the SERVER's value (`offerValueMinor` — no client
//     arithmetic), the status label, "became an order → <status>" (a link to the order) for a converted row, "declined — <reason>", and
//     "Offer again" on an expired / declined row (a chain-form to the listing's offer form, pre-filled — DELTA vs the FM's "filter");
//   • money in the DATA's currency with its own exponent (Rule Zero — no fallback currency); keyset Next only (DELTA);
//   • empty → "Find a listing" (→ the store) and the refusals; a load error is NOT an empty list — said, with a Retry that reloads (W3124–W3126
//     DECOR).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { ListingOffer, OfferCounts, StorefrontFlags } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { moneyText } from '../../../features/discovery/money';
import { reloadHref } from '../../../features/home/load-result';
import { orderStatusKey } from '../../../features/store3a/order-status';
import {
  readOfferTab, offersHref, offerHref, orderHref, offerTabs, tabCountForm, offerStatusKey, offerStatusTone, onTable, isNegotiable, offersAgain,
  offerAgainHref, declineReasonKey,
} from '../../../features/store3b/offers';
import { RefusalList } from '../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('offers.title'), robots: { index: false, follow: false } };
}

export default async function TenantOffersPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const tab = readOfferTab(searchParams.status);
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor.slice(0, 512) : undefined;
  await requireSession(offersHref(slug, tab));
  const t = getTranslator();
  const lang = getLang();

  // THE FLAG FIRST (F-11): an OFF store never calls the offers API
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.offers !== true) {
    return (
      <section className="kv-offers" data-kv-store={slug} data-kv-state="offers-off">
        <h1>{t.t('offers.title')}</h1>
        <div className="kv-state" role="status" data-kv-state="flag-off">
          <p><strong>{t.t('store3b.off.title')}</strong></p>
          <p>{t.t('store3b.off.body')}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-cta="browse">{t.t('store3b.list.find')}</Link>
        </div>
      </section>
    );
  }

  const api = serverClient(slug);
  let counts: OfferCounts | null = null;
  let items: ListingOffer[] = [];
  let nextCursor: string | null = null;
  let failed = flags === null;
  if (!failed) {
    try { counts = await api.offers.counts(); } catch { counts = null; }
    try {
      const page = await api.offers.list({ box: 'outgoing', status: tab === 'all' ? undefined : tab, cursor, limit: 20 });
      items = page.items; nextCursor = page.nextCursor;
    } catch { failed = true; }
  }

  const tabs = offerTabs(slug, tab, counts);
  const head = (
    <>
      <h1>{t.t('offers.title')}</h1>
      <p className="kv-detail__muted">{t.t('store3b.list.lead')}</p>
      <nav className="kv-tabs" aria-label={t.t('store3b.tabs.label')} data-kv-tabs="offers">
        <ul className="kv-tabs__list">
          {tabs.map((x) => {
            const c = x.count ? tabCountForm(x.count) : null;
            return (
              <li key={x.tab}>
                <Link href={x.href} className={x.current ? 'kv-tab kv-tab--current' : 'kv-tab'} aria-current={x.current ? 'page' : undefined} data-kv-tab={x.tab}>
                  {t.t(x.labelKey)}
                  {c && <span className="kv-tab__count" data-kv-count={x.tab} data-kv-capped={String(x.count!.capped)}> {t.t(c.key, { n: formatNumber(c.n, lang) })}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );

  if (failed) {
    return (
      <section className="kv-offers" data-kv-store={slug}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3b.list.error')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/offers`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="offers" />
      </section>
    );
  }

  const money = (minor: string | null | undefined, cur: string | null | undefined) => moneyText(minor ?? null, cur ?? null, lang) ?? t.t('money.unavailable');
  return (
    <section className="kv-offers" data-kv-store={slug} data-kv-tab={tab}>
      {head}
      {items.length === 0 ? (
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t(tab === 'all' ? 'store3b.list.empty' : 'store3b.list.emptyTab')}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-cta="find">{t.t('store3b.list.find')}</Link>
        </div>
      ) : (
        <ul className="kv-orders__list" aria-label={t.t('offers.listCaption')}>
          {items.map((o) => {
            const unit = o.unitCode ?? '';
            const qty = formatNumber(Number(o.quantity), lang);
            const theirs = onTable(o.round) === 'theirs';
            return (
              <li key={o.offerId} className="kv-orders__row" data-kv-offer={o.offerId} data-kv-status={o.status}>
                <Link href={offerHref(slug, o.offerId)} className="kv-link kv-orders__title">
                  {t.t('store3b.row.lot', { title: o.listingTitle ?? t.t('store3b.row.untitled'), qty, unit })}
                </Link>
                {o.organisation && <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('checkout.soldBy', { org: o.organisation.name })}</p>}
                <p data-kv-table={theirs ? 'theirs' : 'yours'}>
                  {theirs
                    ? t.t('store3b.row.orgCountered', { price: money(o.counterPriceMinor, o.currencyCode), unit })
                    : t.t('store3b.row.youOffered', { price: money(o.offeredPriceMinor, o.currencyCode), unit, qty })}
                  {' · '}{t.t('store3b.row.round', { n: formatNumber(o.round, lang) })}
                  {isNegotiable(o.status) && <> · <span data-kv-turn={o.yourTurn ? 'yours' : 'theirs'}>{t.t(o.yourTurn ? 'store3b.row.yourTurn' : 'store3b.row.theirTurn')}</span></>}
                </p>
                {isNegotiable(o.status) && o.respondBy && (
                  <p className="kv-detail__muted" data-kv-respond-by={o.offerId}>{t.t('store3b.row.respondBy', { date: formatDate(String(o.respondBy), lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
                )}
                <p>
                  <span className={`kv-chip kv-chip--${offerStatusTone(o.status)}`} data-kv-chip={o.status}>{t.t(offerStatusKey(o.status))}</span>{' '}
                  {o.offerValueMinor && <strong data-kv-money={o.currencyCode ?? 'unknown'} data-kv-value="server">{t.t('store3b.row.value', { amount: money(o.offerValueMinor, o.currencyCode) })}</strong>}
                </p>
                {o.status === 'converted' && o.convertedOrderId && (
                  <p data-kv-converted={o.convertedOrderId}>
                    <Link href={orderHref(slug, o.convertedOrderId)} className="kv-link">
                      {o.convertedOrderStatus ? t.t('store3b.row.becameOrder', { status: t.t(orderStatusKey(o.convertedOrderStatus)) }) : t.t('store3b.row.becameOrderPlain')}
                    </Link>
                  </p>
                )}
                {o.status === 'rejected' && o.declineReasonCode && (
                  <p className="kv-detail__muted" data-kv-declined={o.declineReasonCode}>
                    {t.t(o.declinedBy === 'buyer' ? 'store3b.row.youDeclined' : 'store3b.row.orgDeclined', { reason: t.t(declineReasonKey(o.declineReasonCode)) })}
                  </p>
                )}
                {offersAgain(o.status) && (
                  <p><Link href={offerAgainHref(slug, o.listingId, o.quantity, o.currentPriceMinor ?? o.offeredPriceMinor, o.currencyCode)} className="kv-btn--link" data-kv-offer-again={o.offerId}>{t.t('store3b.row.offerAgain')}</Link></p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor && <p><Link href={offersHref(slug, tab, nextCursor)} className="kv-btn--link" rel="next">{t.t('discover.nextPage')}</Link></p>}
      <RefusalList surface="offers" />
    </section>
  );
}
