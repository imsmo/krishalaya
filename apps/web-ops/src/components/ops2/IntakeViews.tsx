// apps/web-ops/src/components/ops2/IntakeViews.tsx · PC-56 OPS-2a · W370 WAREHOUSE DASHBOARD, W371 WEIGHBRIDGE, W374 STACKING and the booking drill-in —
// presentational (founder Q6-A, Q8-A, Q9-A, Q10-A, Q11-A, Q12-A, Q14-A, 2026-11-06; D3, 2026-11-08).
//
// W370 prints what `readDashboard` (features/ops2/intake.ts) answered: per warehouse the person operates, its bookings — reference, status (translated),
// commodity (the product's own name, or "not available"), quantity as the server's string with its unit, dates. NO depositor (Q9-A — the SDK type
// does not even carry her id), NO total, NO count, NO "of N" (E3). The ONE input is the GET status select. "New booking" is refused with the founder's
// Q12-A words; release is paused for everyone (true: OPS-1a). Real links to the weighbridge and stacking pages (the edges the canon never drew).
// W371 and W374 are HONEST and read nothing: facts only, zero inputs, no error state.
// The drill-in prints one booking; its acts (confirm, store, cancel with a REQUIRED reason) are offered only to the warehouse's named operator.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDate } from '@krishalaya/i18n';
import type { StorageBooking } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops2/refusals';
import { BOOKING_STATUSES, DASHBOARD_PAGE, REGISTRY_PAGE, STACKING_PAGE, WEIGHBRIDGE_PAGE, dashboardHref, isQuantityString, isUnitCode,
  type DashboardGroup, type DashboardState } from '../../features/ops2/intake';
import { canCancel, canConfirm, canRelease, canStore } from '../../features/warehouse/manage';
import { assayHref } from '../../features/ops2/receipts';
import { ReleasePaused } from '../ops1/WithdrawalView';
import { Ops2Refusals } from './Ops2Chain';
import { ltrText } from '../../features/rtl/span';   // PC-56 RTL-1g: a code inside a sentence, isolated under Arabic only

const date = (v: string | null | undefined, lang: string, t: Tr) => (v ? formatDate(v, lang) : t.t('ops2.whDash.noDate'));
/** The booking status in the reader's language (F-19), never a raw enum. */
export function BookingStatus({ t, status }: { t: Tr; status: string }) {
  return (BOOKING_STATUSES as readonly string[]).includes(status)
    ? <span className="kv-badge" data-kv-status={status}>{t.t(`wh.status.${status}`)}</span>
    : <span className="kv-badge" data-kv-status="unknown">{t.t('ops2.whDash.statusUnknown')}</span>;
}
function Quantity({ t, quantity, unitCode }: { t: Tr; quantity: string; unitCode: string }) {
  return isQuantityString(quantity)
    ? <span className="kv-mono" data-kv-quantity={quantity}>{quantity} {isUnitCode(unitCode) ? unitCode : ''}</span>
    : <span>{t.t('ops2.whDash.noQuantity')}</span>;
}

