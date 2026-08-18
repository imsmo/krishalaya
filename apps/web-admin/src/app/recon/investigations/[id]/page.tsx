// apps/web-admin/src/app/recon/investigations/[id]/page.tsx · investigation detail + work actions. Server
// component: requireAdmin gates, adminGet hits GET /v1/recon/investigations/:id (404 → notFound). Update actions
// (start / resolve / false-positive) are surfaced ONLY when legal for the current status (features/recon mirrors
// the server state machine); each is a Server-Action form carrying a mandatory audit note. A 403 → re-auth, a 409
// (illegal/raced) → message. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { investigationStatusKey, severityKey, canStart, canResolve, canFalsePositive, type Investigation } from '../../../../features/recon/recon';
import { updateInvestigationAction } from '../../actions';

import { Button } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('recon.invDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['opened', 'start', 'resolve', 'false_positive']);
const ERR = new Set(['note', 'elevation', 'illegal', 'notFound', 'generic']);

export default async function InvestigationDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let inv: Investigation | undefined; let notice: string | undefined;
  try { inv = (await adminGet<Investigation>(`recon/investigations/${params.id}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!inv) {
    return <section><p className="kv-backlink"><Link href="/recon/investigations">{t.t('recon.backInv')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = investigationStatusKey(inv.status);

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon/investigations">{t.t('recon.backInv')}</Link></p>
      <h1>{t.t('recon.invDetailTitle')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`recon.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`recon.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('recon.invStatus')}</dt><dd>{t.t(`recon.invState.${s}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.invSeverity')}</dt><dd>{t.t(`recon.severity.${severityKey(inv.severity)}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.invSummary')}</dt><dd>{inv.summary}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.invRun')}</dt><dd><Link href={`/recon/runs/${inv.runId}`}>{inv.runId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.invResolution')}</dt><dd>{inv.resolutionNote || t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('recon.invActions')}</h2>
      <p className="kv-muted kv-note">{t.t('recon.invActionsNote')}</p>
      <div className="kv-action-cards">
        {canStart(s) && <NoteForm id={inv.id} action="start" verb={t.t('recon.start')} label={t.t('recon.note')} />}
        {canResolve(s) && <NoteForm id={inv.id} action="resolve" verb={t.t('recon.resolve')} label={t.t('recon.note')} />}
        {canFalsePositive(s) && <NoteForm id={inv.id} action="false_positive" verb={t.t('recon.falsePositive')} label={t.t('recon.note')} />}
        {!canStart(s) && !canResolve(s) && !canFalsePositive(s) && <p className="kv-muted">{t.t('recon.invTerminal')}</p>}
      </div>
    </section>
  );
}

function NoteForm({ id, action, verb, label }: { id: string; action: string; verb: string; label: string }) {
  return (
    <form action={updateInvestigationAction} className="kv-card kv-action-card">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <label className="kv-field__label">{label}</label>
      <input name="note" className="kv-input" required minLength={3} maxLength={1000} />
      <Button type="submit">{verb}</Button>
    </form>
  );
}
