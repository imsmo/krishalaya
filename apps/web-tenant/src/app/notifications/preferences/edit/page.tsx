// apps/web-tenant/src/app/notifications/preferences/edit/page.tsx · the notification FORM chain — W2683 form-error → W2684
// review → W2685 success → W2686 failure, for the canon's three acts on the `notification` module: *Change window* ·
// *Save preferences* · *Change language* · PC-56 TENANT-8b.
//
// The canon's shared form pattern (B2), 6d-4's shape: ONE page, `?form=` picks the act (7d's shape), four states, values
// in the URL, and a review THE API COMPUTES from the facts the writer uses:
//   • window — the zone against the database's own registry (`pg_timezone_names`: the review refuses what 0176's trigger
//     would refuse — F-6's `Asia/Kolkatta` by name), blank = the cooperative's zone (F-22), and the WINDOW MATHS: how long
//     it lasts, whether it crosses midnight, when it next starts and ends (in that zone), what it holds and what never
//     waits; the diff against the window that applies to you today (yours, or the cooperative's default — F-5);
//   • preferences — only the cells you changed on W433; an event you may not turn off, a channel the event is never sent
//     on, an event the catalogue does not hold — each refused by name; the diff is against what is in force today;
//   • language — a code from the ACTIVE registry; whether your cooperative writes in it (else the fallback chain, 8a F-22).
// THE KEY IS MINTED ON THE REVIEW PAGE AND TRAVELS IN THE FORM (F-17's lesson): a double-submit writes once. The writes for
// window and preferences are audited in their transaction. Change language writes through identity's PATCH /users/me — the
// module that owns `users.language_code` — which keeps NO audit row today; the success screen says so rather than claiming
// W2685's audit entry (named in the report).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { FormReview, LanguageReview, NotificationMatrix, QuietWindowReview } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, failureKey, isFormError, nothingStoredKey, normalisedKey, readCarried, repeatedFailuresGapKey, retryHref, storedText,
} from '../../../../features/forms/chain';
import { PREFS_EDIT_HREF, PREFS_HREF, channelKey, decodeChanges, durationParts, isForm, prefsEditHref, windowSourceKey } from '../../../../features/notifications/inbox';
import { submitNotificationFormAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.notif.title'), robots: { index: false, follow: false } };
}

const WINDOW_FIELDS = ['starts', 'ends', 'timezone'] as const;
const LANGUAGE_FIELDS = ['languageCode'] as const;
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

