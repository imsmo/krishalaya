// apps/web-tenant/src/app/listings/[id]/page.tsx · owner listing detail + management. Server-first: requireSession
// gates it, listings.getOwn(id) returns the owner view (incl. drafts); a missing/foreign id → notFound() (the API
// is tenant-scoped, so this is also the IDOR guard). Surfaces only LEGAL actions (publish when the state machine
// allows; price change unless archived), each a Server-Action form — no client JS. Optimistic-concurrency price
// edits carry the listing's version; a conflict degrades to a "reload" message. All copy via i18n; money via
// formatMoneyMinor; noindex.
//
// SDK-GAP (flagged, not faked): a paid visibility BOOST needs a boost-tier lookup + a wallet-captured paymentTxnId,
// neither of which the seller-facing SDK exposes (listings.startBoost takes a boostTierId + paymentTxnId it can't
// source here). Mobile deferred its boost screen for the same reason. We therefore omit the boost control and note
// it as unavailable rather than ship a placeholder. Unblocked when sdk-js adds boost-tier + boost-payment methods.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { minorToMajor } from '../../../features/listings/form';
import { canPublish, canChangePrice } from '../../../features/listings/manage';
import { publishListingAction, changePriceAction } from './actions';
import type { ListingCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('listingManage.title'), robots: { index: false, follow: false } };
}

const ERROR_KEYS = new Set(['publish', 'price', 'conflict', 'failed']);
const OK_KEYS = new Set(['published', 'price']);

export default async function ListingDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  await requireSession(`/listings/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let listing: ListingCard;
  try { listing = await tenantClient().listings.getOwn(params.id); }
  catch { notFound(); }

  const status = listing.status ?? 'draft';
  const errorKey = searchParams.error && ERROR_KEYS.has(searchParams.error) ? searchParams.error : null;
  const okKey = searchParams.ok && OK_KEYS.has(searchParams.ok) ? searchParams.ok : null;

  const facts: Array<[string, string]> = [
    [t.t('listingManage.status'), t.t(`listingManage.status.${status}`)],
    [t.t('listingManage.price'), `${formatMoneyMinor(listing.priceMinor, listing.currencyCode, lang)} / ${listing.unitCode}`],
    [t.t('listingManage.available'), `${listing.quantityAvailable} ${listing.unitCode}`],
    [t.t('listingManage.saleType'), listing.saleType],
    [t.t('listingManage.organic'), listing.organicClaim ? t.t('listings.organicYes') : t.t('common.dash')],
    [t.t('listingManage.boosted'), listing.boosted ? t.t('listingManage.boostedYes') : t.t('common.dash')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{listing.title}</h1>
        <Link href="/listings" className="kv-btn--link">← {t.t('listings.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t(`listingManage.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`listingManage.error.${errorKey}`)}</p>}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {canPublish(status) && (
        <form action={publishListingAction} className="kv-inline-form">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="kv-btn">{t.t('listingManage.publish')}</button>
        </form>
      )}

      {canChangePrice(status) && (
        <form action={changePriceAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('listingManage.changePrice')}</h2>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="expectedVersion" value={String(listing.version ?? 0)} />
          <label htmlFor="priceMajor" className="kv-field__label">{t.t('listingManage.newPrice')}</label>
          <input id="priceMajor" name="priceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?"
            className="kv-input" required defaultValue={minorToMajor(listing.priceMinor)} />
          <p className="kv-field__hint">{t.t('listingManage.priceHint')}</p>
          <button type="submit" className="kv-btn">{t.t('listingManage.savePrice')}</button>
        </form>
      )}

      <p className="kv-field__hint kv-note">{t.t('listingManage.boostUnavailable')}</p>
    </section>
  );
}
