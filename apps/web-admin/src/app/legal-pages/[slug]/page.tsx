// apps/web-admin/src/app/legal-pages/[slug]/page.tsx · PC-56 LEGAL-1.
//
// One platform policy page: the live words, the open draft and its edit form, publish (by a second operator), archive,
// and the version history.
//
// **THE BODY IS SHOWN AS TEXT, NEVER AS HTML.** It is markdown the storefront renders through its own sanitising
// pipeline; this console prints it in a <pre> / textarea so nothing an author typed can execute in a god-mode session.
//
// **PUBLISH BY ABSENCE.** When admin-api says the viewer may not publish the open draft (they authored or last edited
// it, or nobody has adopted the seeded draft yet), the publish form is not drawn — the rule is printed instead.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { archiveAction, createDraftAction, publishAction, saveDraftAction } from '../actions';
import {
  BODY_MAX, PLATFORM_FACT_TOKENS, REASON_MAX, REASON_MIN, TITLE_MAX, decodeProblems, errorKey, isErrorKind, isOkKind,
  isPlatformPageSlug, liveVersion, openDraft, publishWithheldKey, slugKey, statusKey, statusTone, translationLanguages,
  whoLabel, type PageDetail, type Translation, type VersionDetail,
} from '../../../features/legal-pages/legal-pages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lp.detail'), robots: { index: false, follow: false } };
}

type T = ReturnType<typeof getTranslator>;

/** Title + body + translation blocks, shared by "start a new draft" and "save the draft". */
function DraftFields({ t, idp, title, body, translations }: { t: T; idp: string; title: string; body: string; translations: Translation[] }) {
  return (
    <>
      <div className="kv-field">
        <label className="kv-field__label" htmlFor={`${idp}-title`}>{t.t('lp.field.title')}</label>
        <input className="kv-input" id={`${idp}-title`} name="title" required maxLength={TITLE_MAX} defaultValue={title} />
      </div>
      <div className="kv-field">
        <label className="kv-field__label" htmlFor={`${idp}-body`}>{t.t('lp.field.body')}</label>
        <textarea className="kv-input kv-mono" id={`${idp}-body`} name="body" required rows={24} maxLength={BODY_MAX}
          defaultValue={body} aria-describedby={`${idp}-body-help`} />
        <p className="kv-field__hint" id={`${idp}-body-help`}>{t.t('lp.field.bodyHelp')}</p>
      </div>
      {translationLanguages(translations).map((lang) => {
        const tr = translations.find((x) => x.languageCode === lang);
        return (
          <fieldset className="kv-fieldset" key={lang}>
            <legend>{t.t('lp.field.translation', { lang })}</legend>
            <input type="hidden" name="trLang" value={lang} />
            <div className="kv-field">
              <label className="kv-field__label" htmlFor={`${idp}-tr-${lang}-title`}>{t.t('lp.field.trTitle')}</label>
              <input className="kv-input" id={`${idp}-tr-${lang}-title`} name={`tr_${lang}_title`} maxLength={TITLE_MAX}
                defaultValue={tr?.title ?? ''} />
            </div>
            <div className="kv-field">
              <label className="kv-field__label" htmlFor={`${idp}-tr-${lang}-body`}>{t.t('lp.field.trBody')}</label>
              <textarea className="kv-input kv-mono" id={`${idp}-tr-${lang}-body`} name={`tr_${lang}_body`} rows={10}
                maxLength={BODY_MAX} defaultValue={tr?.body ?? ''} />
            </div>
          </fieldset>
        );
      })}
      <p className="kv-field__hint">{t.t('lp.field.trHelp')}</p>
    </>
  );
}

function ReasonField({ t, id }: { t: T; id: string }) {
  return (
    <div className="kv-field">
      <label className="kv-field__label" htmlFor={id}>{t.t('lp.field.reason')}</label>
      <input className="kv-input" id={id} name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX}
        aria-describedby={`${id}-help`} />
      <p className="kv-field__hint" id={`${id}-help`}>{t.t('lp.field.reasonHelp')}</p>
    </div>
  );
}

