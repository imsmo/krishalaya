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
import { RETURN_STATUSES, awaitingBuyerShipment, isReturnStatus } from '../../features/returns/rma';
import { returnActions, refundBlockedBy } from '../../features/disputes/console';
import { returnStepAction, inspectReturnAction, proposeReturnRefundAction } from './actions';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { ReturnQueueRow } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rma.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['approve', 'reject', 'receive', 'refund', 'inspect', 'proposed']);
// PC-56 TENANT-3b: the gate's refusals are named. "needsChecker" tells an operator what to do next; "illegal" does not.
const ERR = new Set(['generic', 'forbidden', 'notFound', 'illegal', 'step', 'noteTooShort', 'noAmount',
  'needsChecker', 'awaitingChecker', 'rejectedByChecker', 'amountChanged', 'alreadyApplied', 'returnInvalid']);

export default async function ReturnsPage({ searchParams }: { searchParams: { status?: string; cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/returns');
  const t = getTranslator();
  const lang = getLang();
  const status = isReturnStatus(searchParams.status) ? searchParams.status : undefined;
  // Display gating only — the API re-enforces dispute.resolve AND order.refund on the refund call itself.
  const canResolve = tenantHasPerm('dispute.resolve');
  const canRefundPerm = tenantHasPerm('order.refund');

  let rows: ReturnQueueRow[] = []; let nextCursor: string | null = null; let failed = false;
  let counts: Record<string, number> | null = null;
  // W142's queue read (0139): the refund VALUE the table always showed and never had a column for, the inspection
  // state its "Inspect" action writes, and whether a refund is already waiting on a checker. Counts degrade apart.
  const [lRes, cRes] = await Promise.allSettled([
    tenantClient().returns.consoleList({ status, cursor: searchParams.cursor, limit: 50 }),
    tenantClient().returns.counts(),
  ]);
  if (lRes.status === 'fulfilled') { rows = lRes.value.items; nextCursor = lRes.value.nextCursor; } else { failed = true; }
  if (cRes.status === 'fulfilled') counts = cRes.value;

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
      {canResolve && !canRefundPerm && <p className="kv-notice" role="note">{t.t('rma.noRefundPermNotice')}</p>}
      {/* W142's footnote, and the money truth behind it: the reversal now HAS an executor (0139 / TENANT-3b). */}
      <p className="kv-field__hint">{t.t('rma.moneyFollowsGoods')}</p>

      <nav className="kv-tabs" aria-label={t.t('rma.filter')}>
        <a href={boxHref()} className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('rma.all')}</a>
        {RETURN_STATUSES.map((s) => (
          <a key={s} href={boxHref(s)} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>
            {t.t(`rma.status.${s}`)}
            {counts && counts[s] !== undefined && <span className="kv-tab__count"> {counts[s]}</span>}
          </a>
        ))}
      </nav>

      {failed ? <p className="kv-error" role="alert">{t.t('rma.loadError')}</p> : (
        <DataTable
          rows={rows}
          empty={t.t('rma.empty')}
          columns={[
            { header: t.t('rma.colCase'), cell: (r) => String(r.id ?? '').slice(0, 8) + '…' },
            { header: t.t('rma.colOrder'), cell: (r) => r.orderNo ?? String(r.orderId ?? '').slice(0, 8) + '…' },
            { header: t.t('rma.colReason'), cell: (r) => (r.reasonCode ? t.t(`rma.reason.${r.reasonCode}`) || r.reasonCode : t.t('common.dash')) },
            {
              // W142's "Refund value" column — 0139 gave it a column. **NOT RECORDED IS NOT ZERO**: a return with no
              // recorded amount says so, and the refund path refuses it rather than assuming the order total.
              header: t.t('rma.colValue'),
              cell: (r) => (r.refundAmountMinor
                ? <span>{formatMoneyMinor(r.refundAmountMinor, r.currencyCode ?? 'INR', lang)}</span>
                : <span className="kv-muted">{t.t('rma.valueNotRecorded')}</span>),
            },
            {
              header: t.t('rma.colStatus'),
              cell: (r) => {
                const blocked = refundBlockedBy(r, { canRefund: canRefundPerm });
                return (
                  <>
                    <span className="kv-badge">{t.t(`rma.status.${String(r.status)}`) || String(r.status)}</span>
                    {awaitingBuyerShipment(r.status) ? <span className="kv-detail__muted"> {t.t('rma.awaitingBuyer')}</span> : null}
                    {r.pendingApprovalId ? <span className="kv-badge">{t.t('rma.awaitingChecker')}</span> : null}
                    {r.inspectedAt ? <span className="kv-detail__muted"> {t.t('rma.inspected')}</span> : null}
                    {blocked ? <span className="kv-detail__muted"> {t.t(`rma.blocked.${blocked}`)}</span> : null}
                  </>
                );
              },
            },
            { header: t.t('rma.colWhen'), cell: (r) => (r.createdAt ? formatDate(String(r.createdAt), lang) : t.t('common.dash')) },
            {
              header: t.t('rma.colAction'),
              cell: (r) => (
                <>
                  {returnActions(r, { canResolve, canRefund: canRefundPerm }).map((step) => (
                    step === 'inspect' ? (
                      // W142: "inspect within 24h → refund". The note lands on the row and the refund path reads it.
                      <form key={step} action={inspectReturnAction} className="kv-inline-form">
                        <input type="hidden" name="id" value={String(r.id ?? '')} />
                        <label className="kv-label" htmlFor={`insp-${r.id}`}>{t.t('rma.inspectLabel')}</label>
                        <textarea id={`insp-${r.id}`} name="note" className="kv-input" rows={2} minLength={20} maxLength={4000} required />
                        <button type="submit" className="kv-btn kv-btn--sm">{t.t('rma.step.inspect')}</button>
                      </form>
                    ) : (
                      <form key={step} action={returnStepAction} className="kv-inline-form">
                        <input type="hidden" name="id" value={String(r.id ?? '')} />
                        <input type="hidden" name="step" value={step} />
                        <button type="submit" className={`kv-btn kv-btn--sm${step === 'refund' ? '' : ' kv-btn--muted'}`}>{t.t(`rma.step.${step}`)}</button>
                      </form>
                    )
                  ))}
                  {/* The maker's half of the plane, on the row where the refund would be pressed: at or above the
                      tenant's threshold the refund cannot be executed here at all until somebody else signs. */}
                  {canResolve && r.status === 'received' && r.inspectedAt && r.refundAmountMinor && !r.pendingApprovalId && (
                    <form action={proposeReturnRefundAction} className="kv-inline-form">
                      <input type="hidden" name="id" value={String(r.id ?? '')} />
                      <input type="hidden" name="amountMinor" value={r.refundAmountMinor} />
                      <label className="kv-label" htmlFor={`prop-${r.id}`}>{t.t('rma.proposeLabel')}</label>
                      <textarea id={`prop-${r.id}`} name="note" className="kv-input" rows={2} minLength={20} maxLength={2000} required />
                      <button type="submit" className="kv-btn kv-btn--sm kv-btn--muted">{t.t('rma.proposeCta')}</button>
                    </form>
                  )}
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
