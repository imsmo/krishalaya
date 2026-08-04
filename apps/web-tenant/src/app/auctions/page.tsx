// apps/web-tenant/src/app/auctions/page.tsx · the tenant's auctions. Server-first, requireSession-gated, and
// flag-gated: when env.featureAuctions is off the surface is hidden (a clear "unavailable" note); when on, the
// API's own `auctions` flag is authoritative — if it's off the reads simply degrade to an empty state (Law 12).
// Lists tenant auctions (auctions.list, keyset; status filter) + a create form (listing picker + money in major
// units, parsed float-free). Money via formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { AUCTION_KINDS } from '../../features/auctions/manage';
import { createAuctionAction } from './actions';
import type { Auction, ListingCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auctions.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['listing', 'startPrice', 'reserve', 'increment', 'emd', 'window', 'create']);

export default async function AuctionsPage({ searchParams }: { searchParams: { cursor?: string; status?: string; ok?: string; error?: string } }) {
  await requireSession('/auctions');
  const t = getTranslator();
  const lang = getLang();

  if (!env.featureAuctions) {
    return <section><h1>{t.t('auctions.title')}</h1><p className="kv-empty-state">{t.t('auctions.disabled')}</p></section>;
  }

  let auctions: Auction[] = []; let nextCursor: string | null = null; let auctionsFailed = false;
  let listings: ListingCard[] = [];
  const [auRes, liRes] = await Promise.allSettled([
    tenantClient().auctions.list({ status: searchParams.status, cursor: searchParams.cursor, limit: 50 }),
    tenantClient().listings.browse({ limit: 50 }),
  ]);
  if (auRes.status === 'fulfilled') { auctions = auRes.value.items; nextCursor = auRes.value.nextCursor; } else { auctionsFailed = true; }
  if (liRes.status === 'fulfilled') { listings = liRes.value.items; }

  const okKey = searchParams.ok === 'created' ? 'created' : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('auctions.title')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t('auctions.ok.created')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`auctions.error.${errorKey}`)}</p>}

      {listings.length > 0 && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('auctions.create')}</summary>
          <form action={createAuctionAction} className="kv-form">
            <label htmlFor="listingId" className="kv-field__label">{t.t('auctions.listing')}</label>
            <select id="listingId" name="listingId" className="kv-select" required defaultValue="">
              <option value="" disabled>{t.t('auctions.selectListing')}</option>
              {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
            <label htmlFor="kind" className="kv-field__label">{t.t('auctions.kind')}</label>
            <select id="kind" name="kind" className="kv-select" defaultValue="english_open">
              {AUCTION_KINDS.map((k) => <option key={k} value={k}>{t.t(`auctions.kind.${k}`)}</option>)}
            </select>
            <label htmlFor="startPriceMajor" className="kv-field__label">{t.t('auctions.startPrice')}</label>
            <input id="startPriceMajor" name="startPriceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" required />
            <label htmlFor="reservePriceMajor" className="kv-field__label">{t.t('auctions.reserve')}</label>
            <input id="reservePriceMajor" name="reservePriceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" />
            <label htmlFor="minIncrementMajor" className="kv-field__label">{t.t('auctions.increment')}</label>
            <input id="minIncrementMajor" name="minIncrementMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" />
            <label htmlFor="emdMajor" className="kv-field__label">{t.t('auctions.emd')}</label>
            <input id="emdMajor" name="emdMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" />
            <label htmlFor="startsAt" className="kv-field__label">{t.t('auctions.startsAt')}</label>
            <input id="startsAt" name="startsAt" type="datetime-local" className="kv-input" required />
            <label htmlFor="endsAt" className="kv-field__label">{t.t('auctions.endsAt')}</label>
            <input id="endsAt" name="endsAt" type="datetime-local" className="kv-input" required />
            <label className="kv-check"><input type="checkbox" name="requiresSellerApproval" /> {t.t('auctions.requireApproval')}</label>
            <button type="submit" className="kv-btn">{t.t('auctions.createBtn')}</button>
          </form>
        </details>
      )}

      {auctionsFailed ? <p className="kv-error" role="alert">{t.t('auctions.loadError')}</p> : (
        <DataTable
          rows={auctions}
          empty={t.t('auctions.empty')}
          columns={[
            { header: t.t('auctions.colId'), cell: (a) => <Link href={`/auctions/${a.auctionId}`} className="kv-link">{a.auctionId.slice(0, 8)}</Link> },
            { header: t.t('auctions.colKind'), cell: (a) => t.t(`auctions.kind.${a.kind}`) },
            { header: t.t('auctions.colStart'), cell: (a) => formatMoneyMinor(a.startPriceMinor, 'INR', lang) },
            { header: t.t('auctions.colEnds'), cell: (a) => formatDate(a.endsAt, lang) },
            { header: t.t('auctions.colStatus'), cell: (a) => <span className="kv-badge">{a.status}</span> },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/auctions?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
