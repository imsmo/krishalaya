// apps/web-admin/src/app/templates/[id]/page.tsx · W102 (PC-56 ADMIN-11b).
//
// One template: the wording that is serving, the versions behind it, the variables it may use, the cost of an SMS, the
// tenant overrides, and the three guard rails the canon prints — two of which were true of nothing.
//
// **THE APPROVE CONTROL IS ABSENT FOR THE AUTHOR OF SECURITY COPY, NEVER DISABLED.** W102: "auth/dispute templates
// additionally need security sign-off." A button that always 403s teaches an operator that the rule is a UI preference.
//
// **AND THE EDIT FORM SAYS, BEFORE IT IS USED, THAT SAVING CHANGES NOTHING A RECIPIENT RECEIVES.** That is the sentence
// which makes a 2 a.m. typo fix on the OTP template safe: the approved version keeps serving until the new one clears.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { approveVersionAction, authorVersionAction, rejectVersionAction, submitVersionAction } from '../actions';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import {
  approveWithheldKey, canApprove, canOverridePerTenant, channelKey, draftNoticeKey, lifecycleTone, lifecycleKey,
  overridesKey, refBlocksApproval, securityNoticeKey, segmentClass, segmentKey, sendStateTone, sendStateKey,
  type Segments, type TemplateListRow, type VersionRow,
} from '../../../features/templates/template';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tp11.detail'), robots: { index: false, follow: false } };
}

interface Detail extends TemplateListRow {
  subject: string | null;
  needsSecondPerson: boolean;
  variables: { name: string; sourceRef: string; sampleValue: string; isRequired: boolean }[];
  preview: string;
  segments: Segments | null;
  dltTemplate: string | null;
  versions: VersionRow[];
  overrides: { id: string; tenantId: string | null; tenantName: string | null; isActive: boolean; lifecycle: string | null }[];
  providerSubmissionOwner: string;
}

