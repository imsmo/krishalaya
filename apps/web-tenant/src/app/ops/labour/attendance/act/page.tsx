// apps/web-tenant/src/app/ops/labour/attendance/act/page.tsx · THE ATTENDANCE MUTATE CHAIN — W2495 confirm → W2496 success →
// W2497 failure · PC-56 TENANT-SW-b.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name). The real acts land here with a reason:
//   • VOUCH / REFUSE a needs-review day (10–500 characters — what the next reader needs; never the worker; never the person who
//     recorded a paper day);
//   • CONFIRM a day (never the worker — the database compares the confirmer with the assigned worker; a needs-review day needs a
//     vouch first). Confirming is what lets the 18:00 wage run pay the day;
//   • CONFIRM ALL CLEAN RECORDS — ONE keyed act; each clean day (self clock-in inside the fence, clocked out) confirmed on its own,
//     with its own audit row; your own days are skipped and counted;
//   • PAPER BACKFILL — the desk records a day from a signed sheet: the assignment, the day, the hours, the evidence media id and a
//     reason. It is born needs-review; the employer (or another reviewer) vouches and confirms.
// The day's own GET does not exist on this platform, so the confirm step reviews the act and its rule, and the server re-judges
// the locked row. THE IDEMPOTENCY KEY IS MINTED ON THIS PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AttendanceReviewSummary } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { LABOUR_HREF } from '../../../../../features/labour/console';
import {
  ATTENDANCE_ACT_HREF, ATTENDANCE_HREF, MIN_REVIEW_REASON, codesFromUrl, hoursFrom, isAttAct, isUuid, swbCodeKey, swbState, ymdFrom,
} from '../../../../../features/swb/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { attendanceActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.att.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { vouch: 'labour.attendance_vouched', refuse: 'labour.attendance_refused', confirm: 'labour.attendance_confirmed', backfill: 'labour.attendance_backfilled' } as const;
const num = (v: string | undefined) => (/^\d{1,9}$/.test(v ?? '') ? Number(v) : 0);

