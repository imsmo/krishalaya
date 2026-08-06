// apps/web-tenant/src/app/returns/page.tsx · the returns/RMA manager (PC-55 B8, on W54-2).
// A return is a buyer saying "this was not what I paid for", so the order of this page follows the goods, not the
// paperwork: what was requested, what the seller accepted, what is coming back, what arrived — and only then money.
//
// THE REFUND IS THE LAST STEP AND THE ONLY MONEY LEG. It is offered ONLY from 'received' (the goods are here) and
// only when the session's token carries dispute.resolve. Withholding the button is the control: a button that 403s
// teaches an operator that permissions are decorative. A stale claim still 403s server-side, and that is translated.
//
// 'in_transit' is deliberately NOT a seller action — the buyer posts the parcel. A seller who could mark it shipped
// could start the clock on goods they have never seen.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { RETURN_STATUSES, awaitingBuyerShipment, isReturnStatus, refundBlockedByPermission, sellerActions } from '../../features/returns/rma';
import { returnStepAction } from './actions';
import type { ReturnCase } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rma.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['approve', 'reject', 'receive', 'refund']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'illegal', 'step']);

export default async function ReturnsPage({ searchParams }: { searchParams: { status?: string; cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/returns');
  const t = getTranslator();
  const lang = getLang();
  const status = isReturnStatus(searchParams.status) ? searchParams.status : undefined;
  // Display gating only — the API re-enforces dispute.resolve on the refund call itself.
  const canResolve = tenantHasPerm('dispute.resolve');

  let rows: ReturnCase[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    // box=against: returns filed AGAINST this seller — the ones they must act on.
    const page = await tenantClient().returns.list({ box: 'against', status, cursor: searchParams.cursor, limit: 50 });
    rows = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const boxHref = (s?: string) => (s ? `/returns?status=${s}` : '/returns');

  return (
    <section>
      <h1>{t.t('rma.title')}</h1>
      <p className="kv-field__hint">{t.t('rma.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`rma.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`rma.error.${errKey}`)}</p>}
      {!canResolve && <p className="kv-notice" role="note">{t.t('rma.noResolveNotice')}</p>}

      <nav className="kv-tabs" aria-label={t.t('rma.filter')}>
        <a href={boxHref()} className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('rma.all')}</a>
        {RETURN_STATUSES.map((s) => (
          <a key={s} href={boxHref(s)} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>{t.t(`rma.status.${s}`)}</a>
        ))}
      </nav>

      {failed ? <p className="kv-error" role="alert">{t.t('rma.loadError')}</p> : (
        <DataTable
          rows={rows}
          empty={t.t('rma.empty')}
          columns={[
            { header: t.t('rma.colCase'), cell: (r) => String(r.id ?? '').slice(0, 8) + '…' },
            { header: t.t('rma.colOrder'), cell: (r) => String((r as { orderId?: string }).orderId ?? '').slice(0, 8) + '…' },
            { header: t.t('rma.colReason'), cell: (r) => ((r as { reasonCode?: string }).reasonCode ? t.t(`rma.reason.${(r as { reasonCode?: string }).reasonCode}`) || String((r as { reasonCode?: string }).reasonCode) : t.t('common.dash')) },
            {
              header: t.t('rma.colStatus'),
              cell: (r) => (
                <>
                  <span className="kv-badge">{t.t(`rma.status.${String(r.status)}`) || String(r.status)}</span>
                  {awaitingBuyerShipment(r.status) ? <span className="kv-detail__muted"> {t.t('rma.awaitingBuyer')}</span> : null}
                  {refundBlockedByPermission(r.status, canResolve) ? <span className="kv-detail__muted"> {t.t('rma.needsResolver')}</span> : null}
                </>
              ),
            },
            { header: t.t('rma.colWhen'), cell: (r) => ((r as { createdAt?: string }).createdAt ? formatDate(String((r as { createdAt?: string }).createdAt), lang) : t.t('common.dash')) },
            {
              header: t.t('rma.colAction'),
              cell: (r) => (
                <>
                  {sellerActions(r.status, canResolve).map((step) => (
                    <form key={step} action={returnStepAction} className="kv-inline-form">
                      <input type="hidden" name="id" value={String(r.id ?? '')} />
                      <input type="hidden" name="step" value={step} />
                      <button type="submit" className={`kv-btn kv-btn--sm${step === 'refund' ? '' : ' kv-btn--muted'}`}>{t.t(`rma.step.${step}`)}</button>
                    </form>
                  ))}
                </>
              ),
            },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/returns?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
      <p className="kv-field__hint kv-note">{t.t('rma.footerNote')}</p>
    </section>
  );
}
