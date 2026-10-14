// apps/web-storefront/src/app/[tenantSlug]/listings/[id]/page.tsx · a single listing detail page. SSR-fetched via
// the SDK (anonymous public read); a missing/unavailable listing renders notFound() (404). Enriched with a price/
// quantity block, the localized sale-type, a seller trust card + listing review summary (both via the public
// reviews.summary aggregate — degrade silently if unavailable), the buyer CTAs (BuyerActions), a farm-to-fork
// note, and rich OpenGraph metadata for sharing. Money via formatMoneyMinor from minor-unit strings (Law 2).
//
// P1-1: the listing photo gallery is served by the dedicated signed endpoint `listings/:id/media` (short-lived
// presigned GET urls, CLEAN assets only, public listings only) — NOT embedded in the cacheable ListingCard
// read-model (its urls expire in minutes; embedding them in a revalidate=60 card would serve dead links). We
// fetch it alongside the listing and render a real gallery; an empty/unavailable gallery shows nothing (never a
// placeholder image).
// P1-2: the detail read (GET listings/:id) now exposes NON-PII public links — the farm-to-fork trace `qrToken`
// and the `auctionId`/status — so this page deep-links to the real /trace/[qrToken] provenance page and shows a
// place-bid CTA to the live auction. Both degrade to the prior copy when the listing has neither (no fabrication).
// PC-56 HOTFIX-4 · A6/C5 (survey F-7, founder D3): the read is the API's ALLOW-LISTED public projection (`listings.getPublic`), turned into
// a view model that names each field (features/listing/public-view.ts) — no coordinates, pincode, region id or seller person can reach the
// page. The seller is the ORGANISATION (its name + the district). The per-SELLER review reads keyed by the farmer's user id are gone with
// that id (the reviews flag is OFF by seed, so nothing visible changes today; seller/organisation ratings return with W280 in STORE-2a).
// "Organic" is the claim's boolean (the old read sent the claim string and badged 'none' as organic).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { GalleryItem } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { listingLinks } from '../../../../features/listing/links';
import { publicListingView, type PublicListingView } from '../../../../features/listing/public-view';
import { moneyText } from '../../../../features/discovery/money';
import { BuyerActions } from '../../../../components/BuyerActions';
import { ListingGallery } from '../../../../components/ListingGallery';

export const revalidate = 60;

async function load(tenantSlug: string, id: string): Promise<PublicListingView | null> {
  try { return publicListingView(await publicClient(tenantSlug).listings.getPublic(id)); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) return null; throw e; }
}

/** The signed photo gallery degrades to [] — a flaky/empty media service never breaks the product page. */
async function safeGallery(tenantSlug: string, id: string): Promise<GalleryItem[]> {
  try { return await publicClient(tenantSlug).listings.media(id); } catch { return []; }
}


export async function generateMetadata({ params }: { params: { tenantSlug: string; id: string } }): Promise<Metadata> {
  const l = await load(params.tenantSlug, params.id);
  const t = getTranslator();
  if (!l) return { title: t.t('common.notFoundTitle'), robots: { index: false } };
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
  { params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: { status?: string } },
) {
  const l = await load(params.tenantSlug, params.id);
  if (!l) notFound();
  const t = getTranslator();
  const lang = getLang();

  const gallery = await safeGallery(params.tenantSlug, l.id);

  const { trace: traceLink, auction } = listingLinks(l);
  // The auction CTA is also gated by the storefront's auctions flag (kill-switch parity with /auctions).
  const showAuction = env.featureAuctions && auction !== null;

  const status = searchParams.status;
  const notice =
    status === 'added' ? { kind: 'ok', msg: t.t('listing.statusAdded'), cta: true } :
    status === 'offer_sent' ? { kind: 'ok', msg: t.t('listing.statusOfferSent'), cta: false } :
    status === 'err' ? { kind: 'err', msg: t.t('listing.statusError'), cta: false } : null;

  return (
    <article className="kv-detail">
      {notice && (
        <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">
          {notice.msg}{notice.cta && <> <Link href="/cart" className="kv-link">{t.t('listing.viewCart')}</Link></>}
        </p>
      )}

      <h1>{l.title}</h1>

      <ListingGallery
        items={gallery}
        heading={t.t('listing.galleryTitle')}
        alt={(index, total) => t.t('listing.photoAlt', { title: l.title, index: String(index), total: String(total) })}
      />

      <p className="kv-card__price kv-detail__price">
        {moneyText(l.priceMinor, l.currencyCode, lang) ?? t.t('money.unavailable')} <span className="kv-card__unit">/ {l.unitCode}</span>
      </p>

      <ul className="kv-detail__facts">
        <li>{l.quantityAvailable} {l.unitCode} {t.t('card.available')}</li>
        <li>{t.t('discover.saleType')}: {t.t(`discover.saleType.${l.saleType}`)}</li>
        {l.organic && <li><span className="kv-badge kv-badge--organic">{t.t('card.organic')}</span></li>}
      </ul>

      <BuyerActions listing={l} tenantSlug={params.tenantSlug} />

      {showAuction && auction && (
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
          ? <p>{t.t('listing.soldByOrg', { org: l.organisation.name })}{l.district ? <> · {t.t('listing.fromDistrict', { district: l.district })}</> : null}</p>
          : <p className="kv-detail__muted">{t.t('listing.sellerUnknown')}</p>}
      </section>

      <section className="kv-detail__section" aria-labelledby="trace-h">
        <h2 id="trace-h">{t.t('listing.traceTitle')}</h2>
        <p className="kv-detail__muted">{t.t('listing.traceNote', { platform: t.t('brand.platform') })}</p>
        {traceLink
          ? <Link href={traceLink} className="kv-link">{t.t('listing.traceScanLink')}</Link>
          : <Link href="/help" className="kv-link">{t.t('listing.traceLink')}</Link>}
      </section>
    </article>
  );
}
