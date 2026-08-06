// apps/web-tenant/src/app/cod/page.tsx · the COD reconciliation worksheet (PC-55 B8, on W54-2 + PC-55 A2).
// Cash collected at the door has to end up in a bank account, and every row here is money somebody is holding.
//
// FOUR THINGS THIS WORKSHEET IS BUILT AROUND:
//   1. OLDEST CASH FIRST. Risk in COD is time-in-hand, so the rider holding money longest is at the top — and a row
//      with no date sorts LAST, because an unknown age must not outrank a known three-week-old bag.
//   2. THE TOTAL IS THE SERVER'S. The form sends `expectedAmountMinor` — the figure the operator was READING — so the
//      API can REFUSE if the real total moved since the page loaded. It is a stale-read guard, not a client total.
//   3. MAKER ≠ CHECKER. Reconcile is withheld from whoever recorded the deposit (and from anyone without the
//      permission), and the reason is printed. Two people must see the money.
//   4. A DELIVERED COD SHIPMENT IS COUNTED ONCE, EVER (a DB unique index). So there is no "re-add a shipment" affordance:
//      if it is not in the outstanding list, it is already on a remittance.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  AGEING_WARN_DAYS, DEPOSIT_METHODS, REMITTANCE_STATUSES,
  daysHeld, isAgeing, isRemittanceStatus, reconcileBlockedReason, remittanceActions, sortOutstanding, totalOutstandingMinor,
  type OutstandingRow,
} from '../../features/cod/recon';
import { cancelRemittanceAction, depositRemittanceAction, openRemittanceAction, reconcileRemittanceAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cod.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['opened', 'deposited', 'reconciled', 'cancelled']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'stale',
  'cod_rider', 'cod_expected', 'cod_depositRef', 'cod_depositMethod', 'cod_reason']);

type RemittanceRow = Record<string, unknown> & {
  id?: string; riderUserId?: string; status?: string; amountMinor?: string; shipmentCount?: number;
  depositRef?: string | null; depositedBy?: string | null; createdAt?: string;
};

