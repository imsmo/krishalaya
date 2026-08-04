// apps/web-ops/src/app/warehouse/[id]/page.tsx · one deposit's lifecycle (PC-32 OW-2): facts → ONLY the legal
// actions (confirm arrival / mark stored after weighment / release with fee settlement / cancel pre-storage,
// pure gates mirroring the state machine) → assay reports (plain-text name=value entry, honest typed coercion)
// → eNWR issue (stored goods only; NERL/CCRL; float-free valuation; idempotent). notFound = IDOR guard.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canConfirm, canStore, canRelease, canCancel, canIssueNwr, NWR_REPOSITORIES } from '../../../features/warehouse/manage';
import { bookingLifecycleAction, recordAssayAction, issueNwrAction } from '../actions';
import type { StorageBooking, AssayReport } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['confirm', 'store', 'release', 'cancel', 'assay', 'nwr']);
const ERR = new Set(['action', 'illegal', 'assay', 'as_assayer', 'as_params', 'as_validuntil', 'nwr', 'nwr_dup', 'nwr_booking', 'nwr_repo', 'nwr_enwrno', 'nwr_valuation', 'nwr_expires']);

export default async function BookingDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/warehouse/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let b: StorageBooking;
  try { b = await opsClient().warehousing.booking(params.id); }
  catch { notFound(); }

  let assays: AssayReport[] = [];
  try { assays = await opsClient().warehousing.assays(params.id); } catch { assays = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = b.status;

  const lifecycle = [
    { kind: 'confirm', label: t.t('wh.actConfirm'), show: canConfirm(s) },
    { kind: 'store', label: t.t('wh.actStore'), show: canStore(s) },
    { kind: 'release', label: t.t('wh.actRelease'), show: canRelease(s) },
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('wh.detailTitle')}</h1>
        <Link href="/warehouse" className="kv-btn--link">← {t.t('wh.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`wh.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`wh.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('wh.colBooking')}</dt><dd>{b.productName ?? b.productId} · <strong>{b.quantity} {b.unitCode}</strong></dd></div>
        <div className="kv-facts__row"><dt>{t.t('wh.colWarehouse')}</dt><dd>{b.warehouseName ?? b.warehouseId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('wh.colStatus')}</dt><dd><span className="kv-badge">{t.t(`wh.status.${s}`) || s}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('wh.colArrival')}</dt><dd>{b.expectedArrival ? formatDate(b.expectedArrival, lang) : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('wh.colFee')}</dt><dd>{b.feeMinor ? formatMoneyMinor(b.feeMinor, 'INR', lang) : t.t('wh.feeServer')}</dd></div>
      </dl>

      <div className="kv-actions">
        {lifecycle.filter((a) => a.show).map((a) => (
          <form key={a.kind} action={bookingLifecycleAction} className="kv-inline-form">
            <input type="hidden" name="id" value={b.id} />
            <input type="hidden" name="kind" value={a.kind} />
            <button type="submit" className="kv-btn">{a.label}</button>
          </form>
        ))}
      </div>
      {canRelease(s) && <p className="kv-field__hint">{t.t('wh.releaseHint')}</p>}

      {canCancel(s) && (
        <form action={bookingLifecycleAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('wh.actCancel')}</h2>
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="kind" value="cancel" />
          <label htmlFor="wh-reason" className="kv-field__label">{t.t('wh.cancelReason')}</label>
          <input id="wh-reason" name="reason" className="kv-input" maxLength={500} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('wh.actCancel')}</button>
        </form>
      )}

      <h2>{t.t('wh.assays')}</h2>
      {assays.length === 0 ? <p className="kv-muted">{t.t('wh.assaysEmpty')}</p> : (
        <table className="kv-table">
          <thead><tr><th>{t.t('wh.colAssayer')}</th><th>{t.t('wh.colParams')}</th><th>{t.t('wh.colValid')}</th></tr></thead>
          <tbody>
            {assays.map((a) => (
              <tr key={a.id}>
                <td>{a.assayerName}</td>
                <td className="kv-mono">{Object.entries(a.parameters).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</td>
                <td>{a.validUntil ? formatDate(a.validUntil, lang) : t.t('common.dash')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(s === 'confirmed' || s === 'stored') && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('wh.addAssay')}</summary>
          <form action={recordAssayAction} className="kv-form">
            <input type="hidden" name="id" value={b.id} />
            <label htmlFor="as-name" className="kv-field__label">{t.t('wh.colAssayer')}</label>
            <input id="as-name" name="assayerName" className="kv-input" required maxLength={200} />
            <label htmlFor="as-params" className="kv-field__label">{t.t('wh.colParams')}</label>
            <textarea id="as-params" name="paramsText" className="kv-textarea" rows={4} required placeholder={'moisture = 11.5\norganic = true\ngrade = FAQ'} />
            <p className="kv-field__hint">{t.t('wh.paramsHint')}</p>
            <label htmlFor="as-valid" className="kv-field__label">{t.t('wh.colValid')}</label>
            <input id="as-valid" name="validUntil" type="date" className="kv-input" />
            <button type="submit" className="kv-btn">{t.t('wh.addAssayBtn')}</button>
          </form>
        </details>
      )}

      {canIssueNwr(s) && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('wh.issueNwr')}</summary>
          <p className="kv-field__hint">{t.t('wh.nwrHint')}</p>
          <form action={issueNwrAction} className="kv-form">
            <input type="hidden" name="id" value={b.id} />
            <label htmlFor="nw-repo" className="kv-field__label">{t.t('wh.colRepo')}</label>
            <select id="nw-repo" name="repository" className="kv-input" defaultValue="NERL">
              {NWR_REPOSITORIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <label htmlFor="nw-no" className="kv-field__label">{t.t('wh.colEnwr')}</label>
            <input id="nw-no" name="enwrNo" className="kv-input" required minLength={3} maxLength={60} />
            <label htmlFor="nw-val" className="kv-field__label">{t.t('wh.valuation')}</label>
            <input id="nw-val" name="valuationMajor" className="kv-input" required inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
            <label htmlFor="nw-exp" className="kv-field__label">{t.t('wh.colExpires')}</label>
            <input id="nw-exp" name="expiresAt" type="date" className="kv-input" />
            <button type="submit" className="kv-btn">{t.t('wh.issueNwrBtn')}</button>
          </form>
        </details>
      )}
    </section>
  );
}
