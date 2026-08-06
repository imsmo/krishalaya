// apps/web-gov/src/app/mgnrega/demands/page.tsx · GW-5 work-demand register (PC-55 B2, canon W347).
// The register a household's legal clock lives in. MGNREGA §3: work must be provided within FIFTEEN DAYS of a
// demand, and if it is not, the STATE owes an unemployment allowance. So this page:
//   • lists open demands OLDEST FIRST (the API orders them that way) — the household waiting longest is on top,
//     never buried under recent entries;
//   • labels each row with the deadline, the days left, and OVERDUE when the window has passed, plus what that
//     means (an allowance is payable) rather than leaving an officer to work it out;
//   • records a demand with the date the HOUSEHOLD asked, not today's date, because that date IS the entitlement;
//   • allots a REAL work by id (the API and the DB both refuse an allotment with nothing behind it), or ends a
//     demand with a reason that the household can later be told.
// Who pays the allowance is stated plainly: the state does. This platform records the demand, never the payment.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { govClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { DEMAND_STATUSES, canAllot, canEnd, demandUrgency, isDemandStatus, type DemandStatus } from '../../../features/mgnrega/program';
import { recordDemandAction, transitionDemandAction, exportAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mg.demands.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['demand_recorded', 'demand_allotted', 'demand_withdrawn', 'demand_closed', 'exported']);
const ERR = new Set(['demand', 'forbidden', 'conflict', 'notfound', 'invalid', 'export', 'export_report',
  'demand_jobCard', 'demand_date', 'demand_future', 'demand_days', 'demand_applicants', 'demand_workId', 'demand_reason', 'demand_to']);

type DemandRow = Record<string, unknown> & {
  id: string; jobCardId: string; jobCardNo: string; demandedOn: string; daysRequested: number; applicants: number;
  status: string; allottedWorkCode: string | null; allottedOn: string | null; closedReason: string | null;
  dueBy: string; daysUntilDue: number; overdue: boolean; allowanceDue: boolean;
};

