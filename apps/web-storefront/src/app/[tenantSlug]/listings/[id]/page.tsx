// apps/web-storefront/src/app/[tenantSlug]/listings/[id]/page.tsx · a single listing detail page. SSR-fetched via
// the SDK (anonymous public read). Money via moneyText from minor-unit strings in the listing's OWN currency (Law 2).
//
// P1-1: the listing photo gallery is served by the dedicated signed endpoint `listings/:id/media` (short-lived presigned GET urls, CLEAN
// assets only, public listings only); an empty/unavailable gallery shows nothing (never a placeholder image).
// P1-2: the detail read exposes NON-PII public links — the farm-to-fork trace `qrToken` and the `auctionId`/status.
// PC-56 HOTFIX-4 · A6/C5 (survey F-7, founder D3): the read is the API's ALLOW-LISTED public projection (`listings.getPublic`), turned into
// a view model that names each field (features/listing/public-view.ts) — no coordinates, pincode, region id or seller person can reach the
// page. The seller is the ORGANISATION (its name + the district).
//
// PC-56 STORE-2a · C3 — canon W277, built on that allow-list:
//   • breadcrumbs Home › category › lot (the category from the public tree); H1 = the title (no vernacular line: no such column);
//   • badges: the CONFIRMED grade "Grade A · graded by <organisation> staff" (founder D2 — an AI suggestion is never in the view, so it can
//     never print; no confidence number, so no Law 7 banner is owed), the organic claim's kind, "Harvested <date>" (a calendar day, the same on
//     every clock), "Traceable lot" ONLY when a trace token exists; the "Licence required to buy" lock from the regulated marker (B5 — shown,
//     never hidden; nothing about enforcement, which is STORE-2b);
//   • the description; the lot's measured ATTRIBUTES in a table (B30); "Where it grew: <district>" only; "Available 34 of 40 qtl";
//     "Minimum order 5 qtl" (printed — enforcement is STORE-2b, nothing is said about it);
//   • the price panel's TRUE sentences: the price per unit, "fees and taxes are shown at checkout" (never "includes platform fee"), no
//     delivery ETA, no per-km; the add-to-cart stepper (decimal quantities accepted — numeric(14,3), the server validates); "Adding to cart
//     doesn't reserve stock"; the escrow sentence ONLY while online payments are ON for the store (OFF = pay on delivery — escrow would be
//     false); the offer form ONLY when the `offers` flag is ON (survey F-16), the auction door ONLY when `auctions` is ON;
//   • TOMBSTONE (B16) for a lot no longer on sale — sold out / paused / expired / withdrawn, the title, "no price while it is not on sale",
//     "Ask the seller to relist" = a link to the organisation's page (W3103 → the inquiry thread is STORE-2b/3), "Tell me if it returns"
//     refused by name;
//   • ERROR (not app/error.tsx any more) with Retry = a reload (W3103–W3105 PARITY-DECOR); the kill-switch OFF → temporarily unavailable;
//   • the refusals of brief §E for this surface printed by name. Dynamic (no ISR): a Retry must read again.
// PC-56 STORE-2b · C3 — the add-to-cart chain (W3099–W3102): a refused add returns HERE with the refusal named above the field and the typed
// quantity kept (below the minimum · above available · not a number · LICENCE_REQUIRED · WRONG_STORE "you are signed in to <A>; sign in to <B>
// to buy here" + this store's sign-in link · suspended · sold out · buying paused); success → "Added" + "View cart" → THIS store's cart.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { CategoryNode, GalleryItem, ListingTombstone, PublicListingDetail, RegulatedMarker, StorefrontFlags } from '@krishalaya/sdk-js';
import { publicClient, sessionTenantClient } from '../../../../lib/api-client';
import { hasSessionCookie } from '../../../../lib/auth';
import { qtyText, readRefusal, refusalKey } from '../../../../features/store2b/cart';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { listingLinks } from '../../../../features/listing/links';
import { publicListingView } from '../../../../features/listing/public-view';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { browseOff, categoryTrail, readState } from '../../../../features/store2a/browse';
import { buyerPanel, dayAsDate, lotFacts, tombstoneView } from '../../../../features/store2a/listing';
import { BuyerActions } from '../../../../components/BuyerActions';
import { readOfferPrefill } from '../../../../features/store3b/offers';   // PC-56 STORE-3b · C2: "Offer again" pre-fills the offer form
import { ListingGallery } from '../../../../components/ListingGallery';
import { RefusalList, BrowseOff } from '../../../../components/RefusalList';
// PC-56 STORE-4b · C4 (founder D1): "Message the organisation" about this lot — signed in AND this store's `communication` flag ON; signed out
// (flag ON) → the sign-in door with `next`; flag OFF or unreadable → nothing.
import { MessageOrgButton } from '../../../../components/MessageOrgButton';
import { showsMessageOrg } from '../../../../features/store4b/messages';

