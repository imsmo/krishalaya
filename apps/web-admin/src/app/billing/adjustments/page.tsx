// apps/web-admin/src/app/billing/adjustments/page.tsx · manual billing adjustments. Server component: requireAdmin
// gates, adminGet hits GET /v1/billing/adjustments (tenant filter + keyset). A post-adjustment form drives the
// MONEY MOVE (POST /billing/adjustments → wallet-service): the amount is entered in MINOR UNITS (digits only,
// float-free) and the Server Action attaches a fresh idempotency key. Money via formatMoneyMinor. Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Adjustment } from '../../../features/billing/billing';
import { applyAdjustmentAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.adjTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['tenantId', 'direction', 'amountMinor', 'currency', 'reason', 'subscriptionId', 'invoiceId', 'elevation', 'amount', 'notFound', 'generic']);

export default async function AdjustmentsPage({ searchParams }: { searchParams: { cursor?: string; tenantId?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: Adjustment[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Adjustment[]>('billing/adjustments', { cursor: searchParams.cursor, tenantId: searchParams.tenantId, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok === 'adjusted' ? 'adjusted' : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const cols: Column<Adjustment>[] = [
    { header: t.t('billing.adjTenant'), cell: (a) => a.tenantId.slice(0, 8) },
    { header: t.t('billing.adjDirection'), cell: (a) => <span className={a.direction === 'credit' ? 'kv-status kv-status--ok' : 'kv-status kv-status--warn'}>{t.t(`billing.direction.${a.direction}`)}</span> },
    { header: t.t('billing.adjAmount'), cell: (a) => formatMoneyMinor(a.amountMinor, a.currency) },
    { header: t.t('billing.adjReason'), cell: (a) => a.reason },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('billing.adjTitle')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t('billing.ok.adjusted')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`billing.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('billing.noAdjustments')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={`/billing/adjustments?cursor=${encodeURIComponent(nextCursor)}`}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('billing.postAdjustment')}</summary>
        <p className="kv-field__hint">{t.t('billing.postHint')}</p>
        <form action={applyAdjustmentAction} className="kv-form">
          <label htmlFor="tenantId" className="kv-field__label">{t.t('billing.adjTenantId')}</label>
          <input id="tenantId" name="tenantId" className="kv-input" required placeholder="tenant UUID" />
          <label htmlFor="direction" className="kv-field__label">{t.t('billing.adjDirection')}</label>
          <select id="direction" name="direction" className="kv-input" defaultValue="credit">
            <option value="credit">{t.t('billing.direction.credit')}</option>
            <option value="debit">{t.t('billing.direction.debit')}</option>
          </select>
          <label htmlFor="amountMinor" className="kv-field__label">{t.t('billing.adjAmountMinor')}</label>
          <input id="amountMinor" name="amountMinor" className="kv-input" required inputMode="numeric" placeholder="50000" />
          <label htmlFor="currency" className="kv-field__label">{t.t('billing.adjCurrency')}</label>
          <input id="currency" name="currency" className="kv-input" defaultValue="INR" />
          <label htmlFor="adjReason" className="kv-field__label">{t.t('billing.reason')}</label>
          <input id="adjReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('billing.postSubmit')}</button>
        </form>
      </details>
    </section>
  );
}
