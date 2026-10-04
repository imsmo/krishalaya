// apps/web-tenant/src/app/insights/reports/act/page.tsx · W2738 confirm → W2739 success → W2740 failure (retry) — the report builder's
// acts, PC-56 TENANT-SW-f: Run report · Save definition · Schedule · Archive (reason ≥ 10) · Unschedule (reason ≥ 10). The confirm step
// reviews what the API will be asked; archive / unschedule carry the row they showed (verify-before-write) and a changed row comes back as
// the DIFF CHIP. Retry is the confirm step again (a re-read) — a failed run is retried as a NEW run.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReportDefinition, ReportSchedule } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../features/mutate/chain';
import { SEEN_FIELD, isStaleFailure, readDiff, seenToken } from '../../../../features/mutate/verify';
import {
  REPORTS_HREF, CADENCES, RECIPIENT_ROLES, REASON_MIN, daysInclusive, failedCodes, isReportAct, isUuid, istDaysAgo, istToday, keyList, runDraftProblems, staleLabels, swfCodeKey,
} from '../../../../features/swf/console';
import { istClock } from '../../../../features/offline/stale';
import { StaleDiffChip } from '../../../../components/StaleDiffChip';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { reportActAction } from './actions';
import { DEF_FIELDS, SCHED_FIELDS } from './fields';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.reports.title'), robots: { index: false, follow: false } }; }