export default async function TemplateDetailPage({ params, searchParams }: {
  params: { id: string }; searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId() ?? '';

  let s: Detail | null = null; let notice: string | undefined;
  try {
    s = (await adminGet<Detail>(`templates/${encodeURIComponent(params.id)}`)).data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'tp11.restricted' : 'tp11.error.detail';
  }
  if (!s && !notice) notFound();

  const draftNotice = s ? draftNoticeKey(s) : null;
  const securityNotice = s ? securityNoticeKey(s) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/templates">{t.t('tp11.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span className="kv-mono">{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`tp11.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`tp11.err.${searchParams.error}`)}</Callout> : null}

      {s ? (
        <>
          <header className="kv-page__head">
            <h1 className="kv-mono">{s.eventCode} × {t.t(channelKey(s.channel))} × {s.languageCode}</h1>
            <p className="kv-page__sub">
              <StatusPill tone={sendStateTone(s)} label={t.t(sendStateKey(s))} />{' '}
              <StatusPill tone={lifecycleTone(s.lifecycle)} label={t.t(lifecycleKey(s.lifecycle))} />{' '}
              · {s.tenantName
                ? t.t('tp11.overrideOf', { tenant: s.tenantName })
                : t.t('tp11.platformDefault')}
              {' '}· {t.t('tp11.priority', { p: s.priority })}
              {' '}· {t.t(overridesKey(s), { n: String(s.overrideCount) })}
            </p>
            {securityNotice ? <Callout tone="warning">{t.t(securityNotice)}</Callout> : null}
            {draftNotice ? <Callout tone="info">{t.t(draftNotice, { serving: String(s.servingVersionNo ?? 0), draft: String(s.currentVersionNo) })}</Callout> : null}
          </header>

          <section className="kv-panel" aria-labelledby="tp11-body">
            <h2 id="tp11-body" className="kv-panel__title">{t.t('tp11.serving')}</h2>
            {s.subject ? <p><strong>{t.t('tp11.subject')}:</strong> {s.subject}</p> : null}
            <pre className="kv-pre">{s.body || t.t('tp11.noWords')}</pre>
            {s.segments ? (
              <p className={segmentClass(s.segments, s.priority)}>
                {t.t(segmentKey(s.segments)!, {
                  chars: String(s.segments.characters), segments: String(s.segments.segments),
                  per: String(s.segments.perSegment),
                })}
              </p>
            ) : null}
            {/* India's DLT registry uses {#var#}; a template registered with our syntax fails content scrubbing, which
                does not bounce — it stops delivering. This is the string an operator pastes into the portal. */}
            {s.dltTemplate ? (
              <>
                <h3 className="kv-panel__subtitle">{t.t('tp11.dltMapping')}</h3>
                <pre className="kv-pre kv-mono">{s.dltTemplate}</pre>
                <Callout tone="info">{t.t('tp11.dltNote')}</Callout>
              </>
            ) : null}
          </section>

          <section className="kv-panel" aria-labelledby="tp11-vars">
            <h2 id="tp11-vars" className="kv-panel__title">{t.t('tp11.variables')}</h2>
            {s.variables.length === 0 ? (
              // **UNKNOWN IS NOT ZERO.** An empty Variables table reads as "this event has none"; what is true is that
              // nobody has declared them, and until they are declared nothing can catch a typo in this body.
              <Callout tone="warning">{t.t('tp11.vars.undeclared', { event: s.eventCode })}</Callout>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('tp11.col.variable')}</th>
                    <th scope="col">{t.t('tp11.col.source')}</th>
                    <th scope="col">{t.t('tp11.col.sample')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.variables.map((v) => (
                    <tr key={v.name}>
                      <td className="kv-mono">{`{{${v.name}}}`}{v.isRequired ? <> <StatusPill tone="warning" icon={false} label={t.t('tp11.required')} /></> : null}</td>
                      {/* [QA-FIX 2026-08-15] was hardcoded tone="neutral", discarding the original `kv-badge is-warn` modifier. */}
                      <td>{v.sourceRef}</td>
                      <td className="kv-mono">{v.sampleValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3 className="kv-panel__subtitle">{t.t('tp11.preview')}</h3>
            <pre className="kv-pre">{s.preview}</pre>
            {/* A preview rendered from DECLARED samples. Previewing against a live row would put a farmer's real
                one-time code on a god-mode console screen. */}
            <Callout tone="info">{t.t('tp11.previewNote')}</Callout>
          </section>

          {/* THE THREE GUARD RAILS W102 PRINTS, with the truth of each stated. */}
          <section className="kv-panel" aria-labelledby="tp11-rails">
            <h2 id="tp11-rails" className="kv-panel__title">{t.t('tp11.rails')}</h2>
            <ul className="kv-list">
              <li>{t.t('tp11.rail.unique')}</li>
              <li>{t.t('tp11.rail.fallback')}</li>
              <li>{t.t('tp11.rail.reapproval')}</li>
            </ul>
          </section>

          <section className="kv-panel" aria-labelledby="tp11-versions">
            <h2 id="tp11-versions" className="kv-panel__title">{t.t('tp11.versions')}</h2>
            {s.versions.length === 0 ? (
              <Callout tone="warning">{t.t('tp11.noVersions')}</Callout>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('tp11.col.version')}</th>
                    <th scope="col">{t.t('tp11.col.lifecycle')}</th>
                    <th scope="col">{t.t('tp11.col.words')}</th>
                    <th scope="col">{t.t('tp11.col.who')}</th>
                    <th scope="col">{t.t('tp11.col.act')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.versions.map((v) => {
                    const withheld = approveWithheldKey(v, viewer);
                    const refBlocks = refBlocksApproval(s.channel, v.providerTemplateRef);
                    return (
                      <tr key={v.id}>
                        <td>
                          v{v.versionNo}
                          {/* [QA-FIX 2026-08-15] was hardcoded tone="neutral", discarding the original
                              `kv-badge is-ok` modifier — this marks the version actually serving live traffic. */}
                          {v.versionNo === s.servingVersionNo ? <><br /><StatusPill tone="success" icon={false} label={t.t('tp11.isServing')} /></> : null}
                          {/* The digest of the words as authored — what a regulator response or an export receipt
                              quotes when the question is "is this the text you sent". */}
                          <br /><small className="kv-mono">{v.bodySha256.slice(0, 12)}…</small>
                        </td>
                        <td><StatusPill tone={lifecycleTone(v.lifecycle)} label={t.t(lifecycleKey(v.lifecycle))} /></td>
                        <td>{v.body.slice(0, 80)}{v.body.length > 80 ? '…' : ''}</td>
                        <td>
                          {v.authoredByAdminId ? v.authoredByAdminId.slice(0, 8) : t.t('tp11.noAuthorRecorded')}
                          {v.approvedByAdminId ? <><br /><small>{t.t('tp11.approvedBy', { who: v.approvedByAdminId.slice(0, 8) })}</small></> : null}
                          {v.needsSecondPerson ? <><br /><small>{t.t('tp11.twoPerson')}</small></> : null}
                        </td>
                        <td>
                          {/* **APPROVAL BY ABSENCE.** The author of security copy sees no approve control at all — and
                              the reason is printed, because an unexplained missing button reads as an unbuilt feature. */}
                          {canApprove(v, viewer) && !refBlocks ? (
                            <form action={approveVersionAction}>
                              <input type="hidden" name="versionId" value={v.id} />
                              <input type="hidden" name="templateId" value={s.id} />
                              <input className="kv-input" name="reason" required minLength={20} maxLength={2000}
                                aria-label={t.t('tp11.reason')} />
                              <Button type="submit">{t.t('tp11.approve')}</Button>
                            </form>
                          ) : (
                            <Callout tone="info">
                              {refBlocks ? t.t('tp11.approve.needsRef', { channel: s.channel }) : t.t(withheld ?? 'tp11.approve.notApprovable')}
                            </Callout>
                          )}
                          {v.lifecycle === 'draft' ? (
                            <form action={submitVersionAction}>
                              <input type="hidden" name="versionId" value={v.id} />
                              <input type="hidden" name="templateId" value={s.id} />
                              <input className="kv-input" name="reason" required minLength={20} maxLength={2000}
                                aria-label={t.t('tp11.reason')} />
                              <Button type="submit">{t.t('tp11.submit')}</Button>
                            </form>
                          ) : null}
                          {v.lifecycle === 'draft' || v.lifecycle === 'submitted' ? (
                            <form action={rejectVersionAction}>
                              <input type="hidden" name="versionId" value={v.id} />
                              <input type="hidden" name="templateId" value={s.id} />
                              <input className="kv-input" name="reason" required minLength={20} maxLength={2000}
                                aria-label={t.t('tp11.rejectReason')} />
                              <Button type="submit">{t.t('tp11.reject')}</Button>
                            </form>
                          ) : null}
                          {v.rejectionReason ? <Callout tone="danger">{v.rejectionReason}</Callout> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="kv-panel" aria-labelledby="tp11-edit">
            <h2 id="tp11-edit" className="kv-panel__title">{t.t('tp11.newVersion')}</h2>
            {/* THE SENTENCE THAT MAKES A 2 A.M. EDIT SAFE. */}
            <Callout tone="info">{t.t('tp11.editIsSafe')}</Callout>
            {s.providerRefRequired ? <Callout tone="warning">{t.t('tp11.editStalesRef', { channel: s.channel })}</Callout> : null}
            <form action={authorVersionAction}>
              <input type="hidden" name="templateId" value={s.id} />
              <input type="hidden" name="eventCode" value={s.eventCode} />
              <input type="hidden" name="channel" value={s.channel} />
              <input type="hidden" name="languageCode" value={s.languageCode} />
              {/* A tenant id is offered ONLY where an override is lawful. On security copy the field is absent, not
                  disabled — the platform's position on OTP wording is not a form state. */}
              {canOverridePerTenant(s) ? <input type="hidden" name="tenantId" value={s.tenantId ?? ''} /> : null}
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="tp11-subject">{t.t('tp11.subject')}</label>
                <input className="kv-input" id="tp11-subject" name="subject" maxLength={250} defaultValue={s.subject ?? ''} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="tp11-newbody">{t.t('tp11.body')}</label>
                <textarea className="kv-input" id="tp11-newbody" name="body" required rows={5}
                  defaultValue={s.body} aria-describedby="tp11-body-help" />
                <p className="kv-field__help" id="tp11-body-help">{t.t('tp11.bodyHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="tp11-ref">{t.t('tp11.col.ref')}</label>
                <input className="kv-input" id="tp11-ref" name="providerTemplateRef" maxLength={120} />
                <p className="kv-field__help">{t.t('tp11.refHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="tp11-reason">{t.t('tp11.reason')}</label>
                <input className="kv-input" id="tp11-reason" name="reason" required minLength={20} maxLength={2000} />
                <p className="kv-field__help">{t.t('tp11.reasonHelp')}</p>
              </div>
              <Button type="submit">{t.t('tp11.saveDraft')}</Button>
            </form>
          </section>

          {s.tenantId === null ? (
            <section className="kv-panel" aria-labelledby="tp11-over">
              <h2 id="tp11-over" className="kv-panel__title">{t.t('tp11.overrides', { n: String(s.overrides.length) })}</h2>
              {s.overrides.length === 0 ? (
                <Callout tone="info">{t.t('tp11.noOverrides')}</Callout>
              ) : (
                <ul className="kv-list">
                  {s.overrides.map((o) => (
                    <li key={o.id}>
                      <Link href={`/templates/${o.id}`}>{o.tenantName ?? o.tenantId?.slice(0, 8)}</Link>{' '}
                      <StatusPill tone={lifecycleTone(o.lifecycle)} label={t.t(lifecycleKey(o.lifecycle))} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <Callout tone="info"><small>{t.t('tp11.submissionNote', { owner: s.providerSubmissionOwner })}</small></Callout>
        </>
      ) : null}
    </main>
  );
}
