// apps/web-tenant/src/app/marketplace/group-lots/page.tsx · W135 · GROUP LOTS · PC-56 TENANT-11c.
// (canon slug `marketplace/group-lots`; the old `/group-lots` route redirects here.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • breadcrumb Marketplace › Group lots; the lede's lifecycle is TRUE now — every edge has a writer (ready at target or by
//     hand, list = one listing, sold = the sale order completed and its seller net is held, settled = a second person confirmed);
//   • "New group lot" → the form chain W2629–W2632;
//   • the six status tabs are real `status` filters with the API's counts (+ All);
//   • columns Deadline ▴ (a real keyset sort, `sort=deadline`) · Lot (GL number + product → listing / auction link) · Coordinator
//     (short name) · Pledged / target (%) · Members (active pledgers) · Status ("listed · auction <date>" when an auction holds it);
//   • row "Rally" → the nudge (mutate chain) on a pledging lot the viewer coordinates; "Showing N of M"; µs keyset pages;
//   • the coordinator-options note in the canon's words — every option it names is now a real act;
//   • states: content, Loading (loading.tsx), Flagged off (the API's `group_lots` flag answers 404 — the canon's words),
//     Restricted (403 — distinct from a load error), Couldn't load (Retry = a page load), and the two empty states.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { GroupLot, GroupLotPage } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  GROUP_LOTS_HREF, LOT_TABS, MARKETPLACE_HREF, NEW_LOT_HREF, actHref, auctionHref, consoleState, cursorFrom, isTab, lotHref, pageHref, progressPct, qtyText,
  rowRally, statusKey, tabHref,
} from '../../../features/group-lots/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function GroupLotsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(GROUP_LOTS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const tab = isTab(searchParams.tab) ? searchParams.tab : 'all';
  const sort = searchParams.sort === 'deadline' ? 'deadline' : 'recent';
  const cursor = cursorFrom(searchParams.cursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('gl.breadcrumb')}>
      <Link href={MARKETPLACE_HREF}>{t.t('gl.breadcrumb.marketplace')}</Link> / <span aria-current="page">{t.t('gl.breadcrumb.groupLots')}</span>
    </nav>
  );
  const flaggedOff = (
    <section>{crumbs}<h1>{t.t('gl.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.state.flaggedOff.title')}</strong><p>{t.t('gl.state.flaggedOff.body')}</p></div></section>
  );
  if (!env.featureGroupLots) return flaggedOff;

  let state: string | null = null;
  let page: GroupLotPage = { items: [], nextCursor: null, total: 0, counts: null };
  try { page = await tenantClient().groupLots.list({ box: 'all', status: tab === 'all' ? undefined : tab, sort, counts: true, cursor, limit: PAGE }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') return flaggedOff;
  const counts = page.counts ?? {};
  const totalAll = Object.values(counts).reduce((s, x) => s + (x ?? 0), 0);
  const keep: Record<string, string> = { ...(tab === 'all' ? {} : { tab }), ...(sort === 'deadline' ? { sort } : {}) };

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('gl.title')}</h1>
        <p className="kv-actions"><Link href={`${NEW_LOT_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('gl.new')}</Link></p>
      </div>
      <p className="kv-field__hint">{t.t('gl.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`gl.state.${state}.title`)}</strong><p>{t.t(`gl.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(GROUP_LOTS_HREF, cursor, keep)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.retry')}</Link></p>}
        </div>
      )}

      {!state && (
        <>
          <nav className="kv-pager" aria-label={t.t('gl.tabs')}>
            {LOT_TABS.map((s) => (
              <Link key={s} href={tabHref(s, sort)} className={`kv-btn--link${s === tab ? ' is-active' : ''}`} aria-current={s === tab ? 'page' : undefined}>
                {t.t(`gl.tab.${s}`)} ({n(s === 'all' ? totalAll : counts[s] ?? 0)})
              </Link>
            ))}
          </nav>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(totalAll === 0 ? 'gl.empty.none.title' : 'gl.empty.tab.title')}</strong>
              <p className="kv-detail__muted">{t.t(totalAll === 0 ? 'gl.empty.none.body' : 'gl.empty.tab.body')}</p>
              <Link href={`${NEW_LOT_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('gl.new')}</Link>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('gl.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col" aria-sort={sort === 'deadline' ? 'ascending' : 'none'}>
                  <Link href={pageHref(GROUP_LOTS_HREF, null, { ...(tab === 'all' ? {} : { tab }), ...(sort === 'deadline' ? {} : { sort: 'deadline' }) })} className="kv-btn--link">
                    {t.t(sort === 'deadline' ? 'gl.col.deadlineSorted' : 'gl.col.deadline')}</Link></th>
                <th scope="col">{t.t('gl.col.lot')}</th><th scope="col">{t.t('gl.col.coordinator')}</th><th scope="col">{t.t('gl.col.pledged')}</th>
                <th scope="col">{t.t('gl.col.members')}</th><th scope="col">{t.t('gl.col.status')}</th><th scope="col">{t.t('gl.col.open')}</th>
              </tr></thead>
              <tbody>{page.items.map((g: GroupLot) => (
                <tr key={g.id}>
                  <td>{when(g.pledgeDeadline)}{g.extendedOnce && <div className="kv-field__hint">{t.t('gl.extendedOnce')}</div>}</td>
                  <th scope="row"><Link href={lotHref(g.id)} className="kv-link">{g.lotNo ?? g.id.slice(0, 8)}</Link>
                    <div className="kv-field__hint">{g.productName ?? t.t('gl.productUnknown')}</div>
                    {g.auction ? <div className="kv-field__hint"><Link href={auctionHref(g.auction.id)} className="kv-btn--link">→ {g.auction.auctionNo}</Link></div>
                      : g.listing ? <div className="kv-field__hint"><Link href={`/listings/${encodeURIComponent(g.listing.id)}`} className="kv-btn--link">→ {t.t('gl.listingLink')}</Link></div> : null}</th>
                  <td>{g.coordinatorShortName ?? t.t('gl.nameNotRecorded')}</td>
                  <td>{t.t('gl.pledgedOfTarget', { pledged: qtyText(g.pledgedQuantity), target: qtyText(g.targetQuantity), unit: g.unitCode, pct: progressPct(g.progressBps) })}</td>
                  <td>{n(g.memberCount ?? 0)}</td>
                  <td>{t.t(statusKey(g.status))}
                    {g.status === 'listed' && g.auction && <div className="kv-field__hint">{t.t('gl.listedAuction', { at: when(g.auction.endsAt) })}</div>}</td>
                  <td>{rowRally(g) ? <Link href={actHref(g.id, 'nudge')} className="kv-btn--link">{t.t('gl.rally')}</Link>
                    : <Link href={lotHref(g.id)} className="kv-btn--link">{t.t('gl.open')}</Link>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={pageHref(GROUP_LOTS_HREF, page.nextCursor, keep)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.nextPage')}</Link></p>}
          <p className="kv-card kv-card--notice">{t.t('gl.optionsNote')}</p>
          <p className="kv-field__hint">{t.t('gl.restrictedNote')}</p>
        </>
      )}
    </section>
  );
}