export const dynamic = 'force-dynamic';

/** The signed photo gallery degrades to [] — a flaky/empty media service never breaks the product page. */
async function safeGallery(tenantSlug: string, id: string): Promise<GalleryItem[]> {
  try { return await publicClient(tenantSlug).listings.media(id); } catch { return []; }
}

export async function generateMetadata({ params }: { params: { tenantSlug: string; id: string } }): Promise<Metadata> {
  const t = getTranslator();
  const r = await readState<PublicListingDetail>(() => publicClient(params.tenantSlug).listings.getPublic(params.id));
  if (!r.ok) return { title: t.t('common.notFoundTitle'), robots: { index: false } };
  const l = publicListingView(r.data);
  const desc = `${l.title} — ${formatMoneyMinor(l.priceMinor, l.currencyCode)} / ${l.unitCode}`;
  const canonical = `/${params.tenantSlug}/listings/${params.id}`;
  return {
    title: l.title,
    description: desc,
    alternates: { canonical },
    openGraph: { title: l.title, description: desc, type: 'website', url: canonical },
    twitter: { card: 'summary', title: l.title, description: desc },
  };
}

export default async function ListingDetail(
  { params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: { status?: string; step?: string; refusal?: string; qty?: string; price?: string } },
) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const api = publicClient(slug);
  const self = `/${slug}/listings/${params.id}`;

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  if (browseOff(flags)) return <article className="kv-detail"><BrowseOff /><RefusalList surface="listing" /></article>;

  const read = await readState<PublicListingDetail>(() => api.listings.getPublic(params.id));
  if (!read.ok && read.kind === 'browse_off') return <article className="kv-detail"><BrowseOff /><RefusalList surface="listing" /></article>;

  // NOT ON SALE: the tombstone (sold_out · paused · expired · withdrawn), else a real 404
  if (!read.ok && read.kind === 'not_found') {
    const tomb = await readState<ListingTombstone>(() => api.listings.tombstone(params.id));
    if (!tomb.ok) {
      if (tomb.kind === 'not_found') notFound();
      if (tomb.kind === 'browse_off') return <article className="kv-detail"><BrowseOff /><RefusalList surface="listing" /></article>;
      return <ListingError self={self} />;
    }
    const tv = tombstoneView(tomb.data, slug);
    return (
      <article className="kv-detail" data-kv-tombstone={tv.status}>
        <nav aria-label={t.t('browse.crumbs')}>
          <ol className="kv-crumb">
            <li><a href={`/${slug}`}>{t.t('lot.crumbs.store')}</a></li>
            {tomb.data.category && tv.categoryHref && <li><a href={tv.categoryHref}>{tomb.data.category.name}</a></li>}
            <li aria-current="page">{tv.title}</li>
          </ol>
        </nav>
        <h1>{tv.title}</h1>
        <div className="kv-state" role="status" data-kv-state={`tombstone-${tv.status}`}>
          <p><strong>{t.t(`lot.tombstone.${tv.status}`)}</strong></p>
          <p>{t.t('lot.tombstone.noPrice')}</p>
          {tv.organisation && <p>{t.t('listing.soldByOrg', { org: tv.organisation })}</p>}
          <p><a href={tv.relistHref} className="kv-btn" data-kv-relist="organisation">{t.t('lot.tombstone.askRelist')}</a></p>
          {tv.categoryHref && <p><a href={tv.categoryHref} className="kv-btn--link">{t.t('lot.tombstone.similar')}</a></p>}
        </div>
        <RefusalList surface="listing" />
      </article>
    );
  }
  if (!read.ok) return <ListingError self={self} />;

  const l = publicListingView(read.data);
  const facts = lotFacts(l);
  const [gallery, marker, cats] = await Promise.all([
    safeGallery(slug, l.id),
    readState<RegulatedMarker>(() => api.listings.regulated(l.id)),
    readState<CategoryNode[]>(() => api.lookups.categories() as Promise<CategoryNode[]>),
  ]);
  const trail = cats.ok ? categoryTrail(cats.data, l.categoryId ?? undefined) : [];
  const { trace: traceLink, auction } = listingLinks(l, params.tenantSlug);   // PC-56 STORE-2c · C6: the auction under this organisation
  const panel = buyerPanel(flags.ok ? flags.data : null, auction !== null);
  const qty = (x: number) => String(x);

  const status = searchParams.status;
  const notice =
    status === 'added' ? { kind: 'ok', msg: t.t('listing.statusAdded'), cta: true } :
    status === 'offer_sent' ? { kind: 'ok', msg: t.t('listing.statusOfferSent'), cta: false } :
    status === 'err' ? { kind: 'err', msg: t.t('listing.statusError'), cta: false } : null;
  // PC-56 STORE-2b · C3 (W3099 / W3102): a refused add — the refusal BY NAME above the field, the typed quantity kept in it
  const refused = searchParams.step === 'error' ? readRefusal(searchParams.refusal) : null;
  const keptQty = refused && typeof searchParams.qty === 'string' && searchParams.qty.length <= 20 ? searchParams.qty : null;
  let current: string | null = null;
  if (refused === 'wrong_store') { try { current = (await sessionTenantClient().storefront.tenant()).displayName; } catch { current = null; } }
  const org = l.organisation?.name ?? slug;
  const refusalLine = refused ? (
    <p className="kv-form__error" role="alert" data-kv-add-refusal={refused}>
      {refused === 'wrong_store'
        ? (current ? t.t('cart.refused.wrong_store', { current, store: org }) : t.t('cart.refused.wrong_storeUnknown', { store: org }))
        : t.t(refusalKey(refused), { min: qtyText(facts.minOrder), unit: facts.unit, available: qtyText(facts.available), store: org, org, region: '' })}
      {refused === 'wrong_store' && <> <a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-link" data-kv-signin="store">{t.t('cart.signinCta', { org })}</a></>}
    </p>
  ) : null;

  return (
    <article className="kv-detail">
      <nav aria-label={t.t('browse.crumbs')}>
        <ol className="kv-crumb" data-kv-crumbs="lot">
          <li><a href={`/${slug}`}>{t.t('lot.crumbs.store')}</a></li>
          {trail.map((c) => <li key={c.id}><a href={`/${slug}?category=${encodeURIComponent(c.id)}`}>{c.name}</a></li>)}
          <li aria-current="page">{l.title}</li>
        </ol>
      </nav>

      {notice && (
        <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">
          {notice.msg}{notice.cta && <> <Link href={`/${encodeURIComponent(slug)}/cart`} className="kv-link" data-kv-view-cart="store">{t.t('listing.viewCart')}</Link></>}
        </p>
      )}

      <h1>{l.title}</h1>

      <ul className="kv-detail__badges" data-kv-badges="lot">
        {facts.grade && <li><span className="kv-badge" data-kv-grade="confirmed">{facts.grade.gradedBy
          ? t.t('lot.gradeConfirmedBy', { grade: facts.grade.name, org: facts.grade.gradedBy })
          : t.t('lot.gradeConfirmed', { grade: facts.grade.name })}</span></li>}
        {facts.organic && <li><span className="kv-badge kv-badge--organic">{t.t(`lot.organic.${facts.organic}`)}</span></li>}
        {facts.harvestDay && <li><span className="kv-badge" data-kv-harvest={facts.harvestDay}>{t.t('lot.harvested', { date: formatDate(dayAsDate(facts.harvestDay), lang, { dateStyle: 'medium', timeZone: 'UTC' }) })}</span></li>}
        {facts.traceable && <li><span className="kv-badge" data-kv-trace="lot">{t.t('lot.traceable')}</span></li>}
        {marker.ok && marker.data.licenceRequired && <li><span className="kv-badge kv-badge--lock" data-kv-lock="licence">{t.t('lot.licenceRequired')}</span></li>}
      </ul>

      <ListingGallery
        items={gallery}
        heading={t.t('listing.galleryTitle')}
        alt={(index, total) => t.t('listing.photoAlt', { title: l.title, index: String(index), total: String(total) })}
      />

      {l.description && <p className="kv-detail__description" data-kv-description="lot">{l.description}</p>}

      {facts.attributes.length > 0 && (
        <section className="kv-detail__section" aria-labelledby="lot-attrs-h">
          <h2 id="lot-attrs-h">{t.t('lot.attributes.title')}</h2>
          <table className="kv-table" data-kv-attributes="lot">
            <tbody>
              {facts.attributes.map((a) => (
                <tr key={a.code}>
                  <th scope="row">{a.name}</th>
                  <td>{a.kind === 'bool' ? t.t(a.value === 'true' ? 'lot.attributes.yes' : 'lot.attributes.no') : a.value}{a.unit ? ` ${a.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="kv-detail__section kv-detail__panel" aria-labelledby="lot-price-h" data-kv-panel="price">
        <h2 id="lot-price-h" className="kv-card__price kv-detail__price">
          {moneyText(l.priceMinor, l.currencyCode, lang) ?? t.t('money.unavailable')} <span className="kv-card__unit">/ {l.unitCode}</span>
        </h2>
        <p className="kv-detail__muted" data-kv-fees="checkout">{t.t('lot.feesAtCheckout')}</p>
        <ul className="kv-detail__facts">
          <li data-kv-available="lot">{t.t('lot.available', { available: qty(facts.available), total: qty(facts.total), unit: facts.unit })}</li>
          {facts.minOrder > 0 && <li data-kv-min-order="lot">{t.t('lot.minOrder', { qty: qty(facts.minOrder), unit: facts.unit })}</li>}
          <li>{t.t('discover.saleType')}: {t.t(`discover.saleType.${l.saleType}`)}</li>
        </ul>
        <BuyerActions listing={l} tenantSlug={slug} offers={panel.offers} keptQty={keptQty} refusal={refusalLine} signedIn={hasSessionCookie()}
          offerPrefill={refused ? null : readOfferPrefill(searchParams)} />
        <p className="kv-detail__muted" data-kv-stock="not-reserved">{t.t('lot.noReserve')}</p>
        {panel.escrow && <p className="kv-detail__muted" data-kv-escrow="held">{t.t('lot.escrow')}</p>}
      </section>

      {panel.auction && auction && (
        <section className="kv-detail__section" aria-labelledby="auction-h">
          <h2 id="auction-h">{t.t('listing.auctionTitle')}</h2>
          <p className="kv-detail__muted">
            {auction.live ? t.t('listing.auctionLiveNote') : t.t('listing.auctionEndedNote')}
          </p>
          <Link href={auction.href} className={auction.live ? 'kv-btn' : 'kv-btn kv-btn--ghost'}>
            {auction.live ? t.t('listing.auctionBidCta') : t.t('listing.auctionViewCta')}
          </Link>
        </section>
      )}

      <section className="kv-detail__section" aria-labelledby="seller-h" data-kv-seller="organisation">
        <h2 id="seller-h">{t.t('listing.sellerTitle')}</h2>
        {l.organisation
          ? <p>{t.t('listing.soldByOrg', { org: l.organisation.name })} · <a href={`/${slug}/sellers`} className="kv-link">{t.t('sellers.link')}</a></p>
          : <p className="kv-detail__muted">{t.t('listing.sellerUnknown')}</p>}
        {facts.district && <p data-kv-grew="district">{t.t('lot.whereGrew', { district: facts.district })}</p>}
        {showsMessageOrg(hasSessionCookie(), flags.ok ? flags.data : null) && <MessageOrgButton slug={slug} contextType="listing" contextId={l.id} labelKey="store4b.entry.listing" />}
        {!hasSessionCookie() && showsMessageOrg(true, flags.ok ? flags.data : null) && (
          <p><a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-link" data-kv-signin="message-org">{t.t('store4b.entry.signin')}</a></p>
        )}
      </section>

      <section className="kv-detail__section" aria-labelledby="trace-h">
        <h2 id="trace-h">{t.t('listing.traceTitle')}</h2>
        <p className="kv-detail__muted">{t.t('listing.traceNote', { platform: t.t('brand.platform') })}</p>
        {traceLink
          ? <Link href={traceLink} className="kv-link">{t.t('listing.traceScanLink')}</Link>
          : <Link href="/help" className="kv-link">{t.t('listing.traceLink')}</Link>}
      </section>

      <RefusalList surface="listing" />
    </article>
  );
}

/** The listing could not be read (not a 404): its own sentence + Retry = a reload of this URL (W3103–W3105 PARITY-DECOR). */
function ListingError({ self }: { self: string }) {
  const t = getTranslator();
  return (
    <article className="kv-detail">
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('lot.error')}</p>
        <a href={reloadHref(self)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div>
      <RefusalList surface="listing" />
    </article>
  );
}
