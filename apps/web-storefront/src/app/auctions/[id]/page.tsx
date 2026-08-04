// apps/web-storefront/src/app/auctions/[id]/page.tsx · auction detail. Flag-gated (notFound when hidden);
// notFound() on a missing id. Public read (auction + bid history + the listing's title), so it's SSR + ISR. Shows
// the live countdown, current high bid (from the newest-first history), the suggested minimum next bid, reserve (if
// any), and the bid history (bidder identity is NOT exposed — generic label; sealed amounts show as "sealed").
// The authed bid form holds an EMD on the wallet SERVER-SIDE; we surface that + the anti-snipe (soft-close) note.
// Money via formatMoneyMinor / BigInt math (Law 2); EMD movement is server-side only (Law 11).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Auction, BidHistoryItem } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../lib/api-client';
import { resolveSessionToken } from '../../../lib/session';
import { env } from '../../../lib/env';
import { getTranslator, getLang } from '../../../lib/i18n';
import { Countdown, type CountdownLabels } from '../../../components/Countdown';
import { currentHighMinor, minNextBidMinor, emdRequirement } from '../../../features/auctions/bid';
import { placeBidAction, toggleWatchAction } from './actions';

/** The caller's watch state for this auction — null when anonymous (no session), boolean when authed. Degrades
 * to null on any error so a flaky read never breaks the public product page (Law 12). */
async function safeWatchState(auctionId: string): Promise<boolean | null> {
  const tok = await resolveSessionToken();
  if (!tok) return null;
  try { return await serverClient().auctions.isWatching(auctionId); } catch { return null; }
}

const TERMINAL = new Set(['ended', 'settled', 'cancelled', 'closed', 'completed', 'expired']);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auctions.detailTitle'), robots: env.featureAuctions ? undefined : { index: false } };
}

export default async function AuctionDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
  if (!env.featureAuctions) notFound();
  const t = getTranslator();
  const lang = getLang();

  let auction: Auction | null = null;
  try { auction = await publicClient().auctions.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); auction = null; }
  if (!auction) {
    return <section className="kv-auction"><h1>{t.t('auctions.detailTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('auctions.loadError')}</p></section>;
  }

  let bids: BidHistoryItem[] = [];
  try { bids = (await publicClient().auctions.listBids(auction.auctionId, { limit: 20 })).items; } catch { bids = []; }
  let listingTitle = '';
  try { listingTitle = (await publicClient().listings.get(auction.listingId)).title; } catch { listingTitle = ''; }

  const high = currentHighMinor(bids);
  const minNext = minNextBidMinor(auction, bids);
  const isOpen = !TERMINAL.has(auction.status.toLowerCase());
  const watching = await safeWatchState(auction.auctionId);
  const cd: CountdownLabels = { ended: t.t('auctions.ended'), d: t.t('auctions.cd.d'), h: t.t('auctions.cd.h'), m: t.t('auctions.cd.m'), s: t.t('auctions.cd.s') };
  const notice =
    searchParams.status === 'bid' ? { kind: 'ok', msg: t.t('auctions.bidSuccess') } :
    searchParams.status === 'err' ? { kind: 'err', msg: t.t('auctions.bidError') } :
    searchParams.status === 'watched' ? { kind: 'ok', msg: t.t('auctions.watchOn') } :
    searchParams.status === 'unwatched' ? { kind: 'ok', msg: t.t('auctions.watchOff') } :
    searchParams.status === 'watch_err' ? { kind: 'err', msg: t.t('auctions.watchError') } : null;

  return (
    <section className="kv-auction">
      <h1>{listingTitle || t.t('auctions.detailTitle')}</h1>
      {notice && <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">{notice.msg}</p>}

      <p className="kv-auction__ends">{t.t('auctions.endsIn')}: <Countdown endsAt={auction.endsAt} labels={cd} /></p>

      {isOpen && (
        <form action={toggleWatchAction} className="kv-auction__watch">
          <input type="hidden" name="auctionId" value={auction.auctionId} />
          <input type="hidden" name="intent" value={watching ? 'unwatch' : 'watch'} />
          <button type="submit" className={watching ? 'kv-btn kv-btn--ghost' : 'kv-btn kv-btn--ghost kv-watch--on'} aria-pressed={watching === true}>
            {watching ? t.t('auctions.unwatch') : t.t('auctions.watch')}
          </button>
          <span className="kv-field__hint">{t.t('auctions.watchHint')}</span>
        </form>
      )}

      <dl className="kv-offer__facts">
        <div><dt>{t.t('auctions.currentBid')}</dt><dd>{high ? formatMoneyMinor(high, 'INR', lang) : t.t('auctions.noBids')}</dd></div>
        <div><dt>{t.t('auctions.startPrice')}</dt><dd>{formatMoneyMinor(auction.startPriceMinor, 'INR', lang)}</dd></div>
        <div><dt>{t.t('auctions.minNext')}</dt><dd>{formatMoneyMinor(minNext, 'INR', lang)}</dd></div>
        {auction.reservePriceMinor && <div><dt>{t.t('auctions.reserve')}</dt><dd>{formatMoneyMinor(auction.reservePriceMinor, 'INR', lang)}</dd></div>}
        {(() => {
          const emd = emdRequirement(auction);
          if (emd.kind === 'flat') return <div><dt>{t.t('auctions.emd')}</dt><dd>{formatMoneyMinor(emd.minor, 'INR', lang)}</dd></div>;
          if (emd.kind === 'pct') return <div><dt>{t.t('auctions.emd')}</dt><dd>{t.t('auctions.emdPct', { pct: String(emd.pctBps / 100) })}</dd></div>;
          return null;
        })()}
      </dl>

      {isOpen ? (
        <form action={placeBidAction} className="kv-auction__bid">
          <input type="hidden" name="auctionId" value={auction.auctionId} />
          <label htmlFor="bid-amount" className="kv-field__label">{t.t('auctions.bidLabel')}</label>
          <input id="bid-amount" name="amount" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" placeholder={formatMoneyMinor(minNext, 'INR', lang)} required />
          <button type="submit" className="kv-btn">{t.t('auctions.placeBid')}</button>
          <p className="kv-field__hint">{t.t('auctions.emdNote')}</p>
          <p className="kv-field__hint">{t.t('auctions.antiSnipe')}</p>
        </form>
      ) : (
        <p className="kv-detail__muted">{t.t('auctions.endedNote')}</p>
      )}

      <section className="kv-order__section" aria-labelledby="hist-h">
        <h2 id="hist-h">{t.t('auctions.history')}</h2>
        {bids.length === 0 ? (
          <p className="kv-detail__muted">{t.t('auctions.noBids')}</p>
        ) : (
          <ul className="kv-confirm__items">
            {bids.map((b) => (
              <li key={b.id} className="kv-confirm__item">
                <span>{t.t('auctions.bidder')}</span>
                <span>{b.amountMinor ? formatMoneyMinor(b.amountMinor, 'INR', lang) : t.t('auctions.sealedBid')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p><Link href="/auctions" className="kv-btn--link">{t.t('auctions.back')}</Link></p>
    </section>
  );
}
