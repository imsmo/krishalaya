// apps/web-tenant/src/app/content/faq/page.tsx · W177 — the cooperative's FAQ: `cms_pages` with page_kind = faq, grouped
// by topic, in their place · PC-56 TENANT-8c.
//
// W177: *"cms_pages with page_kind: faq — grouped by topic, answer-first writing"* · tiles *Entries 32 (gu 32 · hi 28 · en
// 24)*, *Self-serve rate 61%*, *Top gap this month* · table Question · Topic · Views 30d · Deflection · Status · *Review &
// publish* on a drafted row · *New FAQ entry* → W2605.
//
// WHAT IS REAL. Entries, by topic (0177's vocabulary) and place (`sort_order`, moved one step at a time by the keyed,
// audited reorder act → W2609's chain); the counts are live (entries · published · drafts · per SOURCE language — an entry
// is written in one language; translations have no tenant path, so "hi 28 · en 24" cannot be counted and is refused by
// name); *Review & publish* is the page mutate chain's publish (W2700); *Open* is W176.
// REFUSED BY NAME: Self-serve rate, Views 30d, Deflection, Top gap (no view counter on pages, no page ↔ ticket link,
// no ticket-text clustering), the English gloss under a Gujarati question (translations), voice playback (no TTS on
// pages), the finance-desk read of payment answers (no finance checker on a page — the policy checker is the one rule).
// The pager is PARITY-DECOR (the list is bounded and says so when it is cut).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsFaqIndex } from '@krishalaya/sdk-js';
import {
  FAQ_HREF, NEW_FAQ_HREF, PAGES_HREF, SLUG_STATE_VALUES, faqHref, faqMoveHref, groupByTopic, isKnownTopic, moveLabelKey, pageActHref, pageHref, pageStateKey, pagesTransportState,
  refusedKey, slugStateKey, topicKey, type PagesPageState,
} from '../../../features/pages/pages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('faq.title'), robots: { index: false, follow: false } };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export default async function FaqPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(FAQ_HREF);
  const t = getTranslator();
  const lang = getLang();
  const filters = { topic: str(searchParams.topic), state: str(searchParams.state) };
  let idx: CmsFaqIndex | null = null;
  let state: PagesPageState | null = null;
  try { idx = await tenantClient().cms.faq.list({ topic: filters.topic ?? undefined, state: filters.state ?? undefined }); }
  catch (e) { state = e instanceof SdkError ? pagesTransportState(e.code, e.status) : 'error'; }
  const filtered = Boolean(filters.topic || filters.state);
  const topicName = (code: string) => (isKnownTopic(code) ? t.t(topicKey(code)) : idx?.topics.find((x) => x.code === code)?.name ?? code);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('faq.title')}</h1>
        {idx?.canAuthor && <Link href={NEW_FAQ_HREF} className="kv-btn">{t.t('faq.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('faq.lead')}</p>
      <p className="kv-field__hint"><Link href={PAGES_HREF} className="kv-btn--link">{t.t('faq.toPages')}</Link></p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W177 "Retry" (→ W2609): a page load, not a mutation — PARITY-DECOR. */}
              <p><Link href={faqHref(filters)} className="kv-btn--link">{t.t('pages.retry')}</Link></p>
              <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
            </>
          )}
          {state === 'restricted' && <p className="kv-field__hint">{t.t(refusedKey('financeRead'))}</p>}
        </div>
      )}

      {idx && (
        <>
          <div className="kv-cards">
            <div className="kv-card">
              <p className="kv-field__hint">{t.t('faq.tile.entries')}</p>
              <p><strong>{formatNumber(idx.tiles.entries, lang)}</strong></p>
              <p className="kv-field__hint">{t.t('faq.tile.entriesHint', { published: formatNumber(idx.tiles.published, lang), drafts: formatNumber(idx.tiles.drafts, lang) })}</p>
              <p className="kv-field__hint">{idx.tiles.bySourceLanguage.length > 0 ? idx.tiles.bySourceLanguage.map((x) => `${x.code} ${formatNumber(x.n, lang)}`).join(' · ') : t.t('common.dash')} · {t.t('faq.tile.sourceOnly')}</p>
            </div>
            <div className="kv-card">
              <p className="kv-field__hint">{t.t('faq.tile.selfServe')}</p>
              <p><strong>{t.t('common.dash')}</strong></p>
              <p className="kv-field__hint">{t.t(refusedKey('selfServe'))}</p>
            </div>
            <div className="kv-card">
              <p className="kv-field__hint">{t.t('faq.tile.topGap')}</p>
              <p><strong>{t.t('common.dash')}</strong></p>
              <p className="kv-field__hint">{t.t(refusedKey('topGap'))}</p>
            </div>
          </div>

          <form action={FAQ_HREF} method="get" className="kv-form--grid" aria-label={t.t('faq.filter.label')}>
            <label className="kv-field" htmlFor="f-topic"><span>{t.t('faq.col.topic')}</span>
              <select id="f-topic" name="topic" defaultValue={filters.topic ?? ''}>
                <option value="">{t.t('pages.filter.any')}</option>
                {idx.topics.map((x) => <option key={x.code} value={x.code}>{topicName(x.code)}</option>)}
              </select>
            </label>
            <label className="kv-field" htmlFor="f-state"><span>{t.t('pages.col.status')}</span>
              <select id="f-state" name="state" defaultValue={filters.state ?? ''}>
                <option value="">{t.t('pages.filter.any')}</option>
                {SLUG_STATE_VALUES.filter((s) => s !== 'platform').map((s) => <option key={s} value={s}>{t.t(slugStateKey(s))}</option>)}
              </select>
            </label>
            <button type="submit" className="kv-btn">{t.t('pages.filter.apply')}</button>
            {filtered && <Link href={FAQ_HREF} className="kv-btn--link">{t.t('pages.filter.clear')}</Link>}
          </form>

          {idx.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(filtered ? 'faq.emptyFiltered' : 'faq.empty')}</p>
              {idx.canAuthor && <p><Link href={NEW_FAQ_HREF} className="kv-btn--link">{t.t('faq.newEntry')}</Link></p>}
            </div>
          ) : groupByTopic(idx.items).map((g) => (
            <div key={g.topic}>
              <h2>{topicName(g.topic)}</h2>
              <table className="kv-table">
                <thead>
                  <tr><th>{t.t('faq.col.place')}</th><th>{t.t('faq.col.question')}</th><th>{t.t('faq.col.views')}</th><th>{t.t('pages.col.status')}</th><th>{t.t('faq.col.actions')}</th></tr>
                </thead>
                <tbody>
                  {g.items.map((e) => (
                    <tr key={e.slug}>
                      <td>{e.position !== null ? t.t('faq.position', { n: String(e.position), of: String(e.ofTopic) }) : t.t('common.dash')}</td>
                      <td>
                        <Link href={pageHref(e.slug)} className="kv-link" lang={e.languageCode ?? undefined}>{e.title}</Link>
                        <div className="kv-field__hint"><code>{e.slug}</code> · {e.languageCode ?? t.t('pages.languageUnrecorded')}</div>
                      </td>
                      <td className="kv-field__hint">{t.t('common.dash')}</td>
                      <td>
                        <span className="kv-badge">{t.t(slugStateKey(e.state))}</span>
                        {e.own.draftVersion !== null && e.state === 'published' && <div className="kv-field__hint">{t.t('pages.draftOpen', { v: String(e.own.draftVersion) })}</div>}
                      </td>
                      <td>
                        <div className="kv-actions">
                          {e.own.draftId && idx!.canPublish && <Link href={pageActHref(e.slug, e.own.draftId, 'publish')} className="kv-btn kv-btn--sm">{t.t('faq.reviewPublish')}</Link>}
                          {e.canMoveUp && <Link href={faqMoveHref(e.slug, 'up')} className="kv-btn--link">{t.t(moveLabelKey('up'))}</Link>}
                          {e.canMoveDown && <Link href={faqMoveHref(e.slug, 'down')} className="kv-btn--link">{t.t(moveLabelKey('down'))}</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {idx.truncated && <p className="kv-field__hint">{t.t('faq.truncated')}</p>}
          <p className="kv-field__hint">{t.t(refusedKey('views'))} {t.t(refusedKey('deflection'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('englishGloss'))} {t.t(refusedKey('voicePlayback'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('financeRead'))}</p>
          <p className="kv-field__hint">{t.t('faq.tone')}</p>
          <p className="kv-field__hint">{t.t('pages.reader.none')}</p>
        </>
      )}
    </section>
  );
}