function ArchiveForm({ t, slug, v, reasons, warnKey }: {
  t: T; slug: string; v: VersionDetail; reasons: PageDetail['archiveReasons']; warnKey: string;
}) {
  const idp = `lp-arch-${v.id.slice(0, 8)}`;
  return (
    <form action={archiveAction} className="kv-form">
      <h3 className="kv-panel__subtitle">{t.t('lp.archive.title', { n: String(v.version) })}</h3>
      <Callout tone="warning">{t.t(warnKey)}</Callout>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="versionId" value={v.id} />
      <div className="kv-field">
        <label className="kv-field__label" htmlFor={`${idp}-code`}>{t.t('lp.field.archiveReason')}</label>
        <select className="kv-input" id={`${idp}-code`} name="archiveReason" required defaultValue="">
          <option value="" disabled>{t.t('common.choose')}</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </div>
      <ReasonField t={t} id={`${idp}-reason`} />
      <Button type="submit">{t.t('lp.archive.submit')}</Button>
    </form>
  );
}

function Who({ t, id, viewer }: { t: T; id: string | null; viewer: string }) {
  const w = whoLabel(id, viewer);
  return <>{t.t(w.key, { who: w.who })}</>;
}

export default async function LegalPageDetail(props: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; error?: string; problems?: string }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  requireAdmin();
  if (!isPlatformPageSlug(params.slug)) notFound();
  const t = getTranslator();
  const slug = params.slug;

  let d: PageDetail | null = null; let notice: string | undefined;
  try {
    d = (await adminGet<PageDetail>(`platform-pages/${encodeURIComponent(slug)}`)).data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'lp.restricted' : 'lp.error.detail';
  }
  if (!d && !notice) notFound();

  const err = searchParams.error && isErrorKind(searchParams.error) ? searchParams.error : undefined;
  const ok = searchParams.ok && isOkKind(searchParams.ok) ? searchParams.ok : undefined;
  const problems = err === 'refused' || err === 'invalid' ? decodeProblems(searchParams.problems) : [];

  const live = d ? liveVersion(d) : null;
  const draft = d ? openDraft(d) : null;
  const viewerId = d?.viewer.adminId ?? '';
  const withheld = d ? publishWithheldKey(d.viewer, draft) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/legal-pages">{t.t('lp.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t(slugKey(slug))}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t(slugKey(slug))}</h1>
        <p className="kv-page__sub">{t.t('lp.storefrontPath', { path: `/${slug}` })}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {ok ? <Callout tone="success" live="polite">{t.t(`lp.ok.${ok}`)}</Callout> : null}
      {err ? (
        <Callout tone="danger" live="assertive">
          {t.t(errorKey(err))}
          {problems.length > 0 ? (
            <ul className="kv-list">
              {problems.map((p, i) => <li key={`${p.code}-${i}`}>{t.t('lp.problem', { code: p.code, detail: p.detail })}</li>)}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      {d ? (
        <>
          <section className="kv-panel" aria-labelledby="lp-live">
            <h2 id="lp-live" className="kv-panel__title">{t.t('lp.live')}</h2>
            {live ? (
              <>
                <p>
                  <StatusPill tone="success" label={t.t('lp.liveVersion', { n: String(live.version) })} />{' '}
                  {t.t('lp.publishedOn', { date: live.publishedAt ? formatDate(live.publishedAt) : t.t('common.dash') })}
                  {' · '}{t.t('lp.publishedBy')} <Who t={t} id={live.publishedByAdminId} viewer={viewerId} />
                </p>
                <h3 className="kv-panel__subtitle">{live.title}</h3>
                <pre className="kv-pre">{live.body}</pre>
                {live.translations.map((tr) => (
                  <details key={tr.languageCode}>
                    <summary>{t.t('lp.field.translation', { lang: tr.languageCode })}{tr.title ? ` · ${tr.title}` : ''}</summary>
                    <pre className="kv-pre">{tr.body}</pre>
                  </details>
                ))}
                <ArchiveForm t={t} slug={slug} v={live} reasons={d.archiveReasons} warnKey="lp.archive.liveWarn" />
              </>
            ) : (
              <Callout tone="warning">{t.t('lp.notPublishedLong')}</Callout>
            )}
          </section>

          <section className="kv-panel" aria-labelledby="lp-draft">
            <h2 id="lp-draft" className="kv-panel__title">{t.t('lp.draft')}</h2>
            {draft ? (
              <>
                <p>
                  <StatusPill tone="warning" label={t.t('lp.draftVersion', { n: String(draft.version) })} />{' '}
                  {t.t('lp.createdBy')} <Who t={t} id={draft.createdByAdminId} viewer={viewerId} />
                  {' · '}{t.t('lp.lastEditedBy')} <Who t={t} id={draft.lastEditedByAdminId} viewer={viewerId} />
                  {' · '}{formatDate(draft.updatedAt)}
                </p>
                <Callout tone="info">{t.t('lp.draft.notLive')}</Callout>
                <form action={saveDraftAction} className="kv-form">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="versionId" value={draft.id} />
                  <input type="hidden" name="expectUpdatedAt" value={draft.updatedAt} />
                  <DraftFields t={t} idp="lp-edit" title={draft.title} body={draft.body} translations={draft.translations} />
                  <ReasonField t={t} id="lp-edit-reason" />
                  <p className="kv-field__hint">{t.t('lp.draft.saveAdopts')}</p>
                  <Button type="submit">{t.t('lp.draft.save')}</Button>
                </form>

                <h3 className="kv-panel__subtitle">{t.t('lp.publish.title')}</h3>
                {withheld === null ? (
                  <form action={publishAction} className="kv-form">
                    <Callout tone="warning">{t.t('lp.publish.warn')}</Callout>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="versionId" value={draft.id} />
                    <ReasonField t={t} id="lp-publish-reason" />
                    <Button type="submit">{t.t('lp.publish.submit', { n: String(draft.version) })}</Button>
                  </form>
                ) : (
                  <Callout tone="info">{t.t(withheld)}</Callout>
                )}

                <ArchiveForm t={t} slug={slug} v={draft} reasons={d.archiveReasons} warnKey="lp.archive.draftWarn" />
              </>
            ) : (
              <>
                <Callout tone="info">{t.t(live ? 'lp.newDraft.fromLive' : 'lp.newDraft.blank')}</Callout>
                <form action={createDraftAction} className="kv-form">
                  <h3 className="kv-panel__subtitle">{t.t('lp.newDraft.title')}</h3>
                  <input type="hidden" name="slug" value={slug} />
                  <DraftFields t={t} idp="lp-new" title={live?.title ?? ''} body={live?.body ?? ''} translations={live?.translations ?? []} />
                  <ReasonField t={t} id="lp-new-reason" />
                  <Button type="submit">{t.t('lp.newDraft.submit')}</Button>
                </form>
              </>
            )}
          </section>

          <section className="kv-panel" aria-labelledby="lp-tokens">
            <h2 id="lp-tokens" className="kv-panel__title">{t.t('lp.tokens.title')}</h2>
            <p>{t.t('lp.tokens.body')}</p>
            <ul className="kv-list">
              {PLATFORM_FACT_TOKENS.map((tok) => <li key={tok}><code className="kv-mono">{`{{${tok}}}`}</code></li>)}
            </ul>
            <p className="kv-field__hint">{t.t('lp.tokens.refused')}</p>
          </section>

          <section className="kv-panel" aria-labelledby="lp-history">
            <h2 id="lp-history" className="kv-panel__title">{t.t('lp.history')}</h2>
            {d.versions.length === 0 ? (
              <Callout tone="info">{t.t('lp.history.empty')}</Callout>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('lp.col.version')}</th>
                    <th scope="col">{t.t('lp.col.status')}</th>
                    <th scope="col">{t.t('lp.col.title')}</th>
                    <th scope="col">{t.t('lp.col.published')}</th>
                    <th scope="col">{t.t('lp.col.archived')}</th>
                    <th scope="col">{t.t('lp.col.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.versions.map((v) => (
                    <tr key={v.id}>
                      <td>v{v.version}</td>
                      <td><StatusPill tone={statusTone(v.status)} label={t.t(statusKey(v.status))} /></td>
                      <td>{v.title}</td>
                      <td>
                        {v.publishedAt ? (
                          <>{formatDate(v.publishedAt)}<br /><small><Who t={t} id={v.publishedByAdminId} viewer={viewerId} /></small></>
                        ) : t.t('common.dash')}
                      </td>
                      <td>
                        {v.archivedAt ? (
                          <>
                            {formatDate(v.archivedAt)}
                            {v.archivedReason ? <><br /><small>{d.archiveReasons.find((r) => r.code === v.archivedReason)?.name ?? v.archivedReason}</small></> : null}
                            <br /><small><Who t={t} id={v.archivedByAdminId} viewer={viewerId} /></small>
                          </>
                        ) : t.t('common.dash')}
                      </td>
                      <td>{formatDate(v.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