export default async function ReportActPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const base = `${REPORTS_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const sp = (k: string) => { const v = searchParams[k]; return (Array.isArray(v) ? v[0] : v ?? '').trim(); };
  const act = isReportAct(sp('act')) ? sp('act') as 'run' | 'save' | 'schedule' | 'archive' | 'unschedule' : 'run';
  const step = mutateStep(sp('step'));
  const def = isUuid(sp('def')) ? sp('def') : ''; const sched = isUuid(sp('sched')) ? sp('sched') : '';
  const dims = keyList(searchParams.dims); const measures = keyList(searchParams.measures);
  const from = sp('from') || istDaysAgo(29); const to = sp('to') || istToday();
  const reason = sp('reason').slice(0, 500); const reasonOk = reason.length >= REASON_MIN;
  const title = sp('title').slice(0, 160);
  const cadence = (CADENCES as readonly string[]).includes(sp('cadence')) ? sp('cadence') : 'weekly';
  const roles = keyList(searchParams.roles).filter((r) => (RECIPIENT_ROLES as readonly string[]).includes(r));
  const carry: Record<string, string> = { act, def, sched, dataset: sp('dataset'), from, to, title, reason, cadence, weekday: sp('weekday') || '1', monthDay: sp('monthDay') || '1', time: sp('time') || '07:30',
    dims: dims.join(','), measures: measures.join(','), roles: roles.join(',') };

  let d: ReportDefinition | null = null; let s: ReportSchedule | null = null; let loadErr: string | null = null;
  if (step === 'confirm') {
    try {
      if (def) d = await tenantClient().reports.definition(def);
      if (sched) s = (await tenantClient().reports.schedules({ limit: 100 })).items.find((x) => x.id === sched) ?? null;
    } catch (e) { loadErr = e instanceof SdkError ? e.code : 'unknown'; }
  }
  const problems = act === 'run' && !def ? runDraftProblems({ dataset: carry.dataset, dimensions: dims, measures, from, to }) : act === 'save' ? [...runDraftProblems({ dataset: carry.dataset, dimensions: dims, measures, from, to }), ...(title.length < 3 ? ['TITLE_REQUIRED'] : [])] : [];
  const needsReason = act === 'archive' || act === 'unschedule';
  const ready = !loadErr && problems.length === 0 && (!needsReason || reasonOk) && (act !== 'archive' || !!d) && (act !== 'unschedule' || !!s) && (act !== 'schedule' || (!!d && roles.length > 0));
  const hidden = (o: Record<string, string>) => Object.entries(o).filter(([, v]) => v !== '').flatMap(([k, v]) => (k === 'dims' || k === 'measures' || k === 'roles' ? v.split(',').map((x) => <input key={`${k}-${x}`} type="hidden" name={k} value={x} />) : [<input key={k} type="hidden" name={k} value={v} />]));
  const error = sp('error');
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.reports.title')}><Link href={REPORTS_HREF}>{t.t('swf.reports.title')}</Link> / <span aria-current="page">{t.t(`swf.reports.act.${act}`)}</span></nav>
      <h1>{t.t(`swf.reports.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (
        <>
          {loadErr && <div className="kv-error" role="alert"><p>{t.t(swfCodeKey(loadErr))} <code>{loadErr}</code></p></div>}
          <div className="kv-card">
            {(act === 'run' || act === 'save') && !def && <p>{t.t('swf.reports.confirm.spec', { dataset: carry.dataset ? t.t(`swf.reports.ds.${carry.dataset}`) : t.t('common.dash'), dims: dims.join(', ') || t.t('common.dash'), measures: measures.join(', ') || t.t('common.dash') })}</p>}
            {(act === 'run' || act === 'save') && <p>{t.t('swf.reports.confirm.range', { from, to, days: /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? String(daysInclusive(from, to)) : '?' })}</p>}
            {d && <p>{t.t('swf.reports.confirm.definition', { title: d.title, dataset: d.datasetCode ? t.t(`swf.reports.ds.${d.datasetCode}`) : (d.metric ?? '') })}</p>}
            {s && <p>{t.t('swf.reports.confirm.schedule', { cadence: t.t(`swf.reports.cadence.${s.cadence}`), time: s.timeIst, next: istClock(s.nextRunAt) })}</p>}
            {act === 'run' && <p className="kv-field__hint">{t.t('swf.reports.confirm.runNote')}</p>}
            <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
            {problems.length > 0 && <ul className="kv-error">{problems.map((p) => <li key={p}>{t.t(swfCodeKey(p) === 'swf.code.unknown' ? `swf.reports.problem.${p}` : swfCodeKey(p))} <code>{p}</code></li>)}</ul>}
          </div>
          {(needsReason || act === 'save' || act === 'schedule') && (
            <form method="get" action={base} className="kv-card kv-form">
              {hidden({ ...carry, reason: '', title: act === 'save' ? '' : carry.title, step: 'confirm' })}
              {act === 'save' && <label className="kv-field" htmlFor="a-title"><span>{t.t('swf.reports.titleRequired')}</span><input id="a-title" name="title" className="kv-input" maxLength={160} defaultValue={title} /></label>}
              {act === 'schedule' && (
                <>
                  <label className="kv-field" htmlFor="a-cad"><span>{t.t('swf.reports.col.cadence')}</span><select id="a-cad" name="cadence" className="kv-input" defaultValue={cadence}>{CADENCES.map((c) => <option key={c} value={c}>{t.t(`swf.reports.cadence.${c}`)}</option>)}</select></label>
                  <label className="kv-field" htmlFor="a-wd"><span>{t.t('swf.reports.weekday')}</span><select id="a-wd" name="weekday" className="kv-input" defaultValue={carry.weekday}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{t.t(`swf.weekday.${n}`)}</option>)}</select></label>
                  <label className="kv-field" htmlFor="a-md"><span>{t.t('swf.reports.monthDay')}</span><input id="a-md" name="monthDay" type="number" min={1} max={28} className="kv-input" defaultValue={carry.monthDay} /></label>
                  <label className="kv-field" htmlFor="a-time"><span>{t.t('swf.reports.timeIst')}</span><input id="a-time" name="time" type="time" className="kv-input" defaultValue={carry.time} /></label>
                  <fieldset><legend>{t.t('swf.reports.col.recipients')}</legend>{RECIPIENT_ROLES.map((r) => <label key={r} className="kv-check"><input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} /> {t.t(`swf.role.${r}`)}</label>)}</fieldset>
                </>
              )}
              {needsReason && <label className="kv-field" htmlFor="a-why"><span>{t.t('swf.reason')}</span><textarea id="a-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>}
              {needsReason && reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swf.reasonMin10')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {ready ? (
            <form action={reportActAction} className="kv-actions">
              {hidden(carry)}
              <input type="hidden" name="key" value={randomUUID()} />
              {act === 'archive' && d && <input type="hidden" name={SEEN_FIELD} value={seenToken(d as never, DEF_FIELDS)} />}
              {act === 'unschedule' && s && <input type="hidden" name={SEEN_FIELD} value={seenToken(s as never, SCHED_FIELDS)} />}
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={REPORTS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={REPORTS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      )}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swf.reports.done.${act}`, { next: sp('next') ? istClock(sp('next')) : '' })}</p>
            {sp('run') && <p><Link href={`${REPORTS_HREF}/runs/${sp('run')}`} className="kv-btn kv-btn--primary">{t.t('swf.reports.viewRun')}</Link></p>}</div>
          {(act === 'archive' || act === 'unschedule') && <AuditEntryCard t={t} lang={lang} entityType={act === 'archive' ? 'saved_report_definition' : 'report_schedule'} entityId={act === 'archive' ? def : sched} action={act === 'archive' ? 'report.definition_archived' : 'report.schedule_deactivated'} />}
          {act === 'run' && sp('run') && <AuditEntryCard t={t} lang={lang} entityType="report_run" entityId={sp('run')} action="report.run" />}
          <p><Link href={REPORTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (isStaleFailure(error)
        ? <StaleDiffChip code={error} diffs={readDiff(sp('kv_diff'))} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...carry, step: 'confirm' }).filter(([, v]) => v !== ''))).toString()}`} />
        : (
          <div className="kv-error" role="alert">
            <p>{t.t('mutate.failure.title')}</p>
            <ul>{failedCodes(error).map((x) => <li key={x}>{t.t(swfCodeKey(x))} <code>{x}</code></li>)}</ul>
            <p className="kv-field__hint">{t.t(failureKey())}</p>
            <p><Link href={`${base}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...carry, step: 'confirm' }).filter(([, v]) => v !== ''))).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={REPORTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
          </div>
        ))}
    </section>
  );
}