export default async function AttendanceActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(ATTENDANCE_ACT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const act = isAttAct(searchParams.act) ? searchParams.act : 'confirm_clean';
  const step = mutateStep(searchParams.step);
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const reason = (searchParams.reason ?? '').trim().slice(0, 550);
  // the review reason is 10–500 (the database CHECK); a confirm reason is 3–300 — one rule on this page: 10–300 for all
  const minReason = MIN_REVIEW_REASON; const maxReason = act === 'vouch' || act === 'refuse' || act === 'backfill' ? 500 : MAX_REASON;
  const reasonOk = reason.length >= minReason && reason.length <= maxReason;
  const bf = { assignmentId: (searchParams.assignmentId ?? '').trim().slice(0, 36), workDate: (searchParams.workDate ?? '').trim().slice(0, 10), hoursRegular: (searchParams.hoursRegular ?? '').trim().slice(0, 5),
    hoursOvertime: (searchParams.hoursOvertime ?? '').trim().slice(0, 5), mediaId: (searchParams.mediaId ?? '').trim().slice(0, 36) };
  const bfOk = act !== 'backfill' || (isUuid(bf.assignmentId) && !!ymdFrom(bf.workDate) && hoursFrom(bf.hoursRegular, 0.5, 12) !== null && hoursFrom(bf.hoursOvertime || '0', 0, 8) !== null && isUuid(bf.mediaId));
  const needsId = act === 'vouch' || act === 'refuse' || act === 'confirm';
  const failed = codesFromUrl(searchParams.error);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <Link href={ATTENDANCE_HREF}>{t.t('swb.att.title')}</Link> / <span aria-current="page">{t.t(`swb.att.act.${act}`)}</span></nav>;
  if (!env.featureLabour) {
    return <section>{crumbs}<h1>{t.t('swb.att.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }
  let tiles: AttendanceReviewSummary | null = null; let state: string | null = null;
  if (step === 'confirm') {
    if (needsId && !id) state = 'notFound';
    else { try { tiles = await tenantClient().labour.attendanceSummary(); } catch (e) { const err = e instanceof SdkError ? e : null; state = swbState(err?.code, err?.status); } }
  }
  const carried = { step: 'confirm', act, ...(id ? { id } : {}), ...(act === 'backfill' ? bf : {}) } as Record<string, string>;

  return (
    <section>
      {crumbs}
      <h1>{t.t(`swb.att.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swb.att.chain')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`lab.state.${state}.title`)}</strong><p>{t.t(`lab.state.${state}.body`)}</p></div>}
          {!state && (
            <>
              <div className="kv-card">
                {id && <p className="kv-field__hint">{t.t('swb.att.object.day')} <code>{id.slice(0, 8)}</code></p>}
                {act === 'confirm_clean' && tiles && <p><strong>{t.t('swb.att.object.clean', { n: formatNumber(tiles.clean, lang) })}</strong></p>}
                <p>{t.t(`swb.att.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('swb.att.law')}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              <form action={ATTENDANCE_ACT_HREF} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {id && <input type="hidden" name="id" value={id} />}
                {act === 'backfill' && (
                  <>
                    <label className="kv-field" htmlFor="b-as"><span>{t.t('swb.att.field.assignmentId')}</span><input id="b-as" name="assignmentId" className="kv-input" maxLength={36} defaultValue={bf.assignmentId} required /></label>
                    <label className="kv-field" htmlFor="b-day"><span>{t.t('swb.att.field.workDate')}</span><input id="b-day" name="workDate" type="date" className="kv-input" defaultValue={bf.workDate} required /></label>
                    <label className="kv-field" htmlFor="b-hr"><span>{t.t('swb.att.field.hoursRegular')}</span><input id="b-hr" name="hoursRegular" className="kv-input" inputMode="decimal" defaultValue={bf.hoursRegular} required /></label>
                    <label className="kv-field" htmlFor="b-ot"><span>{t.t('swb.att.field.hoursOvertime')}</span><input id="b-ot" name="hoursOvertime" className="kv-input" inputMode="decimal" defaultValue={bf.hoursOvertime} /></label>
                    <label className="kv-field" htmlFor="b-m"><span>{t.t('swb.att.field.mediaId')}</span><input id="b-m" name="mediaId" className="kv-input" maxLength={36} defaultValue={bf.mediaId} required /></label>
                    {!bfOk && (bf.assignmentId || bf.mediaId) && <p className="kv-error" role="alert">{t.t('swb.att.field.invalid')}</p>}
                  </>
                )}
                <label className="kv-field" htmlFor="a-reason"><span>{t.t('amb.act.reason')}</span>
                  <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={maxReason} minLength={minReason} required /></label>
                {reason.length > 0 && !reasonOk && <p className="kv-field__hint">{t.t('swb.reason.length', { min: String(minReason), max: String(maxReason) })}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {reasonOk && bfOk ? (
                <form action={attendanceActAction} className="kv-actions">
                  <input type="hidden" name="act" value={act} />
                  {id && <input type="hidden" name="id" value={id} />}
                  {act === 'backfill' && Object.entries(bf).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  <input type="hidden" name="reason" value={reason} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={ATTENDANCE_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={ATTENDANCE_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t(`swb.att.done.${act}`, { n: formatNumber(num(searchParams.n), lang), skipped: formatNumber(num(searchParams.skipped), lang), considered: formatNumber(num(searchParams.considered), lang) })}</p>
          </div>
          {act !== 'confirm_clean' && isUuid(searchParams.id) && <AuditEntryCard t={t} lang={lang} entityType="attendance_record" entityId={searchParams.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={ATTENDANCE_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(swbCodeKey('att', code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${ATTENDANCE_ACT_HREF}?${new URLSearchParams(carried).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={ATTENDANCE_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
