// apps/web-tenant/src/app/content/pages/page.tsx · W175 — the cooperative's pages, policies and help articles beside the
// platform defaults they replace · PC-56 TENANT-8c.
//
// W175: *"Static pages, policies and help articles (cms_pages) — markdown body, versioned (a new publish = a new version,
// history kept)"* · *"No pages yet — Platform defaults cover the essentials; your own pages replace them as you publish."*
//
// WHAT THIS PAGE PRINTS, AND FROM WHERE. One row per SLUG (the table is one row per version): your latest version and
// its state, your live version, an open draft, and the platform's live version beside it — and the SERVING column, what
// `by-slug` answers for this cooperative (F-14: your own live version, whatever its number; the platform's only when you
// have none). Keyset on the slug. The kind chips are GET links with live counts (never the canon's 14 · 5 · 4 · 5); the
// state and language filters are a GET form.
//
// WHAT MEMBERS SEE: NOTHING YET, BY NAME. No storefront or mobile code fetches `cms/*`; the panel says so instead of a
// preview of a surface that does not exist. *Translations* is refused by name (the translations table has no tenant
// path). The canon's kebabs and pager numbers are `data-decor` — PARITY-DECOR (a keyset has no page numbers).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsPageIndex } from '@krishalaya/sdk-js';
import {
  FAQ_HREF, NEW_PAGE_HREF, PAGES_HREF, PAGE_KIND_VALUES, SLUG_STATE_VALUES, kindChipHref, kindKey, pageHref, pageStateKey, pagesHref, pagesTransportState,
  refusedKey, servingKey, slugStateKey, type PagesPageState,
} from '../../../features/pages/pages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pages.title'), robots: { index: false, follow: false } };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export default async function PagesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PAGES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const filters = { pageKind: str(searchParams.pageKind), state: str(searchParams.state), languageCode: str(searchParams.languageCode) };
  const cursor = str(searchParams.cursor);

  let idx: CmsPageIndex | null = null;
  let state: PagesPageState | null = null;
  try {
    idx = await tenantClient().cms.pages.list({ pageKind: filters.pageKind ?? undefined, state: filters.state ?? undefined, languageCode: filters.languageCode ?? undefined, cursor: cursor ?? undefined, limit: 50 });
  } catch (e) {
    state = e instanceof SdkError ? pagesTransportState(e.code, e.status) : 'error';
  }
  const filtered = Boolean(filters.pageKind || filters.state || filters.languageCode);
  const c = idx?.counts;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('pages.title')}</h1>
        {idx?.canAuthor && <Link href={NEW_PAGE_HREF} className="kv-btn">{t.t('pages.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('pages.lead')}</p>
      <p className="kv-field__hint"><Link href={FAQ_HREF} className="kv-btn--link">{t.t('pages.toFaq')}</Link></p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W175 "Retry" (→ W2707): a page load, not a mutation — the pages-mutate chain has no route (PARITY-DECOR). */}
              <p><Link href={pagesHref(filters, cursor)} className="kv-btn--link">{t.t('pages.retry')}</Link></p>
              <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
            </>
          )}
        </div>
      )}

      {idx && c && (
        <>
          {/* ---- WHAT MEMBERS SEE — no reader exists; said by name (F-14) ---- */}
          <div className="kv-card kv-card--notice" role="status">
            <p><strong>{t.t('pages.reader.heading')}</strong></p>
            <p>{idx.reader.surfaces.length === 0 ? t.t('pages.reader.none') : t.t('pages.reader.some', { surfaces: idx.reader.surfaces.join(', ') })}</p>
            <p className="kv-field__hint">{t.t('pages.reader.route', { route: idx.reader.route, gap: idx.reader.gap.join(' · ') })}</p>
          </div>

          {/* ---- THE KIND CHIPS: live counts, each a GET link (W2707's "help_article" act is this link) ---- */}
          <nav className="kv-chips" aria-label={t.t('pages.filter.kinds')}>
            <Link href={kindChipHref(filters, null)} className={!filters.pageKind ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={!filters.pageKind ? 'page' : undefined}>
              {t.t('pages.chip.all', { n: formatNumber(c.slugs, lang) })}
            </Link>
            {PAGE_KIND_VALUES.map((k) => (
              <Link key={k} href={kindChipHref(filters, k)} className={filters.pageKind === k ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={filters.pageKind === k ? 'page' : undefined}>
                {t.t('pages.chip.kind', { kind: t.t(kindKey(k)), n: formatNumber(c.byKind[k] ?? 0, lang) })}
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">{t.t('pages.counts', { published: formatNumber(c.byState.published ?? 0, lang), drafts: formatNumber(c.byState.draft_open ?? 0, lang), platform: formatNumber(c.platformOnly, lang) })}</p>

          {/* ---- FILTERS as a GET form: every view is a URL ---- */}
          <form action={PAGES_HREF} method="get" className="kv-form--grid" aria-label={t.t('pages.filter.label')}>
            {filters.pageKind && <input type="hidden" name="pageKind" value={filters.pageKind} />}
            <label className="kv-field" htmlFor="f-state"><span>{t.t('pages.col.status')}</span>
              <select id="f-state" name="state" defaultValue={filters.state ?? ''}>
                <option value="">{t.t('pages.filter.any')}</option>
                {SLUG_STATE_VALUES.map((s) => <option key={s} value={s}>{t.t(slugStateKey(s))}</option>)}
              </select>
            </label>
            <label className="kv-field" htmlFor="f-lang"><span>{t.t('pages.col.language')}</span>
              <input id="f-lang" name="languageCode" defaultValue={filters.languageCode ?? ''} maxLength={8} />
            </label>
            <button type="submit" className="kv-btn">{t.t('pages.filter.apply')}</button>
            {filtered && <Link href={PAGES_HREF} className="kv-btn--link">{t.t('pages.filter.clear')}</Link>}
          </form>

          {idx.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(filtered ? 'pages.emptyFiltered' : 'pages.empty')}</p>
              {!filtered && <p className="kv-field__hint">{t.t('pages.emptyPlatform', { n: formatNumber(c.platformOnly, lang) })}</p>}
              {idx.canAuthor && <p><Link href={NEW_PAGE_HREF} className="kv-btn--link">{t.t('pages.new')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <thead>
                <tr>
                  <th>{t.t('pages.col.page')}</th>
                  <th>{t.t('pages.col.slug')}</th>
                  <th>{t.t('pages.col.kind')}</th>
                  <th>{t.t('pages.col.language')}</th>
                  <th>{t.t('pages.col.version')}</th>
                  <th>{t.t('pages.col.status')}</th>
                  <th>{t.t('pages.col.serving')}</th>
                </tr>
              </thead>
              <tbody>
                {idx.items.map((r) => (
                  <tr key={r.slug}>
                    <td><Link href={pageHref(r.slug)} className="kv-link" lang={r.languageCode ?? undefined}>{r.title}</Link></td>
                    <td><code>{r.slug}</code></td>
                    <td>{t.t(kindKey(r.pageKind))}{r.pageKind === 'policy' && <div className="kv-field__hint">{t.t('pages.needsChecker')}</div>}</td>
                    <td>{r.languageCode ?? <span className="kv-field__hint">{t.t('pages.languageUnrecorded')}</span>}
                      {r.own.rows > 0 && <div className="kv-field__hint">{t.t(refusedKey('translations'))}</div>}
                    </td>
                    <td>{r.own.latestVersion !== null ? `v${r.own.latestVersion}` : <span className="kv-field__hint">{t.t('common.dash')}</span>}
                      {r.own.updatedAt && <div className="kv-field__hint">{formatDate(r.own.updatedAt, lang)}</div>}
                    </td>
                    <td>
                      <span className="kv-badge">{t.t(slugStateKey(r.state))}</span>
                      {r.own.draftVersion !== null && r.state === 'published' && <div className="kv-field__hint">{t.t('pages.draftOpen', { v: String(r.own.draftVersion) })}</div>}
                    </td>
                    <td>
                      {t.t(servingKey(r.serving), { v: String(r.serving.version ?? '') })}
                      {r.platform.version !== null && r.serving.source === 'own' && <div className="kv-field__hint">{t.t('pages.replacesPlatform', { v: String(r.platform.version) })}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t('pages.historyNote')}</p>
          {idx.nextCursor && <p className="kv-pager"><Link href={pagesHref(filters, idx.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}
          <p className="kv-field__hint">{t.t(refusedKey('pager'))}</p>
          {!idx.canPublish && <p className="kv-field__hint">{t.t('pages.cannotPublish')}</p>}
        </>
      )}
    </section>
  );
}
