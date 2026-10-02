// apps/web-tenant/src/app/marketplace/requirements/page.tsx · W131 · BUYER REQUIREMENTS · PC-56 TENANT-11d.
// (canon slug `marketplace/requirements`; the old `/requirements` route redirects here.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • breadcrumb Marketplace › Requirements; the lede is HONEST: matching member stock to a requirement is RULE-BASED (same
//     product, same unit, cheapest first) — the canon's "AI matches" is refused by name (no AI score exists);
//   • "Post requirement (as buyer desk)" → the form chain W2371–W2374 (for a named buyer with the buyer's consent);
//   • the status tabs are real `status` filters over the desk's board (`box=all` — every requirement in this tenant; tenant RLS
//     confines it to this tenant's members), with the API's counts;
//   • columns Need by ▴ (a real keyset sort, `sort=need_by`) · Requirement (REQ number + title) · Buyer (short name; no
//     organisation name is recorded — said so) · Qty (filled of asked) · Budget (a ceiling) · Responses (the SQL count) · Status;
//   • row "Match" → the requirement (W132); "Showing N of M"; µs keyset pages;
//   • states: content, Loading (loading.tsx), Flagged off (the API's `requirements` flag answers 404 — the canon's words),
//     Restricted (403 — the board is the desk's), Couldn't load (Retry = a page load), and the two empty states. "Check the demand
//     map" is refused by name (no demand map exists).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { Requirement, RequirementPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import {
  MARKETPLACE_HREF, NEW_REQ_HREF, REQUIREMENTS_HREF, REQ_TABS, budgetShape, consoleState, cursorFrom, isTab, pageHref, qtyText, reqHref, statusKey, tabHref,
} from '../../../features/requirements/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rq.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function RequirementsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(REQUIREMENTS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const n = (v: number) => formatNumber(v, lang);
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string) => formatDate(`${d}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  const tab = isTab(searchParams.tab) ? searchParams.tab : 'all';
  const sort = searchParams.sort === 'need_by' ? 'need_by' : 'recent';
  const cursor = cursorFrom(searchParams.cursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('rq.breadcrumb')}>
      <Link href={MARKETPLACE_HREF}>{t.t('rq.breadcrumb.marketplace')}</Link> / <span aria-current="page">{t.t('rq.breadcrumb.requirements')}</span>
    </nav>
  );

  let state: string | null = null;
  let page: RequirementPage = { items: [], nextCursor: null, counts: null, total: null };
  try { page = await tenantClient().requirements.list({ box: 'all', status: tab === 'all' ? undefined : tab, sort, counts: true, cursor, limit: PAGE }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') {
    return <section>{crumbs}<h1>{t.t('rq.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('rq.state.flaggedOff.title')}</strong><p>{t.t('rq.state.flaggedOff.body')}</p></div></section>;
  }
  const counts = page.counts ?? {};
  const totalAll = page.total ?? Object.values(counts).reduce((s, x) => s + (x ?? 0), 0);
  const keep: Record<string, string> = { ...(tab === 'all' ? {} : { tab }), ...(sort === 'need_by' ? { sort } : {}) };
  const budget = (r: Requirement) => {
    const shape = budgetShape(r.budgetMinMinor, r.budgetMaxMinor);
    if (shape === 'none') return t.t('rq.budget.none');
    if (shape === 'range') return t.t('rq.budget.range', { min: money(r.budgetMinMinor!), max: money(r.budgetMaxMinor!), unit: r.unitCode });
    if (shape === 'max') return t.t('rq.budget.max', { max: money(r.budgetMaxMinor!), unit: r.unitCode });
    return t.t('rq.budget.min', { min: money(r.budgetMinMinor!), unit: r.unitCode });
  };

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('rq.title')}</h1>
        <p className="kv-actions"><Link href={`${NEW_REQ_HREF}?step=edit&asDesk=1`} className="kv-btn kv-btn--primary">{t.t('rq.post')}</Link></p>
      </div>
      <p className="kv-field__hint">{t.t('rq.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`rq.state.${state}.title`)}</strong><p>{t.t(`rq.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(REQUIREMENTS_HREF, cursor, keep)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('rq.retry')}</Link></p>}
        </div>
      )}

      {!state && (
        <>
          <nav className="kv-pager" aria-label={t.t('rq.tabs')}>
            {REQ_TABS.map((s) => (
              <Link key={s} href={tabHref(s, sort)} className={`kv-btn--link${s === tab ? ' is-active' : ''}`} aria-current={s === tab ? 'page' : undefined}>
                {t.t(`rq.tab.${s}`)} ({n(s === 'all' ? totalAll : counts[s] ?? 0)})
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">{t.t('rq.boardRule')}</p>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(totalAll === 0 ? 'rq.empty.none.title' : 'rq.empty.tab.title')}</strong>
              <p className="kv-detail__muted">{t.t(totalAll === 0 ? 'rq.empty.none.body' : 'rq.empty.tab.body')}</p>
              <p className="kv-field__hint">{t.t('rq.demandMapRefused')}</p>
              <Link href={`${NEW_REQ_HREF}?step=edit&asDesk=1`} className="kv-btn kv-btn--sm">{t.t('rq.post')}</Link>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('rq.showing', { n: n(page.items.length), m: n(tab === 'all' ? totalAll : counts[tab] ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col" aria-sort={sort === 'need_by' ? 'ascending' : 'none'}>
                  <Link href={pageHref(REQUIREMENTS_HREF, null, { ...(tab === 'all' ? {} : { tab }), ...(sort === 'need_by' ? {} : { sort: 'need_by' }) })} className="kv-btn--link">
                    {t.t(sort === 'need_by' ? 'rq.col.needBySorted' : 'rq.col.needBy')}</Link></th>
                <th scope="col">{t.t('rq.col.requirement')}</th><th scope="col">{t.t('rq.col.buyer')}</th><th scope="col">{t.t('rq.col.qty')}</th>
                <th scope="col">{t.t('rq.col.budget')}</th><th scope="col">{t.t('rq.col.responses')}</th><th scope="col">{t.t('rq.col.status')}</th><th scope="col">{t.t('rq.col.match')}</th>
              </tr></thead>
              <tbody>{page.items.map((r: Requirement) => (
                <tr key={r.id}>
                  <td>{r.needBy ? day(r.needBy) : t.t('rq.needBy.none')}{r.isUrgent && <div className="kv-field__hint"><strong>{t.t('rq.urgent')}</strong></div>}</td>
                  <th scope="row"><Link href={reqHref(r.id)} className="kv-link">{r.reqNo ?? r.id.slice(0, 8)}</Link><div className="kv-field__hint">{r.title}</div></th>
                  <td>{r.buyerShortName ?? t.t('rq.nameNotRecorded')}<div className="kv-field__hint">{t.t('rq.orgNotRecorded')}</div>
                    {r.onBehalf && <div className="kv-field__hint">{t.t('rq.postedByDesk', { name: r.postedByShortName ?? t.t('rq.nameNotRecorded') })}</div>}</td>
                  <td>{t.t('rq.qtyFilled', { filled: qtyText(r.fulfilledQuantity ?? '0'), qty: qtyText(r.quantity), unit: r.unitCode })}</td>
                  <td>{budget(r)}</td>
                  <td>{n(r.responsesCount ?? 0)}{(r.responsesCount ?? 0) === 0 && <span className="kv-field__hint"> {t.t('rq.responsesNew')}</span>}</td>
                  <td><span className="kv-badge">{t.t(statusKey(r.status))}</span></td>
                  <td><Link href={reqHref(r.id)} className="kv-btn--link">{t.t('rq.match')}</Link></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={pageHref(REQUIREMENTS_HREF, page.nextCursor, keep)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('rq.nextPage')}</Link></p>}
          <p className="kv-card kv-card--notice">{t.t('rq.lifecycleNote')}</p>
          <p className="kv-field__hint">{t.t('rq.restrictedNote')}</p>
        </>
      )}
    </section>
  );
}
