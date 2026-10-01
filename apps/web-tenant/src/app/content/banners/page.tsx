// apps/web-tenant/src/app/content/banners/page.tsx · W173 — the cooperative's app banners · PC-56 TENANT-8d.
//
// W173: *"What members see in their app: per placement × language × audience. A banner without a Gujarati variant simply
// doesn't show to Gujarati-first members — no English fallback surprises."* · *"live/scheduled/ended are derived from the
// window + is_active — no status column exists"* · *"Text lives in the banner record, never baked into the image."*
//
// WHAT THIS PAGE PRINTS, AND FROM WHERE. One row per banner (0178): its headline from `banner_texts` (the console's
// language if the banner speaks it), the placement from the vocabulary, the languages it speaks and the REQUIRED ones it
// does not ("(en missing)" — it cannot be activated until they have words), the declared audience, the window as the
// cooperative's wall-clock in its zone, the phase (the state, and for an active banner scheduled · live · ended by the
// window — computed at read time, F-21) and the clicks recorded. Keyset; the phase and placement chips are GET links
// with LIVE counts (never the canon's "4 of 11"); the language filter is a GET form.
//
// WHAT MEMBERS SEE: NOTHING YET, BY NAME. No storefront or mobile code fetches `cms/banners`; the panel says so instead of
// a preview of a surface that does not exist. Impressions are refused by name (no reader, no counter). The canon's kebabs
// and pager numbers are `data-decor` — PARITY-DECOR; "Couldn't load → Retry" (→ W2514) is a page load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsBannerIndex } from '@krishalaya/sdk-js';
import {
  BANNERS_HREF, BANNER_PHASE_VALUES, NEW_BANNER_HREF, REQUIRED_LANGUAGES, bannerHref, bannersHref, bannersTransportState, chipHref, headlineFor, isKnownPlacement, languagesCell,
  pageStateKey, phaseKey, placementKey, refusedKey, windowText, type BannersPageState,
} from '../../../features/banners/banners';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('banners.title'), robots: { index: false, follow: false } };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export default async function BannersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(BANNERS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const filters = { phase: str(searchParams.phase), placement: str(searchParams.placement), languageCode: str(searchParams.languageCode) };
  const cursor = str(searchParams.cursor);

  let idx: CmsBannerIndex | null = null;
  let state: BannersPageState | null = null;
  try {
    idx = await tenantClient().cms.banners.list({ phase: filters.phase ?? undefined, placement: filters.placement ?? undefined, languageCode: filters.languageCode ?? undefined, cursor: cursor ?? undefined, limit: 50 });
  } catch (e) {
    state = e instanceof SdkError ? bannersTransportState(e.code, e.status) : 'error';
  }
  const filtered = Boolean(filters.phase || filters.placement || filters.languageCode);
  const c = idx?.counts;
  const placementName = (code: string) => (isKnownPlacement(code) ? t.t(placementKey(code)) : idx?.placements.find((p) => p.code === code)?.name ?? code);

  return (
    <section>
      <nav aria-label={t.t('banners.breadcrumb')} className="kv-field__hint">
        <Link href="/content/pages" className="kv-btn--link">{t.t('nav.pages')}</Link> · <Link href="/content/faq" className="kv-btn--link">{t.t('nav.faq')}</Link>
      </nav>
      <div className="kv-page-head">
        <h1>{t.t('banners.title')}</h1>
        {idx?.canManage && <Link href={NEW_BANNER_HREF} className="kv-btn">{t.t('banners.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('banners.lead')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W173 "Couldn't load banners → Retry" (→ W2514): a page load, not a mutation (PARITY-DECOR). */}
              <p><Link href={bannersHref(filters, cursor)} className="kv-btn--link">{t.t('banners.retry')}</Link></p>
              <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
            </>
          )}
        </div>
      )}

      {idx && c && (
        <>
          {/* ---- WHAT MEMBERS SEE — no reader exists; said by name (F-14) ---- */}
          <div className="kv-card kv-card--notice" role="status">
            <p><strong>{t.t('banners.reader.heading')}</strong></p>
            <p>{idx.reader.surfaces.length === 0 ? t.t('banners.reader.none') : t.t('banners.reader.some', { surfaces: idx.reader.surfaces.join(', ') })}</p>
            <p className="kv-field__hint">{t.t('banners.reader.route', { route: idx.reader.route, gap: idx.reader.gap.join(' · ') })}</p>
            <p className="kv-field__hint">{t.t('banners.requiredLanguages', { langs: idx.requiredLanguages.join(' · ') })}</p>
          </div>

          {/* ---- THE CHIPS: live counts, each a GET link ---- */}
          <nav className="kv-chips" aria-label={t.t('banners.filter.placements')}>
            <Link href={chipHref(filters, 'placement', null)} className={!filters.placement ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={!filters.placement ? 'page' : undefined}>
              {t.t('banners.chip.allPlacements', { n: formatNumber(c.total, lang) })}
            </Link>
            {idx.placements.filter((p) => p.chosen || (c.byPlacement[p.code] ?? 0) > 0).map((p) => (
              <Link key={p.code} href={chipHref(filters, 'placement', p.code)} className={filters.placement === p.code ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={filters.placement === p.code ? 'page' : undefined}>
                {t.t('banners.chip.count', { name: placementName(p.code), n: formatNumber(c.byPlacement[p.code] ?? 0, lang) })}
              </Link>
            ))}
          </nav>
          <nav className="kv-chips" aria-label={t.t('banners.filter.phases')}>
            <Link href={chipHref(filters, 'phase', null)} className={!filters.phase ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={!filters.phase ? 'page' : undefined}>{t.t('banners.chip.anyPhase')}</Link>
            {BANNER_PHASE_VALUES.map((p) => (
              <Link key={p} href={chipHref(filters, 'phase', p)} className={filters.phase === p ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={filters.phase === p ? 'page' : undefined}>
                {t.t('banners.chip.count', { name: t.t(phaseKey(p)), n: formatNumber(c.byPhase[p] ?? 0, lang) })}
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">{t.t('banners.phaseNote')}</p>

          {/* ---- THE LANGUAGE FILTER as a GET form: every view is a URL ---- */}
          <form action={BANNERS_HREF} method="get" className="kv-form--grid" aria-label={t.t('banners.filter.label')}>
            {filters.phase && <input type="hidden" name="phase" value={filters.phase} />}
            {filters.placement && <input type="hidden" name="placement" value={filters.placement} />}
            <label className="kv-field" htmlFor="b-lang"><span>{t.t('banners.filter.language')}</span>
              <select id="b-lang" name="languageCode" defaultValue={filters.languageCode ?? ''}>
                <option value="">{t.t('banners.filter.anyLanguage')}</option>
                {[...new Set([...REQUIRED_LANGUAGES, ...idx.items.flatMap((i) => i.languages)])].map((l) => <option key={l} value={l} lang={l}>{l}</option>)}
              </select>
            </label>
            <button type="submit" className="kv-btn">{t.t('banners.filter.apply')}</button>
            {filtered && <Link href={BANNERS_HREF} className="kv-btn--link">{t.t('banners.filter.clear')}</Link>}
          </form>

          {idx.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p><strong>{t.t(filtered ? 'banners.emptyFiltered' : 'banners.empty')}</strong></p>
              {!filtered && <p className="kv-field__hint">{t.t('banners.emptyHint')}</p>}
              {idx.canManage && <p><Link href={NEW_BANNER_HREF} className="kv-btn--link">{t.t('banners.new')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <thead>
                <tr>
                  <th>{t.t('banners.col.banner')}</th>
                  <th>{t.t('banners.col.placement')}</th>
                  <th>{t.t('banners.col.languages')}</th>
                  <th>{t.t('banners.col.audience')}</th>
                  <th>{t.t('banners.col.window')}</th>
                  <th>{t.t('banners.col.phase')}</th>
                  <th>{t.t('banners.col.clicks')}</th>
                  <th><span className="kv-sr-only">{t.t('banners.col.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {idx.items.map((r) => {
                  const h = headlineFor(r.texts, lang);
                  const cell = languagesCell(r.languages, r.missingLanguages);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={bannerHref(r.id)} className="kv-link" lang={h?.lang}>{h ? h.text : t.t('banners.noWords')}</Link>
                        {r.groupKey && <div className="kv-field__hint">{t.t('banners.group', { key: r.groupKey })}</div>}
                      </td>
                      <td>{placementName(r.placement)}<div className="kv-field__hint">{t.t('banners.slotPlace', { n: String(r.slotOrder) })}</div></td>
                      <td>{cell.speaks || t.t('common.dash')}{cell.missing && <div className="kv-field__hint">{t.t('banners.missing', { langs: cell.missing })}</div>}</td>
                      <td>{r.everyone ? t.t('banners.audience.everyone') : t.t('banners.audience.rule', { roles: r.audience.roles.join(', ') || t.t('banners.audience.anyRole'), regions: String(r.audience.regions.length) })}</td>
                      <td>{windowText(r.startsLocal, r.endsLocal)}<div className="kv-field__hint">{r.timezone}</div></td>
                      <td><span className="kv-badge">{t.t(phaseKey(r.phase))}</span>{r.state === 'paused' && r.pausedReason && <div className="kv-field__hint">{r.pausedReason}</div>}</td>
                      <td>{formatNumber(r.clickCount, lang)}</td>
                      <td><button type="button" aria-label={t.t('banners.rowActions')} data-decor className="kv-btn--link">⋯</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {idx.nextCursor && <p className="kv-pager"><Link href={bannersHref(filters, idx.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}
          <p className="kv-field__hint">{t.t(refusedKey('pager'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('impressions'))}</p>
          <p className="kv-field__hint">{t.t('banners.i18nLaw')}</p>
          {!idx.canManage && <p className="kv-field__hint">{t.t('banners.cannotManage')}</p>}
        </>
      )}
    </section>
  );
}
