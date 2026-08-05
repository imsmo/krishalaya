// apps/web-gov/src/app/schemes/[id]/page.tsx · one application's review (PC-41 GW-1): facts + form data +
// documents + DBT transfers, then ONLY the legal review step (verify → clarify/approve/reject → close; reject
// REQUIRES a reason — a farmer must always know why). notFound = IDOR guard.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { govClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canVerify, canClarify, canDecide, canClose } from '../../../features/schemes/review';
import { applicationAction } from '../actions';
import type { SchemeApplication } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sch.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['verify', 'clarify', 'approve', 'reject', 'close']);
const ERR = new Set(['action', 'illegal', 'reason']);

export default async function ApplicationPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/schemes/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const client = govClient();

  let a: SchemeApplication;
  try { a = await client.schemes.getApplication(params.id); }
  catch { notFound(); }

  let dbt: Array<{ id: string; amountMinor?: string; status?: string; createdAt?: string }> = [];
  try { dbt = (await client.schemes.dbtTransfers(params.id)) as typeof dbt; } catch { dbt = []; }
  let docs: Array<{ id: string; mediaId?: string; note?: string | null }> = [];
  try { docs = (await client.schemes.listDocuments(params.id)) as typeof docs; } catch { docs = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = a.status;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('sch.detailTitle')}</h1>
        <Link href="/schemes" className="kv-btn--link">← {t.t('sch.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`sch.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sch.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('sch.colStatus')}</dt><dd><span className="kv-badge">{t.t(`sch.status.${s}`) || s}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('sch.applicant')}</dt><dd>{a.applicantUserId.slice(0, 8)}…{a.assistedBy ? ` · ${t.t('sch.assistedYes')}` : ''}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sch.colSubmitted')}</dt><dd>{a.submittedAt ? formatDate(a.submittedAt, lang) : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sch.govtRef')}</dt><dd>{a.govtAppRef ?? t.t('common.dash')}</dd></div>
        {a.rejectionReason && <div className="kv-facts__row"><dt>{t.t('sch.rejectionReason')}</dt><dd>{a.rejectionReason}</dd></div>}
      </dl>

      <h2>{t.t('sch.formData')}</h2>
      <table className="kv-table"><tbody>
        {Object.entries(a.formData ?? {}).slice(0, 30).map(([k, v]) => (
          <tr key={k}><td className="kv-mono">{k}</td><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>
        ))}
      </tbody></table>

      <h2>{t.t('sch.documents')}</h2>
      {docs.length === 0 ? <p className="kv-muted">{t.t('sch.documentsEmpty')}</p> : (
        <ul className="kv-thread">{docs.map((d) => <li key={d.id} className="kv-thread__item"><span className="kv-mono">{d.mediaId?.slice(0, 8) ?? d.id.slice(0, 8)}…</span> {d.note ?? ''}</li>)}</ul>
      )}

      <h2>{t.t('sch.dbt')}</h2>
      {dbt.length === 0 ? <p className="kv-muted">{t.t('sch.dbtEmpty')}</p> : (
        <ul className="kv-thread">{dbt.map((x) => <li key={x.id} className="kv-thread__item"><strong>{x.amountMinor ? formatMoneyMinor(x.amountMinor, 'INR', lang) : t.t('common.dash')}</strong> <span className="kv-badge">{x.status ?? ''}</span></li>)}</ul>
      )}

      {canVerify(s) && (
        <form action={applicationAction} className="kv-inline-form">
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="verify" />
          <button type="submit" className="kv-btn">{t.t('sch.actVerify')}</button>
        </form>
      )}
      {canClarify(s) && (
        <form action={applicationAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('sch.actClarify')}</h2>
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="clarify" />
          <label htmlFor="sc-note" className="kv-field__label">{t.t('sch.clarifyNote')}</label>
          <textarea id="sc-note" name="note" className="kv-textarea" rows={2} maxLength={2000} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('sch.actClarify')}</button>
        </form>
      )}
      {canDecide(s) && (
        <>
          <form action={applicationAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('sch.actApprove')}</h2>
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="approve" />
            <label htmlFor="sc-ref" className="kv-field__label">{t.t('sch.govtRef')}</label>
            <input id="sc-ref" name="govtAppRef" className="kv-input" maxLength={120} />
            <button type="submit" className="kv-btn">{t.t('sch.actApprove')}</button>
          </form>
          <form action={applicationAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('sch.actReject')}</h2>
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="reject" />
            <label htmlFor="sc-reason" className="kv-field__label">{t.t('sch.rejectReason')}</label>
            <textarea id="sc-reason" name="reason" className="kv-textarea" rows={2} required maxLength={2000} />
            <p className="kv-field__hint">{t.t('sch.rejectHint')}</p>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('sch.actReject')}</button>
          </form>
        </>
      )}
      {canClose(s) && (
        <form action={applicationAction} className="kv-inline-form">
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="close" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('sch.actClose')}</button>
        </form>
      )}
    </section>
  );
}