export default async function CodPage({ searchParams }: { searchParams: { status?: string; ok?: string; error?: string } }) {
  await requireSession('/cod');
  const t = getTranslator();
  const lang = getLang();
  const now = Date.now();
  const status = isRemittanceStatus(searchParams.status) ? searchParams.status : undefined;
  // Display gating only — the API re-enforces the permission AND maker≠checker on the reconcile call.
  const canReconcile = tenantHasPerm('payout.manage');

  let outstanding: OutstandingRow[] = []; let outFailed = false;
  try { outstanding = (await tenantClient().shipments.codOutstanding()) as OutstandingRow[]; }
  catch { outFailed = true; }

  let remittances: RemittanceRow[] = []; let remFailed = false;
  try { remittances = (await tenantClient().shipments.codRemittances({ status, limit: 100 })) as RemittanceRow[]; }
  catch { remFailed = true; }

  let viewerId: string | undefined;
  try { viewerId = (await tenantClient().auth.me()).id; } catch { viewerId = undefined; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const rows = sortOutstanding(outstanding);
  const total = totalOutstandingMinor(rows);

  return (
    <section>
      <h1>{t.t('cod.title')}</h1>
      <p className="kv-field__hint">{t.t('cod.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`cod.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cod.error.${errKey}`)}</p>}
      {!canReconcile && <p className="kv-notice" role="note">{t.t('cod.noReconcileNotice')}</p>}

      <h2>{t.t('cod.outstanding')}</h2>
      {outFailed ? <p className="kv-error" role="alert">{t.t('cod.loadError')}</p> : (
        <>
          <p className="kv-field__hint">{t.t('cod.totalOutstanding', { amount: formatMoneyMinor(total.toString(), 'INR', lang) })}</p>
          <DataTable
            rows={rows}
            empty={t.t('cod.noneOutstanding')}
            columns={[
              { header: t.t('cod.colRider'), cell: (r) => (r.riderUserId ? `${String(r.riderUserId).slice(0, 8)}…` : t.t('cod.unassigned')) },
              { header: t.t('cod.colShipments'), cell: (r) => String(r.shipments ?? 0) },
              { header: t.t('cod.colCash'), cell: (r) => (r.codMinor ? formatMoneyMinor(String(r.codMinor), 'INR', lang) : t.t('common.dash')) },
              {
                header: t.t('cod.colHeld'),
                cell: (r) => {
                  const d = daysHeld(r.oldestDeliveredAt, now);
                  if (d === null) return t.t('common.dash');
                  const label = t.t('cod.daysHeld', { n: String(d) });
                  return isAgeing(r.oldestDeliveredAt, now) ? <strong>{label}</strong> : label;
                },
              },
              {
                header: t.t('cod.colOpen'),
                cell: (r) => (r.riderUserId ? (
                  <form action={openRemittanceAction} className="kv-inline-form">
                    <input type="hidden" name="riderUserId" value={String(r.riderUserId)} />
                    {/* the figure the operator is looking at — the API refuses if the real total has moved */}
                    <input type="hidden" name="expectedAmountMinor" value={String(r.codMinor ?? '')} />
                    <button type="submit" className="kv-btn kv-btn--sm">{t.t('cod.openBtn')}</button>
                  </form>
                ) : <span className="kv-detail__muted">{t.t('cod.unassignedNote')}</span>),
              },
            ]}
          />
          <p className="kv-field__hint">{t.t('cod.ageingNote', { days: String(AGEING_WARN_DAYS) })}</p>
        </>
      )}

      <h2>{t.t('cod.remittances')}</h2>
      <nav className="kv-tabs" aria-label={t.t('cod.filter')}>
        <a href="/cod" className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('cod.all')}</a>
        {REMITTANCE_STATUSES.map((s) => (
          <a key={s} href={`/cod?status=${s}`} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>{t.t(`cod.state.${s}`)}</a>
        ))}
      </nav>
      {remFailed ? <p className="kv-error" role="alert">{t.t('cod.loadError')}</p> : remittances.length === 0 ? (
        <p className="kv-field__hint">{t.t('cod.noRemittances')}</p>
      ) : remittances.map((r) => {
        const acts = remittanceActions(r, viewerId, canReconcile);
        const blocked = reconcileBlockedReason(r, viewerId, canReconcile);
        return (
          <div key={String(r.id)} className="kv-card">
            <div className="kv-page-head">
              <strong>{r.amountMinor ? formatMoneyMinor(String(r.amountMinor), 'INR', lang) : t.t('common.dash')}</strong>
              <span className="kv-badge">{t.t(`cod.state.${String(r.status)}`) || String(r.status)}</span>
            </div>
            <p className="kv-detail__muted">
              {t.t('cod.colRider')}: {r.riderUserId ? `${String(r.riderUserId).slice(0, 8)}…` : t.t('common.dash')}
              {r.shipmentCount != null ? ` · ${t.t('cod.shipmentsCounted', { n: String(r.shipmentCount) })}` : ''}
              {r.depositRef ? ` · ${t.t('cod.ref')}: ${String(r.depositRef)}` : ''}
              {r.createdAt ? ` · ${formatDate(String(r.createdAt), lang, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </p>

            {acts.includes('deposit') ? (
              <form action={depositRemittanceAction} className="kv-form">
                <input type="hidden" name="id" value={String(r.id ?? '')} />
                <label htmlFor={`ref-${r.id}`} className="kv-form__label">{t.t('cod.depositRef')}</label>
                <input id={`ref-${r.id}`} name="depositRef" className="kv-field__input" minLength={3} maxLength={80} required />
                <label htmlFor={`m-${r.id}`} className="kv-form__label">{t.t('cod.depositMethod')}</label>
                <select id={`m-${r.id}`} name="depositMethod" className="kv-field__input" required defaultValue="">
                  <option value="" disabled>{t.t('cod.chooseMethod')}</option>
                  {DEPOSIT_METHODS.map((m) => <option key={m} value={m}>{t.t(`cod.method.${m}`)}</option>)}
                </select>
                <p className="kv-detail__muted">{t.t('cod.depositHint')}</p>
                <button type="submit" className="kv-btn">{t.t('cod.depositBtn')}</button>
              </form>
            ) : null}

            {acts.includes('reconcile') ? (
              <form action={reconcileRemittanceAction} className="kv-form">
                <input type="hidden" name="id" value={String(r.id ?? '')} />
                <label htmlFor={`n-${r.id}`} className="kv-form__label">{t.t('cod.reconcileNote')}</label>
                <input id={`n-${r.id}`} name="note" className="kv-field__input" maxLength={500} />
                <button type="submit" className="kv-btn">{t.t('cod.reconcileBtn')}</button>
              </form>
            ) : blocked !== 'none' && r.status === 'deposited' ? (
              <p className="kv-notice" role="note">{t.t(`cod.blocked.${blocked}`)}</p>
            ) : null}

            {acts.includes('cancel') ? (
              <form action={cancelRemittanceAction} className="kv-form">
                <input type="hidden" name="id" value={String(r.id ?? '')} />
                <label htmlFor={`cr-${r.id}`} className="kv-form__label">{t.t('cod.cancelReason')}</label>
                <input id={`cr-${r.id}`} name="reason" className="kv-field__input" minLength={3} maxLength={500} required />
                <p className="kv-detail__muted">{t.t('cod.cancelHint')}</p>
                <button type="submit" className="kv-btn kv-btn--muted">{t.t('cod.cancelBtn')}</button>
              </form>
            ) : null}
          </div>
        );
      })}
      <p className="kv-field__hint kv-note">{t.t('cod.footerNote')}</p>
    </section>
  );
}
