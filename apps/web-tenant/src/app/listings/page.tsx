// apps/web-tenant/src/app/listings/page.tsx · W123, the listings surface (PC-56 TENANT-2a).
//
// TWO VIEWS, ONE PAGE, DECIDED BY THE REAL GRANT: staff holding `listing.view_any` (W123's "marketplace staff
// scope", grantable since 0128) get the CONSOLE — every seller's listings, one status tab at a time with real
// counts, the QC queue link, and the bulk bar (pause / extend — never price, per the canon's own note). Everyone
// else keeps the owner browse this page always was. Display-side gating only: the API enforces the permission
// on every console read regardless of what this page decides to draw.
//
// Keyset pagination, never OFFSET, and NO page numbers (the roster rule — the canon's "1 2 3 … 16" needs the
// COUNT(*) that takes the list down at scale; the tab counts are the honest totals). The cursor DIES on any tab
// change — a keyset cursor is a position in one ordered set (the 1b lesson, pinned in the spec).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantHasPerm } from '../../lib/auth';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatRelative } from '@krishalaya/i18n';
import type { ListingCard, ConsoleListingRow, ConsoleCounts } from '@krishalaya/sdk-js';
import { PageHeader } from '@krishalaya/ui';
import type { DataTableState } from '@krishalaya/ui';
import { ListingsTable } from '../../components/ListingsTable';
import { CONSOLE_TABS, isConsoleTab, tabHref, statusClass, BULK_MAX } from '../../features/listings/console';
import { bulkListingsAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('listings.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['bulk_none', 'bulk_toomany']);

export default async function ListingsPage({ searchParams }: {
  searchParams: { cursor?: string; created?: string; status?: string; ok?: string; error?: string; done?: string; skipped?: string };
}) {
  await requireSession('/listings');
  const t = getTranslator();
  const lang = getLang();
  const isStaff = tenantHasPerm('listing.view_any');
  const canApprove = tenantHasPerm('listing.approve');

  // ---------- owner view (unchanged path): my own listings, browse read ----------
  if (!isStaff) {
    let items: ListingCard[] = []; let nextCursor: string | null = null; let failed = false;
    try { const p = await tenantClient().listings.browse({ cursor: searchParams.cursor, limit: 50 }); items = p.items; nextCursor = p.nextCursor; }
    catch (e) { failed = true; console.error('[listings] load failed:', e); }
    const state: DataTableState = failed ? 'error' : items.length === 0 ? 'empty' : 'default';
    return (
      <section>
        <PageHeader title={t.t('listings.title')} actions={<Link href="/listings/new" className="kv-btn">{t.t('listings.newCta')}</Link>} />
        {searchParams.created && <p className="kv-success" role="status">{t.t('listingNew.created')}</p>}
        <ListingsTable items={items} state={state} lang={lang} caption={t.t('listings.title')}
          emptyTitle={t.t('listings.empty')} errorTitle={t.t('listings.loadError')}
          colTitle={t.t('listings.colTitle')} colPrice={t.t('listings.colPrice')} colAvailable={t.t('listings.colAvailable')}
          colType={t.t('listings.colType')} colOrganic={t.t('listings.colOrganic')} organicYes={t.t('listings.organicYes')} dash={t.t('common.dash')} />
        {nextCursor && <p className="kv-pager"><a href={`/listings?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
      </section>
    );
  }

  // ---------- staff console (W123) ----------
  const tab = isConsoleTab(searchParams.status) ? searchParams.status : 'all';
  let counts: ConsoleCounts | undefined; let rows: ConsoleListingRow[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const [c, l] = await Promise.all([
      tenantClient().listings.consoleCounts(),
      tenantClient().listings.consoleList({ status: tab === 'all' ? undefined : tab, cursor: searchParams.cursor, limit: 50 }),
    ]);
    counts = c; rows = l.items; nextCursor = l.nextCursor;
  } catch (e) { failed = true; console.error('[listings.console] load failed:', e); }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('listings.title')}</h1>
        <p className="kv-muted">{t.t('lc.sub')}</p>
        <p className="kv-fine">
          {canApprove && <Link href="/listings/qc" className="kv-link">{t.t('lc.qcLink')}{counts ? ` (${counts.pending_approval})` : ''}</Link>}
          {' · '}<Link href="/listings/new" className="kv-link">{t.t('listings.newCta')}</Link>
        </p>
      </div>

      {searchParams.ok?.startsWith('bulk_') && (
        <p className="kv-success" role="status">
          {t.t(`lc.ok.${searchParams.ok}` as never, { done: searchParams.done ?? '0', skipped: searchParams.skipped ?? '0' })}
        </p>
      )}
      {searchParams.error && ERR.has(searchParams.error) && <p className="kv-error" role="alert">{t.t(`lc.error.${searchParams.error}` as never)}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('lc.loadError')}</p>}

      {counts && (
        <nav className="kv-pager" aria-label={t.t('lc.tabsAria')}>
          {CONSOLE_TABS.map((s) => (
            <Link key={s} href={tabHref(s)} className={`kv-btn--link${tab === s ? ' is-active' : ''}`}
              aria-current={tab === s ? 'page' : undefined}>
              {t.t(`lc.tab.${s}` as never)} {s === 'all' ? counts.all : counts[s] ?? 0}
            </Link>
          ))}
        </nav>
      )}

      {!failed && rows.length === 0 && <p className="kv-empty-state">{tab === 'all' ? t.t('lc.emptyNone') : t.t('lc.emptyTab')}</p>}

      {rows.length > 0 && (
        <form action={bulkListingsAction}>
          <input type="hidden" name="status" value={tab === 'all' ? '' : tab} />
          {/* W123's bulk bar — pause / extend only; price is per-listing and audited, so no bulk verb exists for it. */}
          <p className="kv-fine">
            <button type="submit" name="verb" value="pause" className="kv-btn--link">{t.t('lc.bulkPause')}</button>
            {' · '}<button type="submit" name="verb" value="extend" className="kv-btn--link">{t.t('lc.bulkExtend')}</button>
            {' — '}{t.t('lc.bulkNote', { max: String(BULK_MAX) })}
          </p>
          <table className="kv-table">
            <caption className="kv-visually-hidden">{t.t('listings.title')}</caption>
            <thead><tr>
              <th />
              <th>{t.t('lc.col.listing')}</th><th>{t.t('lc.col.seller')}</th><th>{t.t('lc.col.available')}</th>
              <th>{t.t('lc.col.price')}</th><th>{t.t('lc.col.type')}</th><th>{t.t('lc.col.status')}</th><th>{t.t('lc.col.when')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" name="ids" value={r.id} aria-label={t.t('lc.selectRow', { title: r.title })} /></td>
                  <td>
                    <Link href={`/listings/${encodeURIComponent(r.id)}`} className="kv-link">{r.title}</Link>
                    {r.productName && <span className="kv-fine"> · {r.productName}</span>}
                  </td>
                  <td>{r.sellerName ?? t.t('common.dash')}</td>
                  <td>{r.quantityAvailable} / {r.quantityTotal} {r.unitCode}</td>
                  <td>{formatMoneyMinor(r.priceMinor, r.currencyCode, lang)} / {r.unitCode}</td>
                  <td>{r.saleType}</td>
                  <td>
                    <span className={statusClass(r.status)}>{t.t(`lc.tab.${r.status}` as never)}</span>
                    {r.status === 'pending_approval' && canApprove && (
                      <> <Link href={`/listings/qc/${encodeURIComponent(r.id)}`} className="kv-link">{t.t('lc.review')}</Link></>
                    )}
                  </td>
                  <td>{r.publishedAt ? formatRelative(r.publishedAt, lang) : formatRelative(r.createdAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}

      <nav className="kv-pager" aria-label={t.t('lc.pager')}>
        {searchParams.cursor && <Link href={tabHref(tab)} className="kv-btn--link">{t.t('lc.first')}</Link>}
        {nextCursor && <Link href={`${tabHref(tab)}${tab === 'all' ? '?' : '&'}cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</Link>}
      </nav>
      {/* No page numbers next to a keyset pager — the tab counts are the honest totals (the roster rule). */}
      <p className="kv-fine kv-note">{t.t('lc.pagerNote')}</p>
    </section>
  );
}