export default async function DemandRegisterPage({ searchParams }: {
  searchParams: { status?: string; ok?: string; error?: string; receipt?: string; rows?: string; at?: string };
}) {
  await requireSession('/mgnrega/demands');
  const t = getTranslator();
  const lang = getLang();
  const status: DemandStatus | undefined = isDemandStatus(searchParams.status) ? searchParams.status : undefined;

  let rows: DemandRow[] = []; let allowanceNote = ''; let windowDays = 15; let failed = false; let forbidden = false;
  try {
    const res = await govClient().labour.mgnregaDemands({ status, limit: 200 });
    rows = res.demands as DemandRow[];
    allowanceNote = res.allowanceNote; windowDays = res.allotmentWindowDays;
  } catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('mg.demands.title')}</h1>
        <Link href="/mgnrega" className="kv-btn--link">← {t.t('mg.title')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('mg.demands.hint', { days: String(windowDays) })}</p>

      {okKey === 'exported' ? (
        <p className="kv-success" role="status">
          {t.t('mg.export.ok', { rows: String(searchParams.rows ?? '0'), receipt: String(searchParams.receipt ?? '') })}
          {searchParams.at ? ` · ${formatDate(searchParams.at, lang, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </p>
      ) : okKey && <p className="kv-success" role="status">{t.t(`mg.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`mg.error.${errKey}`)}</p>}

      <nav className="kv-tabs" aria-label={t.t('mg.demands.filterLabel')}>
        <a href="/mgnrega/demands" className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('mg.demands.all')}</a>
        {DEMAND_STATUSES.map((s) => (
          <a key={s} href={`/mgnrega/demands?status=${s}`} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>
            {t.t(`mg.demand.${s}`)}
          </a>
        ))}
      </nav>

      {forbidden && <p className="kv-error" role="alert">{t.t('mg.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('mg.loadError')}</p>}
      {!forbidden && !failed && (
        <DataTable
          rows={rows}
          empty={t.t('mg.demands.empty')}
          columns={[
            { header: t.t('mg.colJobCard'), cell: (d) => <Link href={`/mgnrega/job-cards/${d.jobCardId}`} className="kv-link">{d.jobCardNo}</Link> },
            { header: t.t('mg.colDemandedOn'), cell: (d) => formatDate(d.demandedOn, lang) },
            { header: t.t('mg.colDays'), cell: (d) => `${d.daysRequested}${d.applicants > 1 ? ` · ${t.t('mg.applicantsShort', { n: String(d.applicants) })}` : ''}` },
            { header: t.t('mg.colDueBy'), cell: (d) => formatDate(d.dueBy, lang) },
            {
              header: t.t('mg.colClock'),
              cell: (d) => {
                const u = demandUrgency(d);
                if (u === 'overdue') return <strong className="kv-amount--debit">{t.t('mg.clock.overdue', { days: String(Math.abs(d.daysUntilDue)) })}</strong>;
                if (u === 'due_soon') return <span className="kv-badge">{t.t('mg.clock.dueSoon', { days: String(d.daysUntilDue) })}</span>;
                if (u === 'open') return t.t('mg.clock.open', { days: String(d.daysUntilDue) });
                return t.t('common.dash');
              },
            },
            {
              header: t.t('mg.colStatus'),
              cell: (d) => (
                <>
                  <span className="kv-badge">{t.t(`mg.demand.${d.status}`) || d.status}</span>
                  {d.allottedWorkCode ? <span className="kv-notif-meta"> {d.allottedWorkCode}{d.allottedOn ? ` · ${formatDate(d.allottedOn, lang)}` : ''}</span> : null}
                  {d.closedReason ? <span className="kv-notif-meta"> {d.closedReason}</span> : null}
                </>
              ),
            },
            {
              header: t.t('mg.colAction'),
              cell: (d) => (
                <>
                  {canAllot(d) && (
                    <form action={transitionDemandAction} className="kv-inline-form">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="to" value="allotted" />
                      <label htmlFor={`w-${d.id}`} className="kv-field__label">{t.t('mg.allotWorkId')}</label>
                      <input id={`w-${d.id}`} name="workId" className="kv-input" required placeholder={t.t('mg.workIdPlaceholder')} />
                      <input type="hidden" name="allottedOn" value={today} />
                      <button type="submit" className="kv-btn kv-btn--sm">{t.t('mg.allotBtn')}</button>
                    </form>
                  )}
                  {canEnd(d) && (
                    <form action={transitionDemandAction} className="kv-inline-form">
                      <input type="hidden" name="id" value={d.id} />
                      <label htmlFor={`r-${d.id}`} className="kv-field__label">{t.t('mg.endReason')}</label>
                      <input id={`r-${d.id}`} name="reason" className="kv-input" maxLength={2000} />
                      <button type="submit" name="to" value="withdrawn" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('mg.withdrawBtn')}</button>
                      <button type="submit" name="to" value="closed" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('mg.closeBtn')}</button>
                    </form>
                  )}
                </>
              ),
            },
          ]}
        />
      )}

      <p className="kv-notice" role="note">{allowanceNote || t.t('mg.allowanceFallback')}</p>

      <h2 className="kv-section-title">{t.t('mg.demands.recordTitle')}</h2>
      <form action={recordDemandAction} className="kv-card kv-form">
        <div className="kv-field">
          <label htmlFor="d-card" className="kv-field__label">{t.t('mg.jobCardIdLabel')}</label>
          <input id="d-card" name="jobCardId" className="kv-input" required aria-describedby="d-card-hint" />
          <p id="d-card-hint" className="kv-field__hint">{t.t('mg.jobCardIdHint')}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="d-on" className="kv-field__label">{t.t('mg.colDemandedOn')}</label>
          <input id="d-on" name="demandedOn" type="date" max={today} className="kv-input" required aria-describedby="d-on-hint" />
          <p id="d-on-hint" className="kv-field__hint">{t.t('mg.demandedOnHint', { days: String(windowDays) })}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="d-days" className="kv-field__label">{t.t('mg.daysRequested')}</label>
          <input id="d-days" name="daysRequested" className="kv-input" inputMode="numeric" pattern="\d{1,3}" required />
          <label htmlFor="d-app" className="kv-field__label">{t.t('mg.applicants')}</label>
          <input id="d-app" name="applicants" className="kv-input" inputMode="numeric" pattern="\d{1,2}" aria-describedby="d-app-hint" />
          <p id="d-app-hint" className="kv-field__hint">{t.t('mg.applicantsHint')}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="d-note" className="kv-field__label">{t.t('mg.note')}</label>
          <textarea id="d-note" name="note" className="kv-textarea" rows={2} maxLength={2000} />
        </div>
        <div className="kv-form__actions">
          <button type="submit" className="kv-btn">{t.t('mg.recordDemandBtn')}</button>
        </div>
      </form>

      <form action={exportAction} className="kv-inline-form">
        <input type="hidden" name="report" value="demands" />
        <input type="hidden" name="from" value="/mgnrega/demands" />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('mg.exportDemandsBtn')}</button>
      </form>
      <p className="kv-field__hint kv-note">{t.t('mg.exportNote')}</p>
    </section>
  );
}
