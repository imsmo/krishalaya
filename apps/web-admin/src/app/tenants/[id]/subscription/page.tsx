// apps/web-admin/src/app/tenants/[id]/subscription/page.tsx · one tenant's SUBSCRIPTION (PC-56 ADMIN-1, canon W017).
// Server component: requireAdmin gates, adminGet hits GET /v1/billing/subscriptions/:tenantId (owner perm enforced
// server-side; a 404 means no such tenant → notFound(), which is different from a real tenant with no subscription).
//
// THE CANON CALLS THIS A TIMELINE AND IT IS NOT ONE, DELIBERATELY. The platform stores no subscription-event
// history — `subscriptions` holds the current row only — so this page cannot say when the tenant became active or
// who changed the price, and does not pretend to. What it shows instead is three true things: the state now, the
// states that could legally follow (labelled as possibilities, from the machine admin-api enforces), and the
// invoices this subscription has actually produced, which IS a dated history. A plausible-looking timeline
// reconstructed from `updated_at` would be fiction about a contract, and this is exactly the record a tenant
// disputes years later.
//
// NO MONEY IS COMPUTED HERE. The negotiated price, the discount percentage and each add-on price are displayed as
// stored; the page never multiplies a monthly price by twelve, never applies the discount, never totals the add-ons.
// The invoice is the arithmetic and the billing cycle owns it (Law 2). Degrade-never-die throughout.
//
// PC-56 ADMIN-1c ADDED WRITES (ADMIN-1-Q10): change plan, add an add-on, schedule or revoke a cancellation. They
// change what the NEXT invoice says and touch no issued document. They are elevation-gated server-side and each one
// carries a mandatory reason, because a subscription's history is what gets disputed years later.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TenantTabs } from '../../../../components/TenantTabs';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { invoiceStatusKey } from '../../../../features/billing/billing';
import {
  possibleNext, isTerminalSubscription, daysToRenewal, renewalState, anchorTermRows, hasAnchorTerms,
  addonActive, sortAddons, sortHistory, unsettledCount,
  type SubscriptionRow, type AddonRow, type HistoryInvoice,
} from '../../../../features/billing/subscription-view';
import {
  BILLING_CYCLES, canChangeSubscription, changeBlockedReason, cancelToggleAction,
} from '../../../../features/billing/subscription-write';
import { changePlanAction, addAddonAction, setCancelAtPeriodEndAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sub.title'), robots: { index: false, follow: false } };
}

interface SubscriptionView { tenantId: string; subscription: SubscriptionRow | null; addons: AddonRow[]; invoices: HistoryInvoice[] }

const OK = new Set(['plan_changed', 'addon_added', 'cancel_scheduled', 'cancel_revoked']);
const ERR = new Set([
  'sub_plan', 'sub_samePlan', 'sub_price', 'sub_cycle', 'sub_discount', 'sub_reason',
  'addon_code', 'addon_quantity', 'addon_price', 'addon_startsOn', 'addon_endsOn', 'addon_order', 'addon_reason',
  'elevation', 'illegal', 'notFound', 'generic',
]);

