// apps/web-tenant/src/app/content/pages/[slug]/page.tsx · W176 — one page: its versions, what serves, and the acts each
// version has · PC-56 TENANT-8c.
//
// W176: *"how-to-list · published · v2 · publishing creates v3, v2 stays in history · Gujarati is the source language"* ·
// *Publish v3* → W2700 · *Archive page* with *Reason \** → W2700 · version history · *"Editor restricted — help_article
// needs content scope; policy needs tenant_admin + checker."*
//
// EVERY FACT FROM THE API. The head line is computed from the versions (`nextPublishFacts`); the source language is the
// version's own column (0177); the history prints who wrote, published and archived each version and why (the archive
// reason is a vocabulary code). The acts are the API's verdicts drawn before any reason exists: an allowed act is a link
// to the mutate chain, a refused one is printed with its reason — for a POLICY page, *"needs a second person"* when you
// wrote or last edited it. The body is shown as the markdown SOURCE it is stored as: there is no member surface that
// renders it (named), so there is no rendering here to pretend to be one.
//
// REFUSED BY NAME: *Preview in app* (no reader to preview as), the translations panel's *AI draft* and *not started*
// rows (no tenant path into `translations`), *Voice-note-to-draft* (no transcription), *"policy pages cannot be archived
// while referenced by live orders"* (orders reference no page version), *"Couldn't save draft — kept locally"* (no client
// JS: the form chain keeps your values in the URL, which is the house answer).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsSlugView } from '@krishalaya/sdk-js';
import { mutateRefusalKey } from '../../../../features/mutate/chain';
import {
  PAGES_HREF, PAGE_MUTATE, actLabelKey, archiveReasonKey, editPageHref, isKnownArchiveReason, isKnownTopic, kindKey, newPageHref, nextPublishFacts, offeredActs, pageActHref,
  pageHref, pageStateKey, pagesTransportState, refusedActs, refusedKey, servingKey, statusKey, topicKey, untranslatedLanguages, type PagesPageState,
} from '../../../../features/pages/pages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pages.editor.title'), robots: { index: false, follow: false } };
}