export default async function NotificationFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PREFS_EDIT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const formRaw = typeof searchParams.form === 'string' ? searchParams.form : null;
  const form = isForm(formRaw) ? formRaw : 'window';
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const c = tenantClient().notifications;
  const fields = form === 'window' ? WINDOW_FIELDS : form === 'language' ? LANGUAGE_FIELDS : [];
  const values = readCarried(searchParams, fields);
  const changes = form === 'preferences' ? decodeChanges(all(searchParams.set)) : [];
  const carriedValues = { ...values, form };

  let matrix: NotificationMatrix | null = null;
  if (step === 'edit' || form === 'language') { try { matrix = await c.matrix(); } catch { matrix = null; } }

  let review: FormReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try {
      review = form === 'window' ? await c.previewQuietHours(values)
        : form === 'language' ? await c.previewLanguage(values.languageCode)
        : await c.previewPreferences(changes);
    } catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const win = form === 'window' ? (review as QuietWindowReview | null) : null;
  const langReview = form === 'language' ? (review as LanguageReview | null) : null;
  const refusal = (code: string) => t.t(`form.notif.refusal.${code}`);
  const label = (name: string) => (name.includes('::') ? `${name.split('::')[0]} · ${t.t(channelKey(name.split('::')[1]))}` : t.t(`form.notif.field.${name}`));
  const zoned = (iso: string, zone: string | null) => formatDate(iso, lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone ?? undefined });
  const backHref = PREFS_HREF;
  const me = step === 'success' ? await tenantClient().auth.me().catch(() => null) : null;
  const entityType = form === 'window' ? 'user_quiet_hours' : form === 'preferences' ? 'notification_preference' : null;
  const reviewHref = form === 'preferences' ? `${PREFS_EDIT_HREF}?${new URLSearchParams([['form', 'preferences'], ['step', 'review'], ...changes.map((x): [string, string] => ['set', `${x.eventCode}::${x.channel}::${x.isEnabled ? '1' : '0'}`])]).toString()}` : retryHref(PREFS_EDIT_HREF, carriedValues);

  return (
    <section>
      <h1>{t.t(`form.notif.title.${form}`)}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t('form.notif.module')}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'edit' && form === 'window' && (
        <form action={PREFS_EDIT_HREF} method="get" className="kv-card">
          <input type="hidden" name="form" value="window" /><input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="w-starts"><span>{t.t('form.notif.field.starts')}</span><input id="w-starts" name="starts" type="time" defaultValue={values.starts ?? ''} required /></label>
          <label className="kv-field" htmlFor="w-ends"><span>{t.t('form.notif.field.ends')}</span><input id="w-ends" name="ends" type="time" defaultValue={values.ends ?? ''} required /></label>
          <label className="kv-field" htmlFor="w-zone"><span>{t.t('form.notif.field.timezone')}</span><input id="w-zone" name="timezone" type="text" defaultValue={values.timezone ?? ''} maxLength={64} placeholder={matrix?.quietHours.tenantZone ?? ''} /></label>
          <p className="kv-field__hint">{t.t('form.notif.zoneHint', { zone: matrix?.quietHours.tenantZone ?? t.t('common.dash') })}</p>
          {matrix?.quietHours.effective && <p className="kv-field__hint">{t.t(windowSourceKey(matrix.quietHours.effective.source))}</p>}
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}
      {step === 'edit' && form === 'preferences' && (
        <div className="kv-card kv-card--notice" role="status"><p>{t.t('form.notif.prefsFromMatrix')}</p><p><Link href={PREFS_HREF} className="kv-btn--link">{t.t('notif.prefsTitle')}</Link></p></div>
      )}
      {step === 'edit' && form === 'language' && matrix && (
        <form action={PREFS_EDIT_HREF} method="get" className="kv-card">
          <input type="hidden" name="form" value="language" /><input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="l-code"><span>{t.t('form.notif.field.languageCode')}</span>
            <select id="l-code" name="languageCode" defaultValue={values.languageCode ?? matrix.language.current ?? ''}>
              {matrix.language.active.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.nameNative} ({l.nameEnglish})</option>)}
            </select>
          </label>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{refusal(r.code)}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{label(f.name)}</td>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {review!.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{refusal(r.code)}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {win && (
                <div className="kv-card">
                  <h2>{t.t('form.notif.maths.title')}</h2>
                  {win.maths.off ? <p>{t.t('form.notif.maths.off')}</p> : (
                    <>
                      <p>{t.t('form.notif.maths.length', { h: formatNumber(durationParts(win.maths.lengthMinutes).h, lang), m: formatNumber(durationParts(win.maths.lengthMinutes).m, lang) })}{win.maths.crossesMidnight ? ` · ${t.t('form.notif.maths.midnight')}` : ''}</p>
                      {win.maths.next && <p>{t.t(win.maths.next.current ? 'form.notif.maths.now' : 'form.notif.maths.next', { start: zoned(win.maths.next.start, win.maths.zone), end: zoned(win.maths.next.end, win.maths.zone) })}</p>}
                    </>
                  )}
                  {win.maths.zoneFromTenant && win.maths.zone && <p className="kv-field__hint">{t.t('form.notif.maths.zoneFromTenant', { zone: win.maths.zone })}</p>}
                  <p className="kv-field__hint">{t.t('form.notif.maths.holds')}</p>
                </div>
              )}
              {langReview && <p className="kv-field__hint">{t.t(langReview.tenantSpeaks ? 'form.notif.lang.tenantSpeaks' : 'form.notif.lang.fallback')}</p>}

              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><td>{label(d.field)}</td><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}

              {review.ready ? (
                <form action={submitNotificationFormAction}>
                  <input type="hidden" name="form" value={form} />
                  {fields.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  {changes.map((x) => <input type="hidden" name="set" key={`${x.eventCode}::${x.channel}`} value={`${x.eventCode}::${x.channel}::${x.isEnabled ? '1' : '0'}`} />)}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t(`form.notif.submit.${form}`)}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={form === 'preferences' ? PREFS_HREF : chainHref(PREFS_EDIT_HREF, 'edit', carriedValues)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(`form.notif.done.${form}`)}</p>
          {entityType ? (
            <>
              <p className="kv-field__hint">{t.t('form.auditNote')}</p>
              {me && canLinkAudit(entityType, me.id) && <p><Link href={auditHref(entityType, me.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
            </>
          ) : <p className="kv-field__hint">{t.t('form.notif.lang.noAudit')}</p>}
          <p><Link href={PREFS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={reviewHref} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'edit' && form === 'window' && <p className="kv-field__hint"><Link href={prefsEditHref('language')} className="kv-btn--link">{t.t('notif.language.change')}</Link></p>}
    </section>
  );
}
