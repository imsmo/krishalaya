// apps/web-storefront/src/app/[tenantSlug]/auctions/bids/page.tsx · PC-56 STORE-3c · C1 / C3 — canon W296 "My bids & deposits", under the
// ORGANISATION's chrome (the platform's /auctions/bids is a door). PROTECTED + dynamic. (A static segment: Next resolves `bids` before `[id]`.)
//
// What was true (survey 1I / C-8): no page existed; the API's my-bids read was ONE ROW PER BID and its "EMD held" was the RULE recomputed, so a
// released, applied, forfeited or returned deposit read as "held"; "Pay balance" was a decor button over a pay step that sent the total (F-3).
// Now (`auctions.myBids` — API B3):
//   • the store's `auctions` flag FIRST — OFF → the honest state and no call;
//   • one row PER AUCTION: title · quantity + unit · the organisation · the status · "you're leading / you were outbid / won / not won / sealed bid
//     placed / awaiting the organisation / no sale" (the server's facts) · "your best <price> at <time>" · the current and the minimum next bid
//     (the server's; hidden while sealed) · the end · "Bid <min next>" → W278 while open;
//   • THE DEPOSIT AS THE LEDGER HAS IT (held <amount> · released <time> · applied toward your order · forfeited <time> · returned <time>) — the
//     state comes from the ledger's transactions by their keys, never from the rule;
//   • the WON row: the order link, "Deposit applied −X · Balance due Y, by <balanceDueAt>" (the settlement's figures and due time; the live amount
//     due), "Pay balance" → THIS store's pay step (2c's attempt chain, now charging the DUE — DELTA), "miss the deadline and the deposit is forfeited
//     to the organisation" (TRUE), the offline order's own sentence, and the outcome once decided (paid · forfeited · returned · paid, then
//     cancelled — deposit and payment returned);
//   • the sealed-placed sentence ("you may only raise your own sealed bid" — TRUE since founder D1); "every bid records the connection it came
//     from" (TRUE: the ip) — the fingerprint / rings claim refused by name;
//   • empty → "See live auctions"; a load error is NOT an empty list (Retry reloads — W3115–W3117 DECOR); keyset Next only.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { MyBid, StorefrontFlags } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { auctionsHref, auctionHref, myBidsHref, auctionStatusKey, bidOutcome, bidOutcomeKey, emdStateKey, wonView } from '../../../../features/store3c/auctions';
import { DirArrow } from '../../../../components/DirArrow';
import { RefusalList } from '../../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('store3c.bids.title'), robots: { index: false, follow: false } };
}