export default async function PageEditor({ params }: { params: { slug: string } }) {
  const slug = decodeURIComponent(params.slug);
  await requireSession(pageHref(slug));
  const t = getTranslator();
  const lang = getLang();
  let v: CmsSlugView | null = null;
  let state: PagesPageState | null = null;
  try { v = await tenantClient().cms.pages.view(slug); }
  catch (e) { state = e instanceof SdkError ? pagesTransportState(e.code, e.status) : 'error'; }
  const facts = v ? nextPublishFacts(v) : null;
  const shown = v ? v.draft ?? v.live ?? v.latest : null;

  return (
    <section>
      <p className="kv-field__hint"><Link href={PAGES_HREF} className="kv-btn--link">{t.t('pages.backToList')}</Link></p>
      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={pageHref(slug)} className="kv-btn--link">{t.t('pages.retry')}</Link></p>}
        </div>
      )}

      {v && facts && (
        <>
          <div className="kv-page-head">
            <h1 lang={shown?.languageCode ?? v.platform?.languageCode ?? undefined}>{shown?.defaultTitle ?? v.platform?.defaultTitle ?? v.slug}</h1>
            {v.canAuthor && v.versions.length > 0 && <Link href={editPageHref(v.slug)} className="kv-btn">{t.t(v.draft ? 'pages.editor.editDraft' : 'pages.editor.newVersion', { v: String(facts.nextVersion) })}</Link>}
            {v.canAuthor && v.versions.length === 0 && <Link href={newPageHref(v.slug, v.platform?.pageKind ?? null)} className="kv-btn">{t.t('pages.editor.writeOwn')}</Link>}
          </div>
          <p className="kv-field__hint">
            <code>/{v.slug}</code> · {v.pageKind ? t.t(kindKey(v.pageKind)) : t.t('common.dash')} · {t.t('pages.editor.markdown')}
            {shown?.languageCode && <> · {t.t('pages.editor.sourceLanguage', { lang: shown.languageCode })}</>}
          </p>
          {facts.publishes !== null && (
            <p className="kv-field__hint">{facts.staysInHistory !== null ? t.t('pages.editor.publishesKeeps', { v: String(facts.publishes), old: String(facts.staysInHistory) }) : t.t('pages.editor.publishes', { v: String(facts.publishes) })}</p>
          )}
          {v.needsChecker && <div className="kv-card kv-card--notice" role="status"><p>{t.t('pages.editor.policyChecker')}</p></div>}

          {/* ---- WHAT SERVES (F-14), AND WHO READS IT (nobody yet) ---- */}
          <div className="kv-card">
            <p>{t.t(servingKey(v.serving), { v: String(v.serving.version ?? '') })}</p>
            {v.platform && <p className="kv-field__hint">{t.t(v.serving.source === 'own' ? 'pages.editor.platformUnder' : 'pages.editor.platformServes', { v: String(v.platform.version) })}</p>}
            <p className="kv-field__hint">{t.t('pages.reader.none')} {t.t(refusedKey('previewInApp'))}</p>
          </div>

          {/* ---- THE ACTS: allowed → the mutate chain; refused → the reason, never a dead button ---- */}
          {v.versions.map((ver) => {
            const ok = offeredActs(ver.acts); const no = refusedActs(ver.acts);
            if (ok.length === 0 && no.length === 0) return null;
            return (
              <div className="kv-card" key={`acts-${ver.id}`}>
                <h2>{t.t('pages.editor.actsFor', { v: String(ver.version), status: t.t(statusKey(ver.status)) })}</h2>
                <div className="kv-actions">
                  {ok.map((a) => <Link key={a.act} href={pageActHref(v!.slug, ver.id, a.act)} className={a.act === 'archive' ? 'kv-btn kv-btn--muted' : 'kv-btn'}>{t.t(actLabelKey(a.act), { v: String(a.act === 'restore' ? facts.nextVersion : ver.version) })}</Link>)}
                </div>
                {no.map((a) => (
                  <p className="kv-field__hint" key={a.act}>{t.t(actLabelKey(a.act), { v: String(a.act === 'restore' ? facts.nextVersion : ver.version) })}: {a.refusals.map((r) => t.t(mutateRefusalKey(PAGE_MUTATE, r))).join(' · ')}</p>
                ))}
                {ok.some((a) => a.act === 'archive') && ver.pageKind === 'policy' && <p className="kv-field__hint">{t.t(refusedKey('archiveWhileOrders'))}</p>}
              </div>
            );
          })}

          {/* ---- THE BODY, as stored ---- */}
          <h2>{t.t('pages.editor.body', { v: String(shown?.version ?? v.platform?.version ?? '') })}</h2>
          {shown ? <pre className="kv-page-body" lang={shown.languageCode ?? undefined}>{shown.body}</pre>
            : v.platform ? <pre className="kv-page-body" lang={v.platform.languageCode ?? undefined}>{v.platform.body}</pre> : null}
          <p className="kv-field__hint">{t.t(refusedKey('voiceToDraft'))}</p>

          {/* ---- TRANSLATIONS: the source language is a fact; every other language is refused by name ---- */}
          <h2>{t.t('pages.editor.translations')}</h2>
          <table className="kv-table">
            <thead><tr><th>{t.t('pages.col.language')}</th><th>{t.t('pages.col.status')}</th></tr></thead>
            <tbody>
              {shown?.languageCode && <tr><td>{shown.languageCode}</td><td>{t.t('pages.editor.sourceRow', { v: String(shown.version) })}</td></tr>}
              {untranslatedLanguages(v.languages, shown?.languageCode ?? null).map((l) => (
                <tr key={l}><td>{l}</td><td className="kv-field__hint">{t.t(refusedKey('translations'))}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t(refusedKey('aiDraft'))}</p>

          {/* ---- VERSION HISTORY ---- */}
          <h2>{t.t('pages.editor.history')}</h2>
          {v.versions.length === 0 ? <p className="kv-field__hint">{t.t('pages.editor.noOwnVersions')}</p> : (
            <table className="kv-table">
              <thead><tr><th>{t.t('pages.col.version')}</th><th>{t.t('pages.col.status')}</th><th>{t.t('pages.col.who')}</th><th>{t.t('pages.col.when')}</th></tr></thead>
              <tbody>
                {v.versions.map((ver) => (
                  <tr key={ver.id}>
                    <td>v{ver.version}{ver.topic && <div className="kv-field__hint">{isKnownTopic(ver.topic) ? t.t(topicKey(ver.topic)) : ver.topic}</div>}</td>
                    <td>
                      <span className="kv-badge">{t.t(statusKey(ver.status))}</span>
                      {ver.archivedReason && <div className="kv-field__hint">{isKnownArchiveReason(ver.archivedReason) ? t.t(archiveReasonKey(ver.archivedReason)) : ver.archivedReason}</div>}
                    </td>
                    <td>
                      {t.t('pages.editor.wroteBy', { name: ver.authorName ?? t.t('pages.editor.unnamed') })}{ver.authoredByYou && <> · {t.t('pages.editor.you')}</>}
                      {ver.editorName && ver.editorName !== ver.authorName && <div className="kv-field__hint">{t.t('pages.editor.editedBy', { name: ver.editorName })}</div>}
                      {ver.publisherName && <div className="kv-field__hint">{t.t('pages.editor.publishedBy', { name: ver.publisherName })}</div>}
                      {ver.archiverName && <div className="kv-field__hint">{t.t('pages.editor.archivedBy', { name: ver.archiverName })}</div>}
                    </td>
                    <td>
                      {ver.createdAt ? formatDate(ver.createdAt, lang) : t.t('common.dash')}
                      {ver.publishedAt && <div className="kv-field__hint">{t.t('pages.editor.publishedOn', { when: formatDate(ver.publishedAt, lang) })}</div>}
                      {ver.archivedAt && <div className="kv-field__hint">{t.t('pages.editor.archivedOn', { when: formatDate(ver.archivedAt, lang) })}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!v.contiguous && <p className="kv-error" role="alert">{t.t('pages.editor.gap')}</p>}
          {!v.canPublish && <p className="kv-field__hint">{t.t('pages.cannotPublish')}</p>}
          <p className="kv-field__hint">{t.t(refusedKey('keptLocally'))}</p>
        </>
      )}
    </section>
  );
}
