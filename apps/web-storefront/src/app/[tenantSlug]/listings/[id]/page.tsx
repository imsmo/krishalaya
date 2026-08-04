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
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { ListingCard, ReviewSummary, GalleryItem, PublicReview } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { listingLinks } from '../../../../features/listing/links';
import { starGlyphs } from '../../../../features/reviews/display';
import { BuyerActions } from '../../../../components/BuyerActions';
import { ListingGallery } from '../../../../components/ListingGallery';

export const revalidate = 60;

async function load(tenantSlug: string, id: string): Promise<ListingCard | null> {
  try { return await publicClient(tenantSlug).listings.get(id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) return null; throw e; }
}

/** The signed photo gallery degrades to [] — a flaky/empty media service never breaks the product page. */
async function safeGallery(tenantSlug: string, id: string): Promise<GalleryItem[]> {
  try { return await publicClient(tenantSlug).listings.media(id); } catch { return []; }
}

/** Public review aggregates degrade to null — a flaky/optional reviews service never breaks the product page. */
async function safeSummary(tenantSlug: string, q: { targetUserId?: string }): Promise<ReviewSummary | null> {
  try { return await publicClient(tenantSlug).reviews.summary(q); } catch { return null; }
}

/** The seller's PUBLISHED individual reviews (PII-free public read). Degrades to [] — never breaks the page. */
async function safeReviews(tenantSlug: string, sellerUserId: string): Promise<PublicReview[]> {
  try { return (await publicClient(tenantSlug).reviews.publicReviews({ targetUserId: sellerUserId, limit: 10 })).items; } catch { return []; }
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

function Stars({ summary, label, none }: { summary: ReviewSummary | null; label: string; none: string }) {
  if (!summary || summary.count <= 0) return <p className="kv-rating kv-rating--none">{none}</p>;
  const avg = Math.round(summary.averageStars * 10) / 10;
  const full = Math.round(avg);
  return (
    <p className="kv-rating">
      <span aria-hidden="true" className="kv-rating__stars">{'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}</span>
      <span>{label}</span>
    </p>
  );
}

export default async function ListingDetail(
  { params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: { status?: string } },
) {
  const l = await load(params.tenantSlug, params.id);
  if (!l) notFound();
  const t = getTranslator();
  const lang = getLang();

  const [sellerReviews, reviews, gallery] = await Promise.all([
    safeSummary(params.tenantSlug, { targetUserId: l.sellerUserId }),
    safeReviews(params.tenantSlug, l.sellerUserId),
    safeGallery(params.tenantSlug, l.id),
  ]);

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
        title={l.title}
        heading={t.t('listing.galleryTitle')}
        alt={(index, total) => t.t('listing.photoAlt', { title: l.title, index: String(index), total: String(total) })}
      />

      <p className="kv-card__price kv-detail__price">
        {formatMoneyMinor(l.priceMinor, l.currencyCode, lang)} <span className="kv-card__unit">/ {l.unitCode}</span>
      </p>

      <ul className="kv-detail__facts">
        <li>{l.quantityAvailable} {l.unitCode} {t.t('card.available')}</li>
        <li>{t.t('discover.saleType')}: {t.t(`discover.saleType.${l.saleType}`)}</li>
        {l.organicClaim && <li><span className="kv-badge kv-badge--organic">{t.t('card.organic')}</span></li>}
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

      <section className="kv-detail__section" aria-labelledby="seller-h">
        <h2 id="seller-h">{t.t('listing.sellerTitle')}</h2>
        <Stars
          summary={sellerReviews}
          label={sellerReviews && sellerReviews.count > 0 ? t.t('listing.sellerRating', { avg: String(Math.round(sellerReviews.averageStars * 10) / 10), count: String(sellerReviews.count) }) : ''}
          none={t.t('listing.sellerNoRatings')}
        />
      </section>

      <section className="kv-detail__section" aria-labelledby="reviews-h">
        <h2 id="reviews-h">{t.t('listing.reviewsTitle')}</h2>
        {reviews.length === 0 ? (
          <p className="kv-rating kv-rating--none">{t.t('listing.reviewsNone')}</p>
        ) : (
          <ul className="kv-reviews" role="list">
            {reviews.map((rv) => (
              <li key={rv.id} className="kv-review">
                <p className="kv-review__head">
                  <span className="kv-rating__stars" aria-label={t.t('listing.reviewStarsLabel', { stars: String(rv.stars) })}>{starGlyphs(rv.stars)}</span>
                  {rv.isVerifiedPurchase && <span className="kv-badge kv-badge--verified">{t.t('listing.reviewVerified')}</span>}
                  <span className="kv-detail__muted kv-review__date">{formatDate(rv.createdAt, lang)}</span>
                </p>
                {rv.body && <p className="kv-review__body">{rv.body}</p>}
                {rv.sellerResponse && (
                  <div className="kv-review__response">
                    <p className="kv-review__response-label">{t.t('listing.reviewSellerResponse')}</p>
                    <p>{rv.sellerResponse}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="kv-detail__section" aria-labelledby="trace-h">
        <h2 id="trace-h">{t.t('listing.traceTitle')}</h2>
        <p className="kv-detail__muted">{t.t('listing.traceNote')}</p>
        {traceLink
          ? <Link href={traceLink} className="kv-link">{t.t('listing.traceScanLink')}</Link>
          : <Link href="/help" className="kv-link">{t.t('listing.traceLink')}</Link>}
      </section>
    </article>
  );
}
