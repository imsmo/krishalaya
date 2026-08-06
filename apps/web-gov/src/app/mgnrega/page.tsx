// apps/web-gov/src/app/mgnrega/page.tsx · GW-5 MGNREGA dashboard (PC-55 B2, canon W345).
// Four honest numbers and one honest caveat:
//   • job cards registered on this platform, for THIS tenant's members (the API scopes by membership — a job card
//     is national, so the tenancy boundary is a membership check, not RLS);
//   • works by status, and the attendance days we have actually observed;
//   • demands: open / OVERDUE / allotted / ended — counted in SQL over the whole register, never over a page;
//   • the state ledger's real availability. Canon W345 draws a "Sync now" button; there is no sync to run while the
//     provider is a documented no-op (STATE_LEDGER_PROVIDER), so no such button is drawn. The page says the numbers
//     are the platform's own observations and names the state register as authoritative.
// The overdue count is the one that matters most: each of those households demanded work, did not get it within
// fifteen days, and is owed an unemployment allowance by the state.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { govClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { WORK_STATUSES, ledgerClaim, totalWorks } from '../../features/mgnrega/program';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mg.title'), robots: { index: false, follow: false } };
}

type Summary = Awaited<ReturnType<ReturnType<typeof govClient>['labour']['mgnregaSummary']>>;

export default async function MgnregaDashboard() {
  await requireSession('/mgnrega');
  const t = getTranslator();
  const lang = getLang();

  let s: Summary | null = null; let failed = false; let forbidden = false;
  try { s = await govClient().labour.mgnregaSummary(); }
  catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const claim = ledgerClaim(s?.stateLedger);

  return (
    <section>
      <h1>{t.t('mg.title')}</h1>
      <p className="kv-field__hint">{t.t('mg.hint')}</p>

      {forbidden && <p className="kv-error" role="alert">{t.t('mg.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('mg.loadError')}</p>}

      {s && (
        <>
          <h2 className="kv-section-title">{t.t('mg.demandsHeading')}</h2>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('mg.demandsOpen')}</dt><dd>{s.demands.open}</dd></div>
            <div className="kv-facts__row">
              <dt>{t.t('mg.demandsOverdue')}</dt>
              <dd>{s.demands.overdue > 0 ? <strong className="kv-amount--debit">{s.demands.overdue}</strong> : s.demands.overdue}</dd>
            </div>
            <div className="kv-facts__row"><dt>{t.t('mg.demandsAllotted')}</dt><dd>{s.demands.allotted}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('mg.demandsEnded')}</dt><dd>{s.demands.ended}</dd></div>
          </dl>
          {s.demands.overdue > 0 && <p className="kv-notice" role="note">{t.t('mg.overdueNotice', { count: String(s.demands.overdue), days: String(s.allotmentWindowDays) })}</p>}
          <p><Link href="/mgnrega/demands" className="kv-link">{t.t('mg.openDemandRegister')}</Link></p>

          <h2 className="kv-section-title">{t.t('mg.programHeading')}</h2>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('mg.jobCards')}</dt><dd><Link href="/mgnrega/job-cards" className="kv-link">{s.jobCards}</Link></dd></div>
            <div className="kv-facts__row"><dt>{t.t('mg.works')}</dt><dd>{totalWorks(s.works)}</dd></div>
            {WORK_STATUSES.map((w) => (
              <div className="kv-facts__row" key={w}><dt>{t.t(`mg.work.${w}`)}</dt><dd>{s.works?.[w] ?? 0}</dd></div>
            ))}
            <div className="kv-facts__row"><dt>{t.t('mg.musterDays')}</dt><dd>{s.musterDaysObserved}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('mg.guarantee')}</dt><dd>{s.guaranteeDays}</dd></div>
          </dl>

          <h2 className="kv-section-title">{t.t('mg.stateHeading')}</h2>
          <p className={claim === 'synced' ? 'kv-field__hint' : 'kv-notice'} role="note">
            {claim === 'synced'
              ? t.t('mg.stateSynced', { provider: String(s.stateLedger.provider ?? ''), at: s.stateLedger.fetchedAt ? formatDate(s.stateLedger.fetchedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash') })
              : t.t('mg.statePending')}
          </p>
          {s.stateLedger.note && <p className="kv-field__hint">{s.stateLedger.note}</p>}
          <p className="kv-field__hint kv-note">{t.t('mg.authoritativeNote')}</p>
        </>
      )}
    </section>
  );
}
