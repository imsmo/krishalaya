// apps/web-tenant/src/app/live/[id]/page.tsx · W415 — the host view, declared honestly · PC-56 TENANT-7c.
//
// W415 draws a host MID-STREAM: an attendee counter, a question queue with voice transcripts, *Slow mode*, a co-host, a
// low-bandwidth mode, *Connection dropped · Rejoin*. This platform has no video provider — nothing streams, so nothing
// counts viewers, queues questions, transcribes voice, slows chat or seats a co-host. What a host HAS here is the class
// as it stands: when it is (in the cooperative's own zone), who has registered, the join link they pasted (shown to
// registered members inside the join window), the acts the API allows them right now with every refusal printed by
// name, the attendance they recorded, the recording they attached and the lesson it became, and the reminders the
// platform sent. Every control W415 draws that this platform does not perform is printed as a sentence, never a button.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber, formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { LiveClassView } from '@krishalaya/sdk-js';
import { courseTransportState, pageStateKey, type CoursePageState } from '../../../features/courses/desk';
import { mutateRefusalKey } from '../../../features/mutate/chain';
import {
  REFUSED_BY_NAME, attendanceText, editClassHref, joinState, joinStateKey, liveActHref, liveActLabelKey, liveHref, liveStatusKey, offeredActs, recordingKindText, recordingState,
  recordingStateKey, refusedKey, reminderKindKey, whenText,
} from '../../../features/live/classes';
import { registerAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('live.host.title'), robots: { index: false, follow: false } };
}

