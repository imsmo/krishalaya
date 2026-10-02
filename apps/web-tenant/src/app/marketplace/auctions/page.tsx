// apps/web-tenant/src/app/marketplace/auctions/page.tsx · W137 · AUCTIONS · PC-56 TENANT-11a.
// (canon slug `marketplace/auctions`; the old `/auctions` route redirects here.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the lede — TRUE clauses only: the two kinds that are BUILT (english_open, sealed) — reverse and dutch are refused by
//     name; bids are immutable; every bidder's EMD is held in the ledger, and the winner's is applied to the order;
//   • "Schedule auction" → the form chain W2348–W2351;
//   • the five tabs are the API's grouped filters (live · scheduled · awaiting_approval · ended/settled · cancelled/failed)
//     with the API's own counts;
//   • columns Ends · Auction (AUC-number, listing title, quantity + unit) · Kind · Start / reserve (PER UNIT; the reserve
//     only for the seller and the desk — a bidder sees "reserve set") · Current bid (per unit + the lot value; "sealed
//     until close" while a sealed auction runs) · Bidders (distinct) · Status (with the seller's decision deadline);
//   • row link Monitor → W138 (scheduled / live), Review → W139 (ended); "Showing N of M"; µs keyset pages;
//   • the anti-snipe note in the API's own numbers; the same-IP sentence is NOT printed as fact (no same-IP check runs);
//   • states: content, Loading (loading.tsx), Flagged off (the API's `auctions` flag answers 404 — the canon's words),
//     Restricted (403 — distinct from a load error), Couldn't load (Retry = a page load), and the two empty states.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { Auction, AuctionPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { AUCTIONS_HREF, AUCTION_GROUPS, MARKETPLACE_HREF, NEW_AUCTION_HREF, consoleState, cursorFrom, isGroup, kindKey, pageHref, qtyText, rowHref, statusKey, tabHref } from '../../../features/auctions/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function AuctionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(AUCTIONS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const tab = isGroup(searchParams.tab) ? searchParams.tab : 'live';
  const cursor = cursorFrom(searchParams.cursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}>
      <Link href={MARKETPLACE_HREF}>{t.t('auc.breadcrumb.marketplace')}</Link> / <span aria-current="page">{t.t('auc.breadcrumb.auctions')}</span>
    </nav>
  );
  const flaggedOff = (
    <section>{crumbs}<h1>{t.t('auc.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('auc.state.flaggedOff.title')}</strong><p>{t.t('auc.state.flaggedOff.body')}</p></div></section>
  );
  if (!env.featureAuctions) return flaggedOff;

  let state: string | null = null;
  let page: AuctionPage = { items: [], nextCursor: null, total: 0, counts: null };
  try { page = await tenantClient().auctions.list({ group: tab, cursor, limit: PAGE }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') return flaggedOff;
  const totalAll = page.counts ? Object.values(page.counts).reduce((s, x) => s + x, 0) : 0;
  const perUnit = (minor: string | null | undefined, unit: string | undefined) => t.t('auc.perUnit', { price: money(minor), unit: unit ?? '' });

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('auc.title')}</h1>
        <p className="kv-actions"><Link href={`${NEW_AUCTION_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('auc.schedule')}</Link></p>
      </div>
      <p className="kv-field__hint">{t.t('auc.lede')}</p>
      <p className="kv-field__hint">{t.t('auc.refused.kinds')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`auc.state.${state}.title`)}</strong><p>{t.t(`auc.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(AUCTIONS_HREF, cursor, { tab })} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('auc.retry')}</Link></p>}
        </div>
      )}

      {!state && (
        <>
          <nav className="kv-pager" aria-label={t.t('auc.tabs')}>
            {AUCTION_GROUPS.map((g) => (
              <Link key={g} href={tabHref(g)} className={`kv-btn--link${g === tab ? ' is-active' : ''}`} aria-current={g === tab ? 'page' : undefined}>
                {t.t(`auc.tab.${g}`)} ({n(page.counts?.[g] ?? 0)})
              </Link>
            ))}
          </nav>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(totalAll === 0 ? 'auc.empty.none.title' : 'auc.empty.tab.title')}</strong>
              <p className="kv-detail__muted">{t.t(totalAll === 0 ? 'auc.empty.none.body' : 'auc.empty.tab.body')}</p>
              <Link href={`${NEW_AUCTION_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('auc.schedule')}</Link>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('auc.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col">{t.t('auc.col.ends')}</th><th scope="col">{t.t('auc.col.auction')}</th><th scope="col">{t.t('auc.col.kind')}</th>
                <th scope="col">{t.t('auc.col.startReserve')}</th><th scope="col">{t.t('auc.col.currentBid')}</th><th scope="col">{t.t('auc.col.bidders')}</th>
                <th scope="col">{t.t('auc.col.status')}</th><th scope="col">{t.t('auc.col.open')}</th>
              </tr></thead>
              <tbody>{page.items.map((a: Auction) => {
                const open = rowHref(a);
                return (
                  <tr key={a.auctionId}>
                    <td>{a.status === 'ended' || a.status === 'settled' || a.status === 'defaulted' || a.status === 'awaiting_approval'
                      ? t.t('auc.endedAt', { at: when(a.endedAt ?? a.endsAt) }) : when(a.endsAt)}</td>
                    <th scope="row"><Link href={open.href} className="kv-link">{a.auctionNo ?? a.auctionId.slice(0, 8)}</Link>
                      <div className="kv-field__hint">{t.t('auc.lot', { title: a.listingTitle ?? t.t('auc.listingGone'), qty: qtyText(a.quantity), unit: a.unitCode ?? '' })}</div></th>
                    <td>{t.t(kindKey(a.kind))}</td>
                    <td>{perUnit(a.startPriceMinor, a.unitCode)}
                      <div className="kv-field__hint">{a.reservePriceMinor ? t.t('auc.reserve', { price: perUnit(a.reservePriceMinor, a.unitCode) })
                        : a.reserveHidden ? t.t('auc.reserveHidden') : t.t('auc.noReserve')}</div></td>
                    <td>{a.sealedHidden ? <span className="kv-field__hint">{t.t('auc.sealedUntilClose')}</span>
                      : a.highBidMinor ? <>{perUnit(a.highBidMinor, a.unitCode)}<div className="kv-field__hint">{t.t('auc.lotValue', { value: money(a.highLotValueMinor) })}</div></>
                      : <span className="kv-field__hint">{t.t('auc.noBids')}</span>}</td>
                    <td>{n(a.bidderCount ?? 0)}</td>
                    <td>{t.t(statusKey(a.status))}
                      {a.status === 'awaiting_approval' && a.decisionDueAt && <div className="kv-field__hint">{t.t('auc.decideBy', { at: when(a.decisionDueAt) })}</div>}
                      {a.entryPaused && <div className="kv-field__hint">{t.t('auc.entryPaused')}</div>}</td>
                    <td><Link href={open.href} className="kv-btn--link">{t.t(open.key)}</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={pageHref(AUCTIONS_HREF, page.nextCursor, { tab })} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('auc.nextPage')}</Link></p>}
          <p className="kv-card kv-card--notice">{t.t('auc.antiSnipeNote')}</p>
          <p className="kv-field__hint">{t.t('auc.integrityNotRun')}</p>
        </>
      )}
    </section>
  );
}
