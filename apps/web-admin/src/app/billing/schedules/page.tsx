// apps/web-admin/src/app/billing/schedules/page.tsx · SCHEDULED REPORTS (PC-56 ADMIN-1e, canon W1894-1900 — closes
// ADMIN-1-Q9). Server component: requireAdmin gates, adminGet reads the schedules and one schedule's run history.
//
// WHY THE RUN HISTORY IS THE MAIN EVENT ON THIS PAGE. ADMIN-1d deferred this feature because "a schedule button that
// silently never fires is the worst possible version". The repair is not the form — anyone can store a cadence — it is
// that every firing writes a row saying what was produced, for whom, and WHETHER IT WENT OUT. "I never got the Monday
// report" is now answerable from data instead of from a guess.
//
// AND IT TELLS THE TRUTH ABOUT DELIVERY TODAY: this platform has no email provider configured anywhere, so every run
// completes as `provider_pending` — computed, stored, not sent. That has its own state and its own words, never a
// success tick, because somebody would otherwise wait for an email that is not coming.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatDate } from '@krishalaya/i18n';
import { CADENCES, describeSchedule, scheduleHealth, wasDelivered, type Cadence, type RunRow } from '../../../features/billing/live';
import { EXPORT_REPORTS } from '../../../features/billing/reporting';
import { createScheduleAction, toggleScheduleAction } from '../actions';

import {
  Button, Callout, EmptyState, StatusPill,
} from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sch.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'paused', 'resumed']);
const ERR = new Set(['sch_report', 'sch_cadence', 'sch_hour', 'sch_weekday', 'sch_recipients', 'sch_email',
  'sch_tooMany', 'sch_reason', 'elevation', 'notFound', 'generic']);

interface ScheduleRow {
  id: string; report: string; cadence: string; hourIst: number; weekdayIso: number | null;
  recipients: string[]; isActive: boolean; nextRunAt: string | null; lastRunAt: string | null; notes: string | null;
}