export interface WhDashboardViewProps { t: Tr; lang: string; state: DashboardState; groups: readonly DashboardGroup[]; status?: string }
export function WhDashboardView({ t, lang, state, groups, status }: WhDashboardViewProps) {
  return (
    <section data-kv-ops2="wh_dashboard" data-kv-state={state}>
      <h1>{t.t('ops2.whDash.title')}</h1>
      <p className="kv-muted" data-kv-statement="ops2.whDash.lead">{t.t('ops2.whDash.lead')}</p>
      <div className="kv-card" data-kv-statement="wh_dashboard">
        <p className="kv-statement" data-kv-statement="ops2.whDash.newBooking">{t.t('ops2.whDash.newBooking')}</p>
        <p data-kv-fact="release-paused">{t.t('ops2.whDash.releasePaused')}</p>
      </div>
      {state === 'off' ? (
        <div className="kv-card" data-kv-off="warehousing"><h2 className="kv-card__title">{t.t('ops2.whDash.off.title')}</h2><p>{t.t('ops2.whDash.off.body')}</p></div>
      ) : state === 'forbidden' ? (
        <div className="kv-card" role="alert" data-kv-error="forbidden"><h2 className="kv-card__title">{t.t('ops2.whDash.forbidden.title')}</h2><p>{t.t('ops2.whDash.forbidden.body')}</p></div>
      ) : state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="bookings">
          <h2 className="kv-card__title">{t.t('ops2.whDash.error.title')}</h2><p>{t.t('ops2.whDash.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${DASHBOARD_PAGE}?act=confirm`} data-kv-parity="retry">{t.t('ops2.whDash.error.retry')}</Link></p>
        </div>
      ) : (
        <>
          <form method="get" action={DASHBOARD_PAGE} className="kv-inline-form" role="search" data-kv-form="status">
            <label htmlFor="wh-dash-status" className="kv-field__label">{t.t('ops2.whDash.statusLabel')}</label>
            <select id="wh-dash-status" name="status" defaultValue={status ?? ''} className="kv-input">
              <option value="">{t.t('ops2.whDash.statusAny')}</option>
              {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{t.t(`wh.status.${s}`)}</option>)}
            </select>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops2.whDash.apply')}</button>
          </form>
          {state === 'none' ? (
            <div className="kv-empty-state" data-kv-empty="warehouses"><h2>{t.t('ops2.whDash.none.title')}</h2><p>{t.t('ops2.whDash.none.body')}</p></div>
          ) : groups.map((g) => (
            <div key={g.warehouse.id} className="kv-card" data-kv-warehouse={g.warehouse.id}>
              <h2 className="kv-card__title">{g.warehouse.name}</h2>
              <p className="kv-muted" data-kv-wdra={g.warehouse.wdraRegNo ? 'entered' : 'none'}>{t.t('ops2.whDash.wdraLabel')} {g.warehouse.wdraRegNo ? t.t('ops2.billing.wdraAsEntered', { wdra: ltrText(g.warehouse.wdraRegNo, lang) }) : t.t('ops2.whDash.wdraNone')}</p>
              {g.rows.length === 0 ? (
                <p className="kv-empty-state" data-kv-empty="bookings">{t.t(status ? 'ops2.whDash.noMatch' : 'ops2.whDash.noBookings')}</p>
              ) : (
                <table className="kv-table">
                  <thead><tr>
                    <th>{t.t('ops2.whDash.colReference')}</th><th>{t.t('ops2.whDash.colStatus')}</th><th>{t.t('ops2.whDash.colCommodity')}</th>
                    <th>{t.t('ops2.whDash.colQuantity')}</th><th>{t.t('ops2.whDash.colRequested')}</th><th>{t.t('ops2.whDash.colStored')}</th>
                  </tr></thead>
                  <tbody>
                    {g.rows.map((b) => (
                      <tr key={b.id} data-kv-booking={b.id}>
                        <td data-kv-cell="reference"><Link className="kv-link kv-mono" href={`/warehouse/${encodeURIComponent(b.id)}`} data-kv-real="booking">{b.id.slice(0, 8)}</Link></td>
                        <td data-kv-cell="status"><BookingStatus t={t} status={b.status} /></td>
                        <td data-kv-cell="commodity">{b.commodity ?? t.t('ops2.whDash.noCommodity')}</td>
                        <td data-kv-cell="quantity"><Quantity t={t} quantity={b.quantity} unitCode={b.unitCode} /></td>
                        <td data-kv-cell="requested">{date(b.createdAt, lang, t)}</td>
                        <td data-kv-cell="stored">{date(b.storedAt, lang, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {g.nextCursor ? <p className="kv-pager"><Link className="kv-btn" href={dashboardHref({ status, warehouse: g.warehouse.id, cursor: g.nextCursor })} data-kv-real="next">{t.t('ops2.whDash.next')}</Link></p> : null}
            </div>
          ))}
        </>
      )}
      <p className="kv-pager" data-kv-acts="wh_dashboard">
        <Link className="kv-btn kv-btn--muted" href={`${DASHBOARD_PAGE}?form=review`} data-kv-decor="new-booking">{t.t('ops2.whDash.newBookingAct')}</Link>{' '}
        <Link className="kv-btn" href={WEIGHBRIDGE_PAGE} data-kv-real="weighbridge">{t.t('ops2.whDash.weighbridgeLink')}</Link>{' '}
        <Link className="kv-btn" href={STACKING_PAGE} data-kv-real="stacking">{t.t('ops2.whDash.stackingLink')}</Link>{' '}
        <Link className="kv-btn" href={REGISTRY_PAGE} data-kv-real="registry">{t.t('ops2.whDash.registryLink')}</Link>
      </p>
      <Ops2Refusals t={t} surface="wh_dashboard" />
    </section>
  );
}

export function WeighbridgeView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops2="weighbridge" data-kv-state="honest">
      <h1>{t.t('ops2.weighbridge.title')}</h1>
      <div className="kv-card" data-kv-statement="weighbridge">
        <p className="kv-statement" data-kv-statement="ops2.weighbridge.statement">{t.t('ops2.weighbridge.statement')}</p>
        <p data-kv-fact="store">{t.t('ops2.weighbridge.store')}</p>
        <p data-kv-fact="quantity">{t.t('ops2.weighbridge.quantity')}</p>
        <p data-kv-fact="fee">{t.t('ops2.weighbridge.fee')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="weighbridge">
        <Link className="kv-btn" href={DASHBOARD_PAGE} data-kv-real="dashboard">{t.t('ops2.intake.dashboardLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${WEIGHBRIDGE_PAGE}?export=queued`} data-kv-decor="print">{t.t('ops2.weighbridge.printAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${WEIGHBRIDGE_PAGE}?act=confirm`} data-kv-decor="retry">{t.t('ops2.weighbridge.retryAct')}</Link>
      </p>
      <Ops2Refusals t={t} surface="weighbridge" />
    </section>
  );
}

export function StackingView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops2="stacking" data-kv-state="honest">
      <h1>{t.t('ops2.stacking.title')}</h1>
      <div className="kv-card" data-kv-statement="stacking">
        <p className="kv-statement" data-kv-statement="ops2.stacking.statement">{t.t('ops2.stacking.statement')}</p>
        <p data-kv-fact="receipt">{t.t('ops2.stacking.receipt')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="stacking">
        <Link className="kv-btn" href={DASHBOARD_PAGE} data-kv-real="dashboard">{t.t('ops2.intake.dashboardLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${STACKING_PAGE}?form=review`} data-kv-decor="pest">{t.t('ops2.stacking.pestAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${STACKING_PAGE}?act=confirm`} data-kv-decor="retry">{t.t('ops2.stacking.retryAct')}</Link>
      </p>
      <Ops2Refusals t={t} surface="stacking" />
    </section>
  );
}

export interface BookingDetailViewProps {
  t: Tr; lang: string; booking: StorageBooking; commodity: string | null; warehouseName: string | null; isOperator: boolean;
  ok: string | null; error: string | null; action: string | ((formData: FormData) => void | Promise<void>);
}
/** The booking drill-in (`/warehouse/[id]`). The acts are offered ONLY to the warehouse's named operator; the server refuses anyone else by name. */
export function BookingDetailView({ t, lang, booking: b, commodity, warehouseName, isOperator, ok, error, action }: BookingDetailViewProps) {
  const s = b.status;
  const acts: Array<{ kind: 'confirm' | 'store'; label: string }> = [];
  if (isOperator && canConfirm(s)) acts.push({ kind: 'confirm', label: t.t('wh.actConfirm') });
  if (isOperator && canStore(s)) acts.push({ kind: 'store', label: t.t('wh.actStore') });
  let notice: ReactNode = null;
  if (ok) notice = <p className="kv-success" role="status" data-kv-ok={ok}>{t.t(`wh.ok.${ok}`)}</p>;
  else if (error) notice = <p className="kv-error" role="alert" data-kv-error={error}>{t.t(`wh.error.${error}`)}</p>;
  return (
    <section data-kv-ops2="booking" data-kv-operator={isOperator ? 'yes' : 'no'}>
      <div className="kv-page-head">
        <h1>{t.t('wh.detailTitle')}</h1>
        <Link href={DASHBOARD_PAGE} className="kv-btn--link" data-kv-real="dashboard">{t.t('ops2.intake.dashboardLink')}</Link>
      </div>
      {notice}
      <dl className="kv-facts" data-kv-booking={b.id}>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colReference')}</dt><dd className="kv-mono">{b.id.slice(0, 8)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colCommodity')}</dt><dd data-kv-cell="commodity">{commodity ?? t.t('ops2.whDash.noCommodity')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colQuantity')}</dt><dd data-kv-cell="quantity"><Quantity t={t} quantity={b.quantity} unitCode={b.unitCode} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('wh.colWarehouse')}</dt><dd data-kv-cell="warehouse">{warehouseName ?? t.t('ops2.booking.warehouseNotYours')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colStatus')}</dt><dd data-kv-cell="status"><BookingStatus t={t} status={s} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colRequested')}</dt><dd>{date(b.createdAt, lang, t)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops2.whDash.colStored')}</dt><dd>{date(b.storedAt, lang, t)}</dd></div>
      </dl>
      <p className="kv-muted" data-kv-fact="no-weight">{t.t('ops2.weighbridge.store')}</p>
      {isOperator ? (
        <div className="kv-actions" data-kv-acts="booking">
          {acts.map((a) => (
            <form key={a.kind} action={action} className="kv-inline-form" data-kv-form={a.kind}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="kind" value={a.kind} />
              <button type="submit" className="kv-btn">{a.label}</button>
            </form>
          ))}
        </div>
      ) : (
        <p className="kv-notice" role="note" data-kv-fact="not-operator">{t.t('ops2.booking.notOperator')}</p>
      )}
      {canRelease(s) && <ReleasePaused t={t} />}
      {isOperator && canCancel(s) && (
        <form action={action} className="kv-card kv-form" data-kv-form="cancel">
          <h2 className="kv-card__title">{t.t('wh.actCancel')}</h2>
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="kind" value="cancel" />
          <label htmlFor="wh-reason" className="kv-field__label">{t.t('wh.cancelReason')}</label>
          <input id="wh-reason" name="reason" className="kv-input" required minLength={1} maxLength={500} />
          <p className="kv-field__hint">{t.t('ops2.booking.reasonHint')}</p>
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('wh.actCancel')}</button>
        </form>
      )}
      <h2>{t.t('wh.assays')}</h2>
      <p><Link href={assayHref(b.id)} className="kv-btn" data-kv-real="assays">{t.t('wh.assaysLink')}</Link></p>
      <p className="kv-muted" data-kv-fact="no-issue">{t.t('wh.noIssue')}</p>
    </section>
  );
}
