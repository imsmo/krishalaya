// apps/web-tenant/src/app/schemes/page.tsx · the scheme-assistant officer console (P1-12). Server-first,
// requireSession-gated, behind the `schemes` flag (NEXT_PUBLIC_FEATURE_SCHEMES + the API's own flag). Sections —
// the verification queue (+ a selected application's processing: verify/clarify/approve/reject/close + observed
// DBT credits), and a scheme catalogue with an on-behalf, explainable eligibility checker. Each section degrades
// on its own (Law 12). Every write is a Server Action → the audited, RBAC-gated (scheme.process) API, which owns
// the application state machine + the deterministic eligibility evaluation. Money (DBT) via formatMoneyMinor; all
// copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { APPLICATION_STATUSES, officerActions, canRecordDbt, totalDbtMinor } from '../../features/schemes/operator';
import {
  verifyApplicationAction, clarifyApplicationAction, approveApplicationAction,
  rejectApplicationAction, closeApplicationAction, recordDbtAction, checkEligibilityAction,
} from './actions';
import type { SchemeApplication, DbtTransfer, Scheme, ApplicationStatus } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('scm.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['verify', 'clarify', 'approve', 'reject', 'close', 'dbt']);

function decodeElig(raw?: string): { e: boolean; r: string[] } | null {
  if (!raw) return null;
  try { const o = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString()); return { e: !!o.e, r: Array.isArray(o.r) ? o.r.map(String) : [] }; } catch { return null; }
}