export default async function LiveHostPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(`/live/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const now = new Date();
  const registered = searchParams.registered === '1';
  const regError = typeof searchParams.error === 'string' ? searchParams.error : null;

  let v: LiveClassView | null = null; let state: CoursePageState | null = null;
  try { v = await tenantClient().liveClasses.get(params.id); }
  catch (e) { state = e instanceof SdkError ? (e.code === 'LIVE_SESSION_NOT_FOUND' ? 'notFound' : courseTransportState(e.code, e.status)) : 'error'; }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{v ? v.session.title : t.t('live.host.title')}</h1>
        <Link href={liveHref()} className="kv-btn--link">← {t.t('live.title')}</Link>
      </div>

      {registered && <p className="kv-success" role="status">{t.t('live.host.registeredOk')}</p>}
      {regError && <p className="kv-error" role="alert">{t.t(regError === 'CLASS_FULL' || regError === 'CLASS_NOT_OPEN' ? `live.host.register.${regError}` : 'live.host.register.failed')}</p>}

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(state === 'notFound' ? 'live.state.notFound' : pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={`/live/${encodeURIComponent(params.id)}`} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}

      {v && (() => {
        const js = joinState(v, now); const rs = recordingState(v); const att = attendanceText(v); const acts = offeredActs(v.acts);
        return (
          <>
            {/* ---- the class as it stands ---- */}
            <div className="kv-card">
              <p><span className="kv-badge">{t.t(liveStatusKey(v.session.status))}</span> {v.course ? <Link href={`/courses/${encodeURIComponent(v.course.id)}`} className="kv-link">{v.course.defaultTitle}</Link> : <span className="kv-field__hint">{t.t('live.noCourse')}</span>}</p>
              <p>{t.t('live.host.when', { when: whenText(v), zone: v.timezone, mins: formatNumber(v.session.durationMins, lang) })}</p>
              <p className="kv-field__hint">{t.t('live.host.window', { opens: formatDate(v.window.opensAt, lang), closes: formatDate(v.window.closesAt, lang) })}</p>
              <p>{t.t('live.host.registered', { n: formatNumber(v.registered, lang) })}{v.session.capacity !== null && <> · {t.t('live.host.ofCapacity', { n: formatNumber(v.session.capacity, lang) })}</>}</p>
              {v.session.status === 'ended' && v.session.endedAt && <p className="kv-field__hint">{t.t('live.host.endedAt', { at: formatDate(v.session.endedAt, lang) })}</p>}
              {v.session.status === 'cancelled' && v.session.cancelledAt && <p className="kv-field__hint">{t.t('live.host.cancelledAt', { at: formatDate(v.session.cancelledAt, lang) })}</p>}
              {v.session.clashAccepted && <p className="kv-field__hint">{t.t('live.host.clashAccepted')}</p>}
              {v.canEdit && <p><Link href={editClassHref(v.session.id)} className="kv-btn--link">{t.t('live.host.edit')}</Link></p>}
            </div>

            {/* ---- the join link: the class is held HERE, not on this platform ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.joinTitle')}</h2>
              <p className="kv-field__hint">{t.t(joinStateKey(js))}</p>
              {v.joinVisible && v.session.joinUrl && <p><a href={v.session.joinUrl} className="kv-link" rel="noopener noreferrer" target="_blank">{v.session.joinUrl}</a></p>}
              {js === 'not_registered' && v.session.status === 'scheduled' && (
                <form action={registerAction}><input type="hidden" name="id" value={v.session.id} /><button type="submit" className="kv-btn">{t.t('live.host.register')}</button></form>
              )}
              {v.registeredSelf && <p className="kv-field__hint">{t.t('live.host.youAreRegistered')}</p>}
            </div>

            {/* ---- the acts, as the API's verdicts; W415's "Host controls unavailable" for everyone else ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.actsTitle')}</h2>
              {!v.privileged ? <p className="kv-field__hint">{t.t('live.host.controlsUnavailable')}</p> : (
                <>
                  {!v.providerConfigured && <p className="kv-field__hint">{t.t(refusedKey('stream'))}</p>}
                  <ul className="kv-list">
                    {acts.map((a) => (
                      <li key={a.act}>
                        {a.allowed ? <Link href={liveActHref(v.session.id, a.act)} className="kv-btn">{t.t(liveActLabelKey(a.act))}</Link>
                          : <><span className="kv-badge">{t.t(liveActLabelKey(a.act))}</span> <span className="kv-field__hint">{t.t(mutateRefusalKey('live', a.why ?? 'ILLEGAL_FROM_STATUS'))}</span></>}
                      </li>
                    ))}
                  </ul>
                  <p className="kv-field__hint">{t.t('live.host.actsHint')}</p>
                </>
              )}
            </div>

            {/* ---- attendance: a number the host wrote down, or nothing yet ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.attendanceTitle')}</h2>
              {att.recorded === null ? <p className="kv-field__hint">{t.t(v.session.status === 'ended' ? 'live.host.attendanceNone' : 'live.host.attendanceLater')}</p>
                : <p><strong>{formatNumber(Number(att.recorded), lang)}</strong> {att.capacity !== null && t.t('live.host.ofCapacity', { n: formatNumber(att.capacity, lang) })} <span className="kv-field__hint">· {t.t('live.host.registered', { n: formatNumber(att.registered, lang) })} · {v.session.attendanceRecordedAt && formatDate(v.session.attendanceRecordedAt, lang)}</span></p>}
              <p className="kv-field__hint">{t.t(refusedKey('viewers'))}</p>
            </div>

            {/* ---- the recording and the lesson it became ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.recordingTitle')}</h2>
              <p className="kv-field__hint">{t.t(recordingStateKey(rs))}</p>
              {v.recording && <p><code>{v.recording.id}</code> <span className="kv-field__hint">{recordingKindText(v.recording)}</span></p>}
              {v.recordingLesson && v.course && <p><Link href={`/courses/${encodeURIComponent(v.course.id)}/lessons/${encodeURIComponent(v.recordingLesson.id)}`} className="kv-link">{v.recordingLesson.position} · {v.recordingLesson.defaultTitle}</Link></p>}
              <p className="kv-field__hint">{t.t(refusedKey('autoRecord'))}</p>
            </div>

            {/* ---- reminders the platform sent ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.remindersTitle')}</h2>
              {!v.session.remind ? <p className="kv-field__hint">{t.t('live.host.remindersOff')}</p>
                : v.reminders.length === 0 ? <p className="kv-field__hint">{t.t('live.host.remindersNone')}</p>
                : <ul className="kv-list">{v.reminders.map((r) => <li key={r.kind}>{t.t(reminderKindKey(r.kind))} · {formatDate(r.sentAt, lang)} · {t.t('live.host.reminderRecipients', { n: formatNumber(r.recipients, lang) })}</li>)}</ul>}
              <p className="kv-field__hint">{t.t('live.reminderRule')}</p>
            </div>

            {/* ---- W415's furniture, refused by name ---- */}
            <div className="kv-card">
              <h2>{t.t('live.host.notHereTitle')}</h2>
              <ul className="kv-list">
                {REFUSED_BY_NAME.filter((n) => !['autoRecord', 'sharedCalendar', 'hintBand', 'retry', 'viewers', 'stream'].includes(n)).map((n) => <li key={n} className="kv-field__hint">{t.t(refusedKey(n))}</li>)}
              </ul>
            </div>
          </>
        );
      })()}
    </section>
  );
}