export default async function TenantMyBidsPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor.slice(0, 512) : undefined;
  await requireSession(myBidsHref(slug, cursor));
  const t = getTranslator();
  const lang = getLang();
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.auctions !== true) {
    return (
      <section className="kv-my-bids" data-kv-store={slug} data-kv-state="auctions-off">
        <h1>{t.t('store3c.bids.title')}</h1>
        <div className="kv-state" role="status" data-kv-state="flag-off">
          <p><strong>{t.t('store3c.off.title')}</strong></p>
          <p>{t.t('store3c.off.body', { org })}</p>
        </div>
        <RefusalList surface="bids" />
      </section>
    );
  }

  let items: MyBid[] = [];
  let nextCursor: string | null = null;
  let failed = flags === null;
  if (!failed) {
    try { const page = await serverClient(slug).auctions.myBids({ cursor, limit: 20 }); items = page.items; nextCursor = page.nextCursor; }
    catch { failed = true; }
  }
  const head = (
    <>
      <h1>{t.t('store3c.bids.title')}</h1>
      <p className="kv-detail__muted">{t.t('store3c.bids.lead')}</p>
      <p className="kv-field__hint" data-kv-connection="ip">{t.t('store3c.bids.ip')}</p>
    </>
  );
  if (failed) {
    return (
      <section className="kv-my-bids" data-kv-store={slug}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3c.bids.error')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/auctions/bids`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="bids" />
      </section>
    );
  }

  const money = (minor: string | null | undefined, cur: string | null | undefined) => (minor ? moneyText(minor, cur ?? null, lang) : null) ?? t.t('money.unavailable');
  const when = (iso: string | null | undefined) => (iso ? formatDate(String(iso), lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  return (
    <section className="kv-my-bids" data-kv-store={slug}>
      {head}
      {items.length === 0 ? (
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t('store3c.bids.empty')}</p>
          <Link href={auctionsHref(slug, 'live')} className="kv-btn" data-kv-cta="live">{t.t('store3c.bids.seeLive')}</Link>
        </div>
      ) : (
        <ul className="kv-orders__list" aria-label={t.t('store3c.bids.caption')}>
          {items.map((b) => {
            const unit = b.unitCode ?? '';
            const status = b.status ?? b.auctionStatus;
            const outcome = bidOutcome(b);
            const emd = b.emd ?? { state: 'none' as const, amountMinor: '0', at: null };
            const won = wonView(slug, b.settlement ?? null);
            const s = b.settlement ?? null;
            const cur = b.currencyCode;
            return (
              <li key={b.auctionId} className="kv-orders__row" data-kv-auction={b.auctionId} data-kv-status={status} data-kv-outcome={outcome}>
                <Link href={auctionHref(slug, b.auctionId)} className="kv-link kv-orders__title">{b.listingTitle || t.t('store3c.card.untitled')}</Link>
                <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('store3c.card.lot', { qty: b.quantity ? formatNumber(Number(b.quantity), lang) : '', unit, org: b.organisation?.name ?? org })}</p>
                <p>
                  <span className="kv-chip" data-kv-chip={status}>{t.t(auctionStatusKey(status))}</span>{' '}
                  <span className="kv-chip" data-kv-outcome-chip={outcome}>{t.t(bidOutcomeKey(outcome))}</span>
                </p>
                <p data-kv-best="">{t.t('store3c.bids.best', { price: money(b.myBestMinor ?? b.amountMinor, cur), unit, date: when(b.myBestAt ?? b.createdAt), n: formatNumber(b.myBidCount ?? 1, lang) })}</p>
                {outcome === 'sealed' && <p className="kv-field__hint" data-kv-sealed-placed="">{t.t('store3c.sealed.placed')}</p>}
                {b.isOpen && !b.sealedHidden && b.currentBidMinor && <p data-kv-current="server">{t.t('store3c.card.current', { price: money(b.currentBidMinor, cur), unit })}</p>}
                {b.isOpen && !b.sealedHidden && b.minNextBidMinor && <p data-kv-min-next="server">{t.t('store3c.card.minNext', { price: money(b.minNextBidMinor, cur), unit })}</p>}
                {b.isOpen && <p className="kv-detail__muted">{t.t('store3c.card.ends', { date: when(b.endsAt) })}</p>}
                {b.isOpen && status !== 'scheduled' && (
                  <p><Link href={auctionHref(slug, b.auctionId)} className="kv-btn--link" data-kv-bid-next={b.auctionId}>
                    {outcome === 'sealed' ? t.t('store3c.bids.raiseSealed') : t.t('store3c.bids.bidNext', { price: money(b.minNextBidMinor, cur) })}
                  </Link></p>
                )}
                <p data-kv-emd-state={emd.state}>{t.t(emdStateKey(emd.state), { amount: money(emd.amountMinor, cur), date: when(emd.at) })}</p>
                {s && (
                  <div className="kv-form__notice" data-kv-won={s.orderId} data-kv-settlement={s.outcome}>
                    {won.orderHref && <p><Link href={won.orderHref} className="kv-link" data-kv-order-link={s.orderId}>{t.t('store2c.auction.seeOrder')}</Link></p>}
                    {s.outcome === 'open' && (
                      <p data-kv-deposit-rows="">{t.t('store3c.won.rows', { deposit: money(s.emdAppliedMinor, cur), balance: money(s.amountDueMinor ?? s.balanceDueMinor, cur), date: when(s.balanceDueAt) })}</p>
                    )}
                    {won.pay && (
                      <>
                        <p><Link href={won.pay} className="kv-btn" data-kv-pay-balance={s.orderId}>{t.t('store3c.won.pay')}</Link></p>
                        <p className="kv-field__hint" data-kv-forfeit-warning="">{t.t('store3c.won.forfeitWarning')}</p>
                      </>
                    )}
                    {won.offline && <p className="kv-field__hint" data-kv-offline="">{t.t('store3c.won.offline', { date: when(s.balanceDueAt) })}</p>}
                    {won.outcomeKey && <p data-kv-outcome-line={s.outcome}>{t.t(won.outcomeKey)}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor && <p><Link href={myBidsHref(slug, nextCursor)} className="kv-btn--link" rel="next">{t.t('discover.showMore')} <DirArrow /></Link></p>}
      <RefusalList surface="bids" />
    </section>
  );
}
