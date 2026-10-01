// apps/web-tenant/src/app/comms/new/page.tsx · THE BROADCAST FORM CHAIN — W2841 form-error → W2842 review → W2843 success →
// W2844 failure, for the canon's act on the `whatsapp` module, *Save draft* · PC-56 TENANT-8e.
//
// What the draft IS, said on the page: an in-app announcement (no WhatsApp provider exists — F-15). 6d-4's shape: ONE page,
// four states, values in the URL (7b's 7,000-character ceiling — a Gujarati announcement percent-encodes ~9 bytes a
// letter), and a review THE API COMPUTES: the words as they will be stored, the audience against the `roles` registry
// (a <select> over the registry's active tenant roles with this cooperative's member counts — F-16: never a free text
// box), the channel (`inapp`; WhatsApp refused by name), the schedule as the cooperative's wall-clock in its zone — and
// beside it the HONEST MATHS: who the audience holds today, whether the frame serves in en · hi · gu on every channel (a
// gap is printed here and refuses the SEND, never the draft), and what 8b's quiet windows will do to each member's push
// at the send instant (held until the window ends · switched off · no device), estimated over at most 5,000 members and
// said so when cut. `?id=` edits a draft (PATCH), with the diff against it.
// THE KEY IS MINTED ON THE REVIEW PAGE AND TRAVELS IN THE FORM (F-17): a double-submit saves once.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { BroadcastPreview, BroadcastView } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import {
  auditHref, chainHref, chainStep, chainStepKey, failureKey, isFormError, nothingStoredKey, normalisedKey, readCarried, repeatedFailuresGapKey, storedText,
} from '../../../features/forms/chain';
import {
  BROADCAST_FIELDS, BROADCAST_FORM_HREF, COMMS_HREF, MAX_CARRIED_BROADCAST, broadcastActHref, broadcastHref, channelKey, gapParts, transportState,
} from '../../../features/comms/broadcasts';
import { saveBroadcastDraftAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bc.form.title'), robots: { index: false, follow: false } };
}