export default async function SubscriptionPage({ params, searchParams }: {
  params: { id: string }; searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const tenantId = params.id;

  let view: SubscriptionView | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<SubscriptionView>(`billing/subscriptions/${encodeURIComponent(tenantId)}`);
    view = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();   // no such tenant (never "no subscription")
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const backHref = `/tenants/${encodeURIComponent(tenantId)}`;
  const sub = view?.subscription ?? null;
  const nowIso = new Date().toISOString();
  const state = sub ? renewalState(sub, nowIso) : 'unknown';
  const days = sub ? daysToRenewal(sub.periodEnd, nowIso) : null;
  const cur = sub?.currency ?? 'INR';
  const addons = sortAddons(view?.addons ?? [], nowIso);
  const history = sortHistory(view?.invoices ?? []);
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const blocked = changeBlockedReason(sub?.status, !!sub);
  const today = nowIso.slice(0, 10);

  return (
    <section>
      <p className="kv-backlink"><Link href={backHref}>{t.t('sub.backToTenant')}</Link></p>
      <h1>{t.t('sub.title')}</h1>
      <TenantTabs tenantId={tenantId} active="subscription" />
      {okKey && <p className="kv-success" role="status">{t.t(`sub.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sub.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : !sub ? (
        // A real tenant with no subscription is a legitimate state — an approved tenant awaiting its first plan.
        <p className="kv-empty">{t.t('sub.none')}</p>
      ) : (
        <>
          <p className="kv-card__title">
            <span className="kv-status">{t.t(`sub.state.${sub.status ?? 'unknown'}`)}</span>
            {' '}{t.t(`sub.cycle.${sub.billingCycle === 'annual' ? 'annual' : 'monthly'}`)}
          </p>

          {/* Price as negotiated, shown as stored. Note the wording: this is the agreed price, not a monthly cost. */}
          <dl className="kv-detail">
            <dt>{t.t('sub.price')}</dt>
            <dd>{formatMoneyMinor(String(sub.priceMinor ?? '0'), cur)}<span className="kv-detail__muted"> {t.t('sub.perCycle')}</span></dd>
            <dt>{t.t('sub.discount')}</dt>
            <dd>{sub.discountPct ?? '0'}%<span className="kv-detail__muted"> {t.t('sub.discountNote')}</span></dd>
            <dt>{t.t('sub.period')}</dt>
            <dd>{sub.periodStart ? formatDate(sub.periodStart) : t.t('common.dash')} → {sub.periodEnd ? formatDate(sub.periodEnd) : t.t('common.dash')}</dd>
            <dt>{t.t('sub.plan')}</dt>
            <dd>{sub.planId ? <Link href={`/plans/${encodeURIComponent(sub.planId)}`}>{sub.planId.slice(0, 8)}</Link> : t.t('common.dash')}</dd>
          </dl>

          {/* The renewal window says which conversation this is. `lapsed` is surfaced, not smoothed over. */}
          <p className={state === 'lapsed' ? 'kv-error' : 'kv-notice'} role="note">
            {t.t(`sub.renewal.${state}`)}
            {days !== null && state === 'renewing' ? ` — ${t.t('sub.inDays', { n: String(days) })}` : ''}
            {days !== null && state === 'ending' ? ` — ${t.t('sub.lastDayInDays', { n: String(days) })}` : ''}
            {days !== null && state === 'lapsed' ? ` — ${t.t('sub.lapsedDays', { n: String(Math.abs(days)) })}` : ''}
          </p>
          {sub.cancelledAt && <p className="kv-detail__muted">{t.t('sub.cancelledOn', { date: formatDate(sub.cancelledAt) })}</p>}

          {/* Negotiated terms, shown as recorded and never interpreted. */}
          {hasAnchorTerms(sub) && (
            <section aria-labelledby="anchor-h">
              <h2 id="anchor-h">{t.t('sub.anchorTitle')}</h2>
              <p className="kv-field__hint">{t.t('sub.anchorHint')}</p>
              <dl className="kv-detail">
                {anchorTermRows(sub.anchorTerms).map((row) => (
                  <div key={row.key}><dt>{row.key}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {/* Where the machine could go next — POSSIBILITIES, not history. These particular transitions are driven by
              the billing cycle and the tenant lifecycle, so there is nothing to click HERE; the writes this page does
              offer (plan, add-ons, cancel-at-period-end) are further down and are a different kind of act. */}
          <section aria-labelledby="next-h">
            <h2 id="next-h">{t.t('sub.nextTitle')}</h2>
            {isTerminalSubscription(sub.status) ? (
              <p className="kv-notice" role="note">{t.t('sub.terminalNote')}</p>
            ) : (
              <>
                <ul className="kv-chips" role="list">
                  {possibleNext(sub.status).map((n) => <li key={n} className="kv-status kv-status--muted">{t.t(`sub.state.${n}`)}</li>)}
                </ul>
                <p className="kv-field__hint">{t.t('sub.nextHint')}</p>
              </>
            )}
          </section>

          {/* Add-ons: what is billing now, first; what has ended, still visible because it explains old invoices. */}
          <section aria-labelledby="addons-h">
            <h2 id="addons-h">{t.t('sub.addonsTitle')}</h2>
            {addons.length === 0 ? <p className="kv-empty">{t.t('sub.noAddons')}</p> : (
              <ul className="kv-list" role="list">
                {addons.map((a) => {
                  const active = addonActive(a, nowIso);
                  return (
                    <li key={a.id ?? a.addonCode} className="kv-card">
                      <p className="kv-card__title">
                        {a.addonCode ?? t.t('common.dash')}
                        {' '}<span className={`kv-status ${active ? 'kv-status--ok' : 'kv-status--muted'}`}>
                          {t.t(active ? 'sub.addonActive' : 'sub.addonEnded')}
                        </span>
                      </p>
                      <p className="kv-detail__muted">
                        {t.t('sub.addonQty', { n: String(a.quantity ?? 1) })}
                        {' · '}{formatMoneyMinor(String(a.priceMinor ?? '0'), cur)}
                        {a.startsOn ? ` · ${t.t('sub.from')} ${formatDate(a.startsOn)}` : ''}
                        {a.endsOn ? ` → ${formatDate(a.endsOn)}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="kv-field__hint">{t.t('sub.addonsNote')}</p>
          </section>

          {/* The real history: the invoices this subscription produced. */}
          <section aria-labelledby="hist-h">
            <h2 id="hist-h">{t.t('sub.historyTitle')}</h2>
            <p className="kv-field__hint">{t.t('sub.historyHint')}</p>
            {unsettledCount(history) > 0 && (
              <p className="kv-notice" role="note">{t.t('sub.unsettled', { n: String(unsettledCount(history)) })}</p>
            )}
            {history.length === 0 ? <p className="kv-empty">{t.t('sub.noInvoices')}</p> : (
              <ul className="kv-list" role="list">
                {history.map((i) => {
                  const status = invoiceStatusKey(i.status);
                  return (
                    <li key={i.id ?? i.invoiceNo} className="kv-card">
                      <p className="kv-card__title">
                        <Link href={`/billing/invoices/${encodeURIComponent(String(i.id ?? ''))}`}>{i.invoiceNo ?? t.t('common.dash')}</Link>
                        {' '}<span className="kv-status">{t.t(`billing.status.${status}`)}</span>
                      </p>
                      <p className="kv-detail__muted">
                        {formatMoneyMinor(String(i.totalMinor ?? '0'), i.currency ?? cur)}
                        {i.dueDate ? ` · ${t.t('sub.due')} ${formatDate(i.dueDate)}` : ''}
                        {i.paidAt ? ` · ${t.t('sub.paidOn')} ${formatDate(i.paidAt)}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ---- WRITES (PC-56 ADMIN-1c) ---------------------------------------------------------------------
              A finished subscription shows no controls at all — it is re-sold, not edited — and the page says which
              of the two reasons applies rather than rendering a form the server would refuse. */}
          {!canChangeSubscription(sub.status) ? (
            <p className="kv-notice" role="note">{t.t(`sub.blocked.${blocked}`)}</p>
          ) : (
            <>
              <details className="kv-card kv-limit-form">
                <summary className="kv-card__title">{t.t('sub.changePlanTitle')}</summary>
                <p className="kv-field__hint">{t.t('sub.changePlanHint')}</p>
                <form action={changePlanAction} className="kv-form">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  {/* the current plan id travels so a no-op change is refused before a reason is typed */}
                  <input type="hidden" name="currentPlanId" value={String(sub.planId ?? '')} />
                  <label htmlFor="planId" className="kv-field__label">{t.t('sub.newPlanId')}</label>
                  <input id="planId" name="planId" className="kv-input" required placeholder="plan UUID" />
                  <label htmlFor="priceMajor" className="kv-field__label">{t.t('sub.newPrice', { currency: cur })}</label>
                  <input id="priceMajor" name="priceMajor" className="kv-input" required inputMode="decimal" placeholder="4990.00" />
                  <p className="kv-field__hint">{t.t('sub.priceRequiredHint')}</p>
                  <label htmlFor="billingCycle" className="kv-field__label">{t.t('sub.cycleLabel')}</label>
                  <select id="billingCycle" name="billingCycle" className="kv-input" defaultValue={sub.billingCycle ?? 'monthly'}>
                    {BILLING_CYCLES.map((c) => <option key={c} value={c}>{t.t(`sub.cycle.${c}`)}</option>)}
                  </select>
                  <label htmlFor="discountPct" className="kv-field__label">{t.t('sub.discountLabel')}</label>
                  <input id="discountPct" name="discountPct" className="kv-input" inputMode="decimal" placeholder={String(sub.discountPct ?? '0')} />
                  <p className="kv-field__hint">{t.t('sub.discountKeepHint')}</p>
                  <label htmlFor="immediate" className="kv-field__label">
                    <input id="immediate" name="immediate" type="checkbox" /> {t.t('sub.immediate')}
                  </label>
                  <p className="kv-field__hint">{t.t('sub.immediateHint')}</p>
                  <label htmlFor="cpReason" className="kv-field__label">{t.t('billing.reason')}</label>
                  <input id="cpReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                  <button type="submit" className="kv-btn">{t.t('sub.changePlanSubmit')}</button>
                </form>
              </details>

              <details className="kv-card kv-limit-form">
                <summary className="kv-card__title">{t.t('sub.addAddonTitle')}</summary>
                <p className="kv-field__hint">{t.t('sub.addAddonHint')}</p>
                <form action={addAddonAction} className="kv-form">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <label htmlFor="addonCode" className="kv-field__label">{t.t('sub.addonCode')}</label>
                  <input id="addonCode" name="addonCode" className="kv-input" required minLength={2} maxLength={60} placeholder="extra_language" />
                  <label htmlFor="quantity" className="kv-field__label">{t.t('sub.addonQuantity')}</label>
                  <input id="quantity" name="quantity" className="kv-input" inputMode="numeric" defaultValue="1" />
                  <label htmlFor="addonPrice" className="kv-field__label">{t.t('sub.addonPrice', { currency: cur })}</label>
                  <input id="addonPrice" name="priceMajor" className="kv-input" inputMode="decimal" defaultValue="0" />
                  <p className="kv-field__hint">{t.t('sub.addonZeroHint')}</p>
                  <label htmlFor="startsOn" className="kv-field__label">{t.t('sub.addonStarts')}</label>
                  <input id="startsOn" name="startsOn" className="kv-input" required type="date" defaultValue={today} />
                  <label htmlFor="endsOn" className="kv-field__label">{t.t('sub.addonEnds')}</label>
                  <input id="endsOn" name="endsOn" className="kv-input" type="date" />
                  <p className="kv-field__hint">{t.t('sub.addonEndsHint')}</p>
                  <label htmlFor="adReason" className="kv-field__label">{t.t('billing.reason')}</label>
                  <input id="adReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                  <button type="submit" className="kv-btn">{t.t('sub.addAddonSubmit')}</button>
                </form>
              </details>

              {/* One form, both directions: schedule a cancellation, or revoke one. A tenant who changes their mind
                  must not need a new subscription. */}
              <details className="kv-card kv-limit-form">
                <summary className="kv-card__title">
                  {t.t(cancelToggleAction(sub.cancelAtPeriodEnd) === 'revoke' ? 'sub.revokeCancelTitle' : 'sub.cancelTitle')}
                </summary>
                <p className="kv-field__hint">
                  {t.t(cancelToggleAction(sub.cancelAtPeriodEnd) === 'revoke' ? 'sub.revokeCancelHint' : 'sub.cancelHint')}
                </p>
                <form action={setCancelAtPeriodEndAction} className="kv-form">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="cancel" value={cancelToggleAction(sub.cancelAtPeriodEnd) === 'revoke' ? 'false' : 'true'} />
                  <label htmlFor="ccReason" className="kv-field__label">{t.t('billing.reason')}</label>
                  <input id="ccReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                  <button type="submit" className={`kv-btn${cancelToggleAction(sub.cancelAtPeriodEnd) === 'revoke' ? '' : ' kv-btn--danger'}`}>
                    {t.t(cancelToggleAction(sub.cancelAtPeriodEnd) === 'revoke' ? 'sub.revokeCancelSubmit' : 'sub.cancelSubmit')}
                  </button>
                </form>
              </details>
              <p className="kv-field__hint">{t.t('sub.noCancelNowNote')}</p>
            </>
          )}

          <p className="kv-field__hint">{t.t('sub.noTimelineNote')}</p>
        </>
      )}
    </section>
  );
}
