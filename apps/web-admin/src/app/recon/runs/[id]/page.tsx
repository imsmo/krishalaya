// apps/web-admin/src/app/recon/runs/[id]/page.tsx · reconciliation-run detail + open-investigation. Server
// component: requireAdmin gates, adminGet hits GET /v1/recon/runs/:id (404 → notFound). When the run has
// mismatches, an operator can OPEN an investigation (POST /recon/investigations) carrying a mandatory summary +
// severity; admin-api requires FIDO2 + step-up, so a 403 degrades to a re-auth notice. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { SEVERITIES, type ReconRunDetail } from '../../../../features/recon/recon';
import { openInvestigationAction } from '../../actions';

import { Button, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('recon.runDetailTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['summary', 'elevation', 'illegal', 'notFound', 'generic']);

export default async function ReconRunDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let run: ReconRunDetail | undefined; let notice: string | undefined;
  try { run = (await adminGet<ReconRunDetail>(`recon/runs/${params.id}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!run) {
    return <section><p className="kv-backlink"><Link href="/recon/runs">{t.t('recon.backRuns')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const mismatchCount = Array.isArray(run.mismatches) ? run.mismatches.length : 0;

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon/runs">{t.t('recon.backRuns')}</Link></p>
      <h1>{run.runType}</h1>
      {errKey && <p className="kv-error" role="alert">{t.t(`recon.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('recon.runStatus')}</dt><dd>{run.status}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.checked')}</dt><dd>{run.checkedCount.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.mismatches')}</dt><dd>{mismatchCount > 0 ? <StatusPill tone="danger" label={mismatchCount.toLocaleString()} /> : mismatchCount.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.period')}</dt><dd>{(run.periodStart ?? t.t('common.dash'))} → {(run.periodEnd ?? t.t('common.dash'))}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.finishedAt')}</dt><dd>{run.finishedAt ?? t.t('common.dash')}</dd></div>
      </dl>

      {mismatchCount > 0 && (
        <pre className="kv-card kv-pre">{JSON.stringify(run.mismatches, null, 2)}</pre>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('recon.openInvestigation')}</summary>
        <p className="kv-field__hint">{t.t('recon.openHint')}</p>
        <form action={openInvestigationAction} className="kv-form">
          <input type="hidden" name="runId" value={run.id} />
          <label htmlFor="severity" className="kv-field__label">{t.t('recon.severity')}</label>
          <select id="severity" name="severity" className="kv-input" defaultValue="high">
            {SEVERITIES.map((s) => <option key={s} value={s}>{t.t(`recon.severity.${s}`)}</option>)}
          </select>
          <label htmlFor="summary" className="kv-field__label">{t.t('recon.summary')}</label>
          <input id="summary" name="summary" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('recon.openSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
