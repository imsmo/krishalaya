// apps/web-tenant/src/app/auctions/[id]/page.tsx · seller auction detail + bid history + management. Server-first:
// requireSession-gated, flag-gated (env.featureAuctions). auctions.get(id) → notFound() on a missing/foreign id
// (the IDOR guard; the API is tenant-scoped). Bid history via listBids (sealed auctions mask others' amounts
// server-side → we render "sealed" when amountMinor is null). approve/cancel surface only when legal for the
// current status (features/auctions/manage.ts, unit-tested). Money via formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canApprove, canCancel } from '../../../features/auctions/manage';
import { approveAuctionAction, cancelAuctionAction } from '../actions';
import { DataTable } from '../../../components/DataTable';
import type { Auction, BidHistoryItem } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auctionDetail.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['approve', 'cancel', 'illegal']);
const OK = new Set(['approve', 'cancel']);

export default async function AuctionDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/auctions/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  if (!env.featureAuctions) {
    return <section><h1>{t.t('auctionDetail.title')}</h1><p className="kv-empty-state">{t.t('auctions.disabled')}</p></section>;
  }

  let auction: Auction;
  try { auction = await tenantClient().auctions.get(params.id); }
  catch { notFound(); }

  let bids: BidHistoryItem[] = [];
  try { bids = (await tenantClient().auctions.listBids(auction.auctionId, { limit: 50 })).items; }
  catch { bids = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const facts: Array<[string, string]> = [
    [t.t('auctionDetail.status'), auction.status],
    [t.t('auctionDetail.kind'), t.t(`auctions.kind.${auction.kind}`)],
    [t.t('auctionDetail.startPrice'), formatMoneyMinor(auction.startPriceMinor, 'INR', lang)],
    [t.t('auctionDetail.reserve'), auction.reservePriceMinor ? formatMoneyMinor(auction.reservePriceMinor, 'INR', lang) : t.t('common.dash')],
    [t.t('auctionDetail.increment'), formatMoneyMinor(auction.minIncrementMinor, 'INR', lang)],
    [t.t('auctionDetail.starts'), formatDate(auction.startsAt, lang)],
    [t.t('auctionDetail.ends'), formatDate(auction.endsAt, lang)],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('auctionDetail.heading')}</h1>
        <Link href="/auctions" className="kv-btn--link">← {t.t('auctions.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t(`auctionDetail.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`auctionDetail.error.${errorKey}`)}</p>}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {(canApprove(auction.status) || canCancel(auction.status)) && (
        <div className="kv-actions">
          {canApprove(auction.status) && (
            <form action={approveAuctionAction} className="kv-inline-form">
              <input type="hidden" name="id" value={auction.auctionId} />
              <button type="submit" className="kv-btn">{t.t('auctionDetail.approve')}</button>
            </form>
          )}
          {canCancel(auction.status) && (
            <form action={cancelAuctionAction} className="kv-inline-form">
              <input type="hidden" name="id" value={auction.auctionId} />
              <button type="submit" className="kv-btn kv-btn--muted">{t.t('auctionDetail.cancel')}</button>
            </form>
          )}
        </div>
      )}

      <h2 className="kv-section-title">{t.t('auctionDetail.bids')}</h2>
      <DataTable
        rows={bids}
        empty={t.t('auctionDetail.noBids')}
        columns={[
          { header: t.t('auctionDetail.bidder'), cell: (b) => b.bidderUserId.slice(0, 8) },
          { header: t.t('auctionDetail.amount'), cell: (b) => (b.amountMinor ? formatMoneyMinor(b.amountMinor, 'INR', lang) : t.t('auctionDetail.sealed')) },
          { header: t.t('auctionDetail.placedAt'), cell: (b) => (b.createdAt ? formatDate(b.createdAt, lang) : t.t('common.dash')) },
        ]}
      />
    </section>
  );
}