export default async function BroadcastFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(BROADCAST_FORM_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const id = typeof searchParams.id === 'string' && searchParams.id.length > 0 ? searchParams.id : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const savedId = typeof searchParams.saved === 'string' ? searchParams.saved : null;
  const c = tenantClient().notifications;

  // An edit starts from the draft as it stands; the URL's values win once the person has typed.
  let draft: BroadcastView | null = null;
  if (id) { try { draft = await c.broadcast(id); } catch { draft = null; } }
  const fromDraft: Record<string, string> = draft ? {
    title: draft.broadcast.title, body: draft.broadcast.body, audienceRoleCode: draft.broadcast.audienceRoleCode ?? '', scheduledAt: draft.broadcast.scheduledLocal ?? '',
  } : {};
  const carried = readCarried(searchParams, BROADCAST_FIELDS);
  const values: Record<string, string> = step === 'edit' && Object.keys(carried).length === 0 ? fromDraft : carried;
  const carriedValues = { ...values, ...(id ? { id } : {}) };

  let roles: Awaited<ReturnType<typeof c.broadcastRoles>> | null = null; let rolesState: string | null = null;
  if (step === 'edit') { try { roles = await c.broadcastRoles(); } catch (e) { const err = e instanceof SdkError ? e : null; rolesState = transportState(err?.code, err?.status); } }

  let preview: BroadcastPreview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try { preview = await c.previewBroadcast({ title: values.title, body: values.body, audienceRoleCode: values.audienceRoleCode, scheduledAt: values.scheduledAt }, id ?? undefined); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const review = preview?.review ?? null;
  const zoned = (iso: string | null | undefined, zone?: string | null) => (iso ? formatDate(iso, lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone ?? undefined }) : null);
  const label = (name: string) => t.t(`bc.form.field.${name}`);
  const refusal = (code: string) => t.t(`bc.form.refusal.${code}`);

  return (
    <section>
      <h1>{t.t(id ? 'bc.form.title.edit' : 'bc.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t('bc.form.module')}</p>
      <p className="kv-field__hint"><Link href={COMMS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('bc.form.whatItIs')}</p></div>

      {step === 'edit' && (
        <>
          {rolesState && <div className={rolesState === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="status"><p>{t.t(`bc.state.${rolesState}`)}</p></div>}
          {id && !draft && <div className="kv-error" role="alert"><p>{t.t('bc.state.notFound')}</p></div>}
          <form action={BROADCAST_FORM_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            {id && <input type="hidden" name="id" value={id} />}
            <label className="kv-field" htmlFor="b-title"><span>{label('title')}</span><input id="b-title" name="title" className="kv-input" defaultValue={values.title ?? ''} required maxLength={160} /></label>
            <label className="kv-field" htmlFor="b-body"><span>{label('body')}</span><textarea id="b-body" name="body" className="kv-textarea" rows={5} defaultValue={values.body ?? ''} required maxLength={2000} /></label>
            <p className="kv-field__hint">{t.t('bc.form.wordsHint')}</p>
            <label className="kv-field" htmlFor="b-role"><span>{label('audienceRoleCode')}</span>
              <select id="b-role" name="audienceRoleCode" className="kv-select" defaultValue={values.audienceRoleCode ?? ''}>
                <option value="">{t.t('bc.audience.everyoneCount', { n: formatNumber(roles?.everyone ?? 0, lang) })}</option>
                {(roles?.roles ?? []).filter((r) => r.members > 0 || r.code === values.audienceRoleCode).map((r) => (
                  <option key={r.code} value={r.code}>{r.name} ({r.code}) — {t.t('bc.audience.members', { n: formatNumber(r.members, lang) })}</option>
                ))}
              </select>
            </label>
            <p className="kv-field__hint">{t.t('bc.form.roleHint')}</p>
            <label className="kv-field" htmlFor="b-when"><span>{label('scheduledAt')}</span><input id="b-when" name="scheduledAt" type="datetime-local" className="kv-input" defaultValue={values.scheduledAt ?? ''} /></label>
            <p className="kv-field__hint">{t.t('bc.form.scheduleHint')}</p>
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t(reviewError === 'COMM_FORBIDDEN' ? 'bc.state.restricted' : 'form.reviewFailed')} <code>{reviewError}</code></p></div>}
          {review && preview && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{refusal(r.code)}</p></div>)}
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t('form.step.review')}</caption>
                <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <th scope="row">{label(f.name)}</th>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(f.name === 'audienceRoleCode' ? 'bc.audience.everyone' : f.name === 'scheduledAt' ? 'bc.form.sendNow' : nothingStoredKey())}</span> : <strong>{f.name === 'channel' ? t.t(channelKey(storedText(f).text)) : storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {f.name === 'scheduledAt' && !storedText(f).isNothing && preview.zone && <span className="kv-field__hint"> · {preview.zone}</span>}
                        {review.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{refusal(r.code)}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="kv-card">
                <h2>{t.t('bc.maths.title')}</h2>
                <dl className="kv-facts">
                  <dt>{t.t('bc.maths.audience')}</dt>
                  <dd><strong>{formatNumber(preview.audience.size, lang)}</strong> {preview.audience.roleCode ? t.t('bc.maths.ofEveryone', { n: formatNumber(preview.audience.everyone, lang) }) : ''}</dd>
                  <dt>{t.t('bc.maths.channel')}</dt>
                  <dd>{t.t('bc.channel.inapp')} · {t.t('bc.maths.pushWhereDevice')} · <span className="kv-badge kv-badge--muted">{t.t(preview.channel.whatsappConnected ? 'bc.maths.waConnected' : 'bc.maths.waNone')}</span></dd>
                  <dt>{t.t('bc.maths.templates')}</dt>
                  <dd>
                    {preview.templates.sendable ? t.t('bc.maths.templatesOk', { n: formatNumber(preview.templates.required.length, lang) })
                      : <span className="kv-error">{t.t('bc.maths.templatesGap')} {preview.templates.gaps.map((g) => { const p = gapParts(g); return `${t.t(channelKey(p.channel))} · ${p.language}`; }).join(', ')}</span>}
                  </dd>
                </dl>
                {preview.impact ? (
                  <>
                    <h3>{t.t('bc.impact.title', { at: zoned(preview.impact.at, preview.zone) ?? '' })}</h3>
                    <table className="kv-table">
                      <thead><tr><th scope="col">{t.t('bc.impact.col.channel')}</th><th scope="col">{t.t('bc.impact.col.now')}</th><th scope="col">{t.t('bc.impact.col.held')}</th><th scope="col">{t.t('bc.impact.col.optedOut')}</th><th scope="col">{t.t('bc.impact.col.noDevice')}</th></tr></thead>
                      <tbody>{preview.impact.channels.map((ch) => (
                        <tr key={ch.channel}><th scope="row">{t.t(channelKey(ch.channel))}</th><td>{formatNumber(ch.now, lang)}</td><td>{formatNumber(ch.held, lang)}</td><td>{formatNumber(ch.optedOut, lang)}</td><td>{formatNumber(ch.noDevice, lang)}</td></tr>
                      ))}</tbody>
                    </table>
                    {preview.impact.heldUntil && <p className="kv-field__hint">{t.t('bc.impact.heldUntil', { at: zoned(preview.impact.heldUntil, preview.zone) ?? '' })}</p>}
                    <p className="kv-field__hint">{t.t('bc.impact.windows', { own: formatNumber(preview.impact.windows.own, lang), coop: formatNumber(preview.impact.windows.tenantDefault, lang), none: formatNumber(preview.impact.windows.none, lang) })}</p>
                    {preview.impact.cut && <p className="kv-field__hint">{t.t('bc.impact.cut', { n: formatNumber(preview.impact.examined, lang), of: formatNumber(preview.impact.audience, lang) })}</p>}
                    <p className="kv-field__hint">{t.t('bc.impact.rule')}</p>
                  </>
                ) : <p className="kv-field__hint">{t.t('bc.impact.none')}</p>}
              </div>

              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.before')}</th><th scope="col">{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><th scope="row">{label(d.field)}</th><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}

              {review.ready ? (
                <form action={saveBroadcastDraftAction}>
                  {id && <input type="hidden" name="id" value={id} />}
                  {BROADCAST_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t('bc.form.submit')}</button>
                  <p className="kv-field__hint">{t.t('bc.form.submitHint')}</p>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(BROADCAST_FORM_HREF, 'edit', carriedValues, MAX_CARRIED_BROADCAST)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('bc.form.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {savedId && (
            <p>
              <Link href={broadcastActHref(savedId, 'send')} className="kv-btn kv-btn--primary">{t.t('bc.act.send')}</Link>{' '}
              <Link href={broadcastHref(savedId)} className="kv-btn--link">{t.t('bc.form.openDraft')}</Link>{' · '}
              <Link href={auditHref('tenant_broadcast', savedId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>
            </p>
          )}
          <p><Link href={COMMS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} <code>{failed}</code></p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(BROADCAST_FORM_HREF, 'review', carriedValues, MAX_CARRIED_BROADCAST)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={COMMS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
