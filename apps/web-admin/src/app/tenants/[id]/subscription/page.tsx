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
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sub.title'), robots: { index: false, follow: false } };
}

interface SubscriptionView { tenantId: string; subscription: SubscriptionRow | null; addons: AddonRow[]; invoices: HistoryInvoice[] }

export default async function SubscriptionPage({ params }: { params: { id: string } }) {
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

  return (
    <section>
      <p className="kv-backlink"><Link href={backHref}>{t.t('sub.backToTenant')}</Link></p>
      <h1>{t.t('sub.title')}</h1>

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

          {/* Where the machine could go next — POSSIBILITIES, not history, and nothing to click: the transitions are
              driven by the tenant lifecycle and the billing cycle, not by a button on this page. */}
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

          <p className="kv-field__hint">{t.t('sub.noTimelineNote')}</p>
        </>
      )}
    </section>
  );
}
