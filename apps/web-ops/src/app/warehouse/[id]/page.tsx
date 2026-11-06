// apps/web-ops/src/app/warehouse/[id]/page.tsx · one deposit's lifecycle (PC-32 OW-2): facts → ONLY the legal
// actions (confirm arrival / mark stored after weighment / cancel pre-storage — release PAUSED by PC-56 OPS-1a, Q3-A,
// pure gates mirroring the state machine) → a link to the booking's assays (W372). notFound = IDOR guard.
// PC-56 OPS-2b (founder Q3-A, Q13-A): the "Issue eNWR receipt" form is REMOVED — this platform does not issue an eNWR (the API refuses it by
// name, ENWR_ISSUE_NOT_ON_PLATFORM); the assay table and record form MOVED to `/warehouse/assay?booking=<id>` (labelled per Q13-A; the form only
// for the named operator on a stored booking — F-16: it was offered on `confirmed`, where the API answers 409). The rest is OPS-2a's.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canConfirm, canStore, canRelease, canCancel } from '../../../features/warehouse/manage';
import { assayHref } from '../../../features/ops2/receipts';
import { bookingLifecycleAction } from '../actions';
import type { StorageBooking } from '@krishalaya/sdk-js';
import { ReleasePaused } from '../../../components/ops1/WithdrawalView';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['confirm', 'store', 'cancel']);
const ERR = new Set(['action', 'illegal']);

export default async function BookingDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/warehouse/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let b: StorageBooking;
  try { b = await opsClient().warehousing.booking(params.id); }
  catch { notFound(); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = b.status;

  const lifecycle = [
    { kind: 'confirm', label: t.t('wh.actConfirm'), show: canConfirm(s) },
    { kind: 'store', label: t.t('wh.actStore'), show: canStore(s) },
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
      {/* PC-56 OPS-1a (founder 1a-2, Q3-A): the release button is replaced by the honest sentence — no button. */}
      {canRelease(s) && <ReleasePaused t={t} />}

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

      {/* PC-56 OPS-2b (founder Q13-A): the booking's assays are read — and recorded, by the named operator on a stored booking — on W372. */}
      <h2>{t.t('wh.assays')}</h2>
      <p><Link href={assayHref(b.id)} className="kv-btn" data-kv-real="assays">{t.t('wh.assaysLink')}</Link></p>
      {/* PC-56 OPS-2b (founder Q3-A): no eNWR issue form — this platform does not issue an eNWR. */}
      <p className="kv-muted" data-kv-fact="no-issue">{t.t('wh.noIssue')}</p>
    </section>
  );
}