export default async function SchemesPage({ searchParams }: { searchParams: { ok?: string; error?: string; application?: string; status?: string; elig?: string } }) {
  if (!env.featureSchemes) notFound();
  await requireSession('/schemes');
  const t = getTranslator();
  const lang = getLang();
  const selected = searchParams.application || null;
  const statusFilter = (searchParams.status && (APPLICATION_STATUSES as readonly string[]).includes(searchParams.status)) ? searchParams.status as ApplicationStatus : undefined;

  let queue: SchemeApplication[] = []; let schemes: Scheme[] = [];
  let queueFailed = false; let schemesFailed = false;
  let app: SchemeApplication | null = null; let dbt: DbtTransfer[] = []; let detailFailed = false;
  const [qRes, sRes] = await Promise.allSettled([
    tenantClient().schemes.listApplications({ box: 'queue', status: statusFilter, limit: 100 }),
    tenantClient().schemes.list({ activeOnly: true }),
  ]);
  if (qRes.status === 'fulfilled') queue = qRes.value.items; else queueFailed = true;
  if (sRes.status === 'fulfilled') schemes = sRes.value; else schemesFailed = true;
  if (selected) {
    const [aRes, dRes] = await Promise.allSettled([
      tenantClient().schemes.getApplication(selected),
      tenantClient().schemes.dbtTransfers(selected),
    ]);
    if (aRes.status === 'fulfilled') app = aRes.value; else detailFailed = true;
    if (dRes.status === 'fulfilled') dbt = dRes.value;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const elig = decodeElig(searchParams.elig);
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);

  return (
    <section>
      <h1>{t.t('scm.title')}</h1>
      <p className="kv-muted">{t.t('scm.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`scm.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('scm.error')}: {errorKey}</p>}

      {/* ---- verification queue ---- */}
      <h2 className="kv-section-title">{t.t('scm.queue.title')}</h2>
      <form method="get" className="kv-form kv-form--inline">
        <label className="kv-label">{t.t('scm.queue.status')}
          <select className="kv-input" name="status" defaultValue={statusFilter ?? ''}>
            <option value="">{t.t('scm.queue.allStatuses')}</option>
            {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{t.t(`scm.status.${s}`)}</option>)}
          </select>
        </label>
        <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('scm.queue.filter')}</button>
      </form>
      {queueFailed ? <p className="kv-error" role="alert">{t.t('scm.loadError')}</p> : (
        <DataTable
          rows={queue}
          empty={t.t('scm.queue.empty')}
          columns={[
            { header: t.t('scm.queue.app'), cell: (a) => <Link href={`/schemes?application=${encodeURIComponent(a.id)}`}><code className="kv-code kv-code--inline">{a.id.slice(0, 8)}</code></Link> },
            { header: t.t('scm.queue.scheme'), cell: (a) => <code className="kv-code kv-code--inline">{a.schemeId.slice(0, 8)}</code> },
            { header: t.t('scm.queue.submitted'), cell: (a) => a.submittedAt ?? t.t('common.dash') },
            { header: t.t('scm.status'), cell: (a) => <span className="kv-badge">{t.t(`scm.status.${a.status}`)}</span> },
          ]}
        />
      )}

      {/* ---- selected application processing ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('scm.detail.title')} · <Link href="/schemes">{t.t('scm.detail.clear')}</Link></h2>
          {detailFailed || !app ? <p className="kv-error" role="alert">{t.t('scm.loadError')}</p> : (
            <>
              <p className="kv-muted kv-fine">{t.t('scm.status')}: <span className="kv-badge">{t.t(`scm.status.${app.status}`)}</span>{app.govtAppRef ? ` · ${t.t('scm.detail.govtRef')}: ${app.govtAppRef}` : ''}{app.rejectionReason ? ` · ${t.t('scm.detail.reason')}: ${app.rejectionReason}` : ''}</p>

              <span className="kv-actions">
                {officerActions(app.status).includes('verify') && (
                  <form action={verifyApplicationAction}><input type="hidden" name="id" value={app.id} /><button type="submit" className="kv-btn kv-btn--sm">{t.t('scm.action.verify')}</button></form>
                )}
                {officerActions(app.status).includes('close') && (
                  <form action={closeApplicationAction}><input type="hidden" name="id" value={app.id} /><button type="submit" className="kv-btn kv-btn--sm kv-btn--muted">{t.t('scm.action.close')}</button></form>
                )}
              </span>

              {officerActions(app.status).includes('clarify') && (
                <details className="kv-disclosure"><summary>{t.t('scm.action.clarify')}</summary>
                  <form action={clarifyApplicationAction} className="kv-form">
                    <input type="hidden" name="id" value={app.id} />
                    <label className="kv-label">{t.t('scm.detail.note')}<textarea className="kv-input" name="note" rows={2} maxLength={1000} /></label>
                    <button type="submit" className="kv-btn">{t.t('scm.action.clarify')}</button>
                  </form>
                </details>
              )}
              {officerActions(app.status).includes('approve') && (
                <details className="kv-disclosure"><summary>{t.t('scm.action.approve')}</summary>
                  <form action={approveApplicationAction} className="kv-form">
                    <input type="hidden" name="id" value={app.id} />
                    <label className="kv-label">{t.t('scm.detail.govtRef')}<input className="kv-input" name="govtAppRef" maxLength={120} placeholder="GOV-…" /></label>
                    <button type="submit" className="kv-btn">{t.t('scm.action.approve')}</button>
                  </form>
                </details>
              )}
              {officerActions(app.status).includes('reject') && (
                <details className="kv-disclosure"><summary>{t.t('scm.action.reject')}</summary>
                  <form action={rejectApplicationAction} className="kv-form">
                    <input type="hidden" name="id" value={app.id} />
                    <label className="kv-label">{t.t('scm.detail.reason')}<textarea className="kv-input" name="reason" rows={2} maxLength={1000} /></label>
                    <button type="submit" className="kv-btn kv-btn--muted">{t.t('scm.action.reject')}</button>
                  </form>
                </details>
              )}

              {/* DBT (observed PFMS credits) */}
              <h3 className="kv-section-title">{t.t('scm.dbt.title')} · {t.t('scm.dbt.total')}: <strong>{money(totalDbtMinor(dbt))}</strong></h3>
              <DataTable
                rows={dbt}
                empty={t.t('scm.dbt.empty')}
                columns={[
                  { header: t.t('scm.dbt.amount'), cell: (d) => money(d.amountMinor) },
                  { header: t.t('scm.dbt.instalment'), cell: (d) => d.instalmentNo != null ? `${d.instalmentNo}` : t.t('common.dash') },
                  { header: t.t('scm.dbt.credited'), cell: (d) => d.creditedOn },
                  { header: t.t('scm.dbt.pfms'), cell: (d) => d.pfmsRef ?? t.t('common.dash') },
                ]}
              />
              {canRecordDbt(app.status) && (
                <details className="kv-disclosure"><summary>{t.t('scm.dbt.add')}</summary>
                  <form action={recordDbtAction} className="kv-form kv-form--grid">
                    <input type="hidden" name="id" value={app.id} />
                    <label className="kv-label">{t.t('scm.dbt.amount')} ({t.t('scm.minor')})<input className="kv-input" name="amountMinor" inputMode="numeric" pattern="[0-9]*" required /></label>
                    <label className="kv-label">{t.t('scm.dbt.credited')}<input className="kv-input" name="creditedOn" type="date" required /></label>
                    <label className="kv-label">{t.t('scm.dbt.instalment')}<input className="kv-input" name="instalmentNo" type="number" min={1} max={60} /></label>
                    <label className="kv-label">{t.t('scm.dbt.pfms')}<input className="kv-input" name="pfmsRef" maxLength={120} /></label>
                    <button type="submit" className="kv-btn">{t.t('scm.dbt.record')}</button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}

      {/* ---- scheme catalogue + on-behalf eligibility checker ---- */}
      <h2 className="kv-section-title">{t.t('scm.catalogue.title')}</h2>
      {schemesFailed ? <p className="kv-error" role="alert">{t.t('scm.loadError')}</p> : (
        <DataTable
          rows={schemes}
          empty={t.t('scm.catalogue.empty')}
          columns={[
            { header: t.t('scm.catalogue.code'), cell: (s) => s.code },
            { header: t.t('scm.catalogue.name'), cell: (s) => s.name },
            { header: t.t('scm.catalogue.fee'), cell: (s) => s.processingFeeMinor && s.processingFeeMinor !== '0' ? money(s.processingFeeMinor) : t.t('scm.catalogue.free') },
          ]}
        />
      )}
      {elig && (
        <p className={elig.e ? 'kv-success' : 'kv-error'} role="status">
          {elig.e ? t.t('scm.elig.eligible') : t.t('scm.elig.ineligible')}{elig.r.length ? `: ${elig.r.join('; ')}` : ''}
        </p>
      )}
      {!schemesFailed && schemes.length > 0 && (
        <details className="kv-disclosure">
          <summary>{t.t('scm.elig.title')}</summary>
          <p className="kv-fine kv-muted">{t.t('scm.elig.help')}</p>
          <form action={checkEligibilityAction} className="kv-form kv-form--grid">
            <label className="kv-label">{t.t('scm.elig.scheme')}
              <select className="kv-input" name="schemeId" required defaultValue="">
                <option value="" disabled>{t.t('scm.elig.pickScheme')}</option>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="kv-label">{t.t('scm.elig.landholding')}<input className="kv-input" name="landholdingAcres" inputMode="decimal" placeholder="2.5" /></label>
            <label className="kv-label">{t.t('scm.elig.age')}<input className="kv-input" name="age" type="number" min={0} max={150} /></label>
            <label className="kv-label">{t.t('scm.elig.gender')}
              <select className="kv-input" name="gender" defaultValue="">
                <option value="">{t.t('scm.elig.genderAny')}</option>
                <option value="male">{t.t('scm.elig.male')}</option>
                <option value="female">{t.t('scm.elig.female')}</option>
                <option value="other">{t.t('scm.elig.other')}</option>
              </select>
            </label>
            <button type="submit" className="kv-btn">{t.t('scm.elig.check')}</button>
          </form>
        </details>
      )}
    </section>
  );
}