export default async function SchedulesPage({ searchParams }: {
  searchParams: { ok?: string; error?: string; open?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let items: ScheduleRow[] = []; let notice: string | undefined;
  try { items = (await adminGet<{ items: ScheduleRow[] }>('billing/schedules')).data?.items ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // ONE schedule's runs at a time (?open=<id>) rather than N+1 reads: a list page must not fan out a request per item.
  let openRuns: RunRow[] = [];
  const openId = searchParams.open && items.some((i) => i.id === searchParams.open) ? searchParams.open : null;
  if (openId) {
    try { openRuns = (await adminGet<{ runs: RunRow[] }>(`billing/schedules/${encodeURIComponent(openId)}/runs`)).data?.runs ?? []; }
    catch { openRuns = []; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('sch.title')}</h1>
      <p className="kv-field__hint">{t.t('sch.hint')}</p>
      {/* Said once, at the top: nothing is being emailed yet, and why. */}
      <Callout>{t.t('sch.noProviderNote')}</Callout>

      {okKey && <p className="kv-success" role="status">{t.t(`sch.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sch.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : items.length === 0 ? (
        <EmptyState title={t.t('sch.none')} />
      ) : (
        <ul className="kv-list" role="list">
          {items.map((s) => {
            const health = scheduleHealth(s.isActive, openId === s.id ? openRuns : []);
            return (
              <li key={s.id} className="kv-card">
                <p className="kv-card__title">
                  {t.t(`rep.report.${s.report}`)}
                  {' '}<StatusPill tone="neutral" label={t.t(s.isActive ? 'sch.active' : 'sch.paused')} />
                  {/* health is only shown once this schedule's runs are loaded — otherwise every collapsed row would
                      claim "never run", which is a statement, not a placeholder */}
                  {openId === s.id && <> <StatusPill tone="warning" label={t.t(`sch.health.${health}`)} /></>}
                </p>
                <p className="kv-detail__muted">
                  {describeSchedule(s.cadence as Cadence, s.hourIst, s.weekdayIso)}
                  {' · '}{s.recipients.join(', ')}
                </p>
                <p className="kv-detail__muted">
                  {s.nextRunAt ? `${t.t('sch.nextRun')}: ${formatDate(s.nextRunAt)}` : t.t('sch.noNextRun')}
                  {s.lastRunAt ? ` · ${t.t('sch.lastRun')}: ${formatDate(s.lastRunAt)}` : ` · ${t.t('sch.neverRun')}`}
                </p>
                {s.notes && <p className="kv-detail__muted">{s.notes}</p>}

                <p>
                  <Button as={Link} href={openId === s.id ? '/billing/schedules' : `/billing/schedules?open=${encodeURIComponent(s.id)}`} variant="tertiary">
                    {t.t(openId === s.id ? 'sch.hideRuns' : 'sch.showRuns')}
                  </Button>
                </p>

                {openId === s.id && (
                  openRuns.length === 0 ? <EmptyState title={t.t('sch.noRuns')} /> : (
                    <table className="kv-table">
                      <thead><tr>
                        <th scope="col">{t.t('sch.ranAt')}</th>
                        <th scope="col">{t.t('sch.runStatus')}</th>
                        <th scope="col">{t.t('sch.runDetail')}</th>
                      </tr></thead>
                      <tbody>
                        {openRuns.map((r, i) => (
                          <tr key={`${r.ranAt}-${i}`}>
                            <td>{r.ranAt ? formatDate(r.ranAt) : t.t('common.dash')}</td>
                            <td>
                              <StatusPill tone={wasDelivered(r.status) ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}
                                label={t.t(`sch.run.${String(r.status)}`)} />
                            </td>
                            <td>{r.detail ?? t.t('common.dash')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}

                <form action={toggleScheduleAction} className="kv-form">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={s.isActive ? 'false' : 'true'} />
                  <label htmlFor={`tr-${s.id}`} className="kv-field__label">{t.t('billing.reason')}</label>
                  <input id={`tr-${s.id}`} name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                  <Button type="submit" variant={s.isActive ? 'secondary' : 'primary'}>
                    {t.t(s.isActive ? 'sch.pause' : 'sch.resume')}
                  </Button>
                  {!s.isActive && <p className="kv-field__hint">{t.t('sch.resumeHint')}</p>}
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('sch.newTitle')}</summary>
        <p className="kv-field__hint">{t.t('sch.newHint')}</p>
        <form action={createScheduleAction} className="kv-form">
          <label htmlFor="sch-report" className="kv-field__label">{t.t('sch.report')}</label>
          <select id="sch-report" name="report" className="kv-input" defaultValue="revenue">
            {EXPORT_REPORTS.map((r) => <option key={r} value={r}>{t.t(`rep.report.${r}`)}</option>)}
          </select>
          <label htmlFor="sch-cadence" className="kv-field__label">{t.t('sch.cadence')}</label>
          <select id="sch-cadence" name="cadence" className="kv-input" defaultValue="weekly">
            {CADENCES.map((c) => <option key={c} value={c}>{t.t(`sch.cad.${c}`)}</option>)}
          </select>
          <label htmlFor="sch-weekday" className="kv-field__label">{t.t('sch.weekday')}</label>
          <select id="sch-weekday" name="weekdayIso" className="kv-input" defaultValue="1">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={String(d)}>{t.t(`sch.day.${d}`)}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('sch.weekdayHint')}</p>
          <label htmlFor="sch-hour" className="kv-field__label">{t.t('sch.hour')}</label>
          <input id="sch-hour" name="hourIst" className="kv-input" inputMode="numeric" defaultValue="7" />
          <label htmlFor="sch-recipients" className="kv-field__label">{t.t('sch.recipients')}</label>
          <input id="sch-recipients" name="recipients" className="kv-input" required placeholder="finance@…, ops@…" />
          <p className="kv-field__hint">{t.t('sch.recipientsHint')}</p>
          <label htmlFor="sch-notes" className="kv-field__label">{t.t('sch.notes')}</label>
          <input id="sch-notes" name="notes" className="kv-input" maxLength={1000} />
          <Button type="submit">{t.t('sch.create')}</Button>
          <p className="kv-field__hint">{t.t('sch.firstRunHint')}</p>
        </form>
      </details>
    </section>
  );
}
