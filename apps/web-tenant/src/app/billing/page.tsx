// apps/web-tenant/src/app/billing/page.tsx · W120 (Billing) — the tenant's INVOICES, open balance and payment
// mechanism (PC-56 TENANT-4d-2) — above the subscription + plan catalogue this route already carried.
// Server-first, requireSession-gated. Every block degrades independently (Law 12). Money via formatMoneyMinor
// (Law 2); all copy via i18n; noindex.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • the open balance is total − PAID (the sum of recorded receipts), and it says when that sum is over a
//     bounded read or spans more than one currency, instead of printing a figure it cannot defend;
//   • "all on time" only when every counted invoice is PROVABLY on time — an invoice with no payment date is
//     "partly unknown", because a console must not round its own tenant's payment history up;
//   • "(incl. GST)" only where the invoice carries the rate it was raised at. Every invoice raised before this
//     wave carries none, and that reads as "rate not recorded", never as 0%;
//   • the GSTIN as SNAPSHOTTED on the invoice, not as it stands in the profile today;
//   • and, plainly, that the autopay mandate, the next debit date, the 7-day grace period and the retry loop
//     the canon states do not exist in this platform — none of the four has a subject in the code, and a
//     tenant who believes autopay is on and finds their service expired was misled by this screen.
//
// The plan catalogue and cancel form below are UNCHANGED and still the only route to a first subscription;
// /plan (W118) carries the meters and /billing/upgrade (W119) the proration preview.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { planPriceMinor, mergeUsageRows } from '../../features/billing/plan';
import {
  MECHANISM_ORDER, TABS, anyMechanismMissing, balanceKey, balanceState, gapReasonKey, gstinKey, mechanismKey,
  paidToDateKey, payButtonKey, refusalKey, tabOf, taxLineKey,
} from '../../features/billing/invoices';
import { applyPlanAction, cancelSubscriptionAction, payInvoiceAction } from './actions';
import type { Plan, Subscription, BillingConsoleView, SaasInvoiceRow, SaasPayQuote } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['plan', 'apply', 'cancel']);
const OKK = new Set(['applied', 'changed', 'cancelScheduled', 'cancelled']);

export default async function BillingPage({ searchParams }: { searchParams: { ok?: string; error?: string; tab?: string; payError?: string } }) {
  await requireSession('/billing');
  const t = getTranslator();
  const lang = getLang();
  const canBilling = tenantHasPerm('tenant.settings');
  const tab = tabOf(searchParams.tab);

  let current: { subscription: Subscription | null; limits?: Record<string, string>; usage?: Record<string, string> } = { subscription: null };
  let plans: Plan[] = []; let history: Subscription[] = [];
  let curFailed = false; let plansFailed = false;
  const [cRes, pRes, hRes] = await Promise.allSettled([
    tenantClient().tenancy.currentSubscription(),
    tenantClient().tenancy.plans(),
    tenantClient().tenancy.listSubscriptions(),
  ]);
  if (cRes.status === 'fulfilled') current = cRes.value; else curFailed = true;
  if (pRes.status === 'fulfilled') plans = pRes.value.filter((p) => p.isActive && p.isPublic); else plansFailed = true;
  if (hRes.status === 'fulfilled') history = hRes.value.items;

  // W120's own blocks. Behind `tenant.settings` AND the `saas_billing_console` flag server-side: a staff user
  // without the permission simply does not see the billing sections, rather than seeing empty ones.
  let view: BillingConsoleView | null = null;
  let invoices: SaasInvoiceRow[] = [];
  let payQuote: SaasPayQuote | null = null;
  if (canBilling) {
    const [vR, iR] = await Promise.allSettled([
      tenantClient().tenancy.billing.console(),
      tenantClient().tenancy.billing.invoices({ tab, limit: 50 }),
    ]);
    if (vR.status === 'fulfilled') view = vR.value;
    if (iR.status === 'fulfilled') invoices = iR.value.items;
    // The quote is read for the oldest-due invoice only — the one W120 puts a button next to. Resolved
    // SERVER-SIDE so the button's amount is never something this page computed.
    if (view?.oldestOpen) {
      const qR = await Promise.allSettled([tenantClient().tenancy.billing.payQuote(view.oldestOpen.id)]);
      if (qR[0].status === 'fulfilled') payQuote = qR[0].value;
    }
  }
  const payBtn = payButtonKey(payQuote);

  const okKey = searchParams.ok && OKK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const usageRows = mergeUsageRows(current.limits, current.usage);
  const sub = current.subscription;

  return (
    <section>
      <h1>{t.t('billing.title')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`billing.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`billing.error.${errorKey}`)}</p>}
      {searchParams.payError && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.payError))}</p>}

      {/* ---------- W120: the open balance, the invoices, and what the billing mechanism actually is ------- */}
      {canBilling && view && (
        <>
          <div className="kv-card kv-billing__balance">
            <h2 className="kv-card__title">{t.t('bill.balanceTitle')}</h2>
            {(() => {
              const bs = balanceState(view!);
              return (
                <>
                  <p className="kv-card__figure">
                    {bs.kind === 'mixed'
                      ? t.t('bill.balance.mixedFigure', { currencies: bs.currencies.join(', ') })
                      : formatMoneyMinor(view!.openBalanceMinor ?? '0', view!.openBalanceCurrency || 'INR', lang)}
                  </p>
                  {/* Each state has its own sentence: "nothing owed", "N open", "at least N open (bounded
                      read)", "more than one currency — we will not add them". */}
                  <p className="kv-field__hint">{t.t(balanceKey(bs), { count: String(view!.openInvoiceCount) })}</p>
                </>
              );
            })()}

            {view.oldestOpen && (
              <div className="kv-billing__oldest">
                <p>
                  <Link href={`/billing/invoices/${encodeURIComponent(view.oldestOpen.id)}`} className="kv-btn--link">{view.oldestOpen.invoiceNo}</Link>
                  {' · '}{view.oldestOpen.description}
                  {' · '}{t.t('bill.dueOn', { date: formatDate(view.oldestOpen.dueDate, lang) })}
                </p>
                {/* "(incl. GST)" ONLY where the invoice carries the rate it was raised at. */}
                <p className="kv-field__hint">
                  {t.t(taxLineKey(view.oldestOpen.taxLine), {
                    pct: view.oldestOpen.taxBp === null ? '—' : (view.oldestOpen.taxBp / 100).toFixed(2),
                    amount: formatMoneyMinor(view.oldestOpen.taxMinor, view.oldestOpen.currencyCode, lang),
                  })}
                </p>
                {payBtn.show && payQuote?.payable ? (
                  <form action={payInvoiceAction} className="kv-inline-form">
                    <input type="hidden" name="invoiceId" value={view.oldestOpen.id} />
                    {/* NO amount field, deliberately: the server resolves it from the invoice and refuses a
                        mismatch, so there is nothing here for a client to name. */}
                    <button type="submit" className="kv-btn">
                      {t.t('bill.pay.button', { amount: formatMoneyMinor(payQuote.amountMinor, payQuote.currencyCode, lang) })}
                    </button>
                  </form>
                ) : (
                  <p className="kv-notice" role="status">{t.t(payBtn.key)}</p>
                )}
              </div>
            )}
          </div>

          <div className="kv-card">
            <h2 className="kv-card__title">{t.t('bill.ptdTitle', { year: String(view.paidToDate.year) })}</h2>
            <p className="kv-card__figure">{formatMoneyMinor(view.paidToDate.minor, view.paidToDate.currencyCode || 'INR', lang)}</p>
            {/* "all on time" is EARNED, not assumed: one invoice with no payment date makes it "partly unknown". */}
            <p className="kv-field__hint">
              {t.t(paidToDateKey(view.paidToDate), {
                count: String(view.paidToDate.invoiceCount), late: String(view.paidToDate.late), unknown: String(view.paidToDate.unknown),
              })}
            </p>
            {view.paidToDate.mixedCurrencies.length > 0 && (
              <p className="kv-field__hint">{t.t('bill.ptd.otherCurrencies', { currencies: view.paidToDate.mixedCurrencies.join(', ') })}</p>
            )}
            {/* The GSTIN as SNAPSHOTTED on the invoice — not as the profile reads today. */}
            <p className="kv-field__hint">{t.t(gstinKey(view.billTo.source), { gstin: view.billTo.gstinMasked ?? '—' })}</p>
          </div>

          <h2 className="kv-section-title">{t.t('bill.invoicesTitle')}</h2>
          <nav className="kv-tabs" aria-label={t.t('bill.invoicesTitle')}>
            {TABS.map((tb) => (
              <Link key={tb} href={`/billing?tab=${tb}`} className={`kv-tab${tb === tab ? ' kv-tab--active' : ''}`} aria-current={tb === tab ? 'page' : undefined}>
                {t.t(`bill.tab.${tb}`, { count: String(view!.tabCounts[tb] ?? 0) })}
              </Link>
            ))}
          </nav>
          <DataTable
            rows={invoices}
            empty={t.t('bill.invoicesEmpty')}
            columns={[
              { header: t.t('bill.col.no'), cell: (r) => <Link href={`/billing/invoices/${encodeURIComponent(r.id)}`} className="kv-btn--link">{r.invoiceNo}</Link> },
              { header: t.t('bill.col.status'), cell: (r) => <span className="kv-badge">{t.t(`bill.status.${r.status}`)}</span> },
              { header: t.t('bill.col.total'), cell: (r) => formatMoneyMinor(r.totalMinor, r.currencyCode, lang) },
              // Outstanding is total − RECEIVED, which is the number a tenant is actually asked for.
              { header: t.t('bill.col.outstanding'), cell: (r) => formatMoneyMinor(r.outstandingMinor, r.currencyCode, lang) },
              { header: t.t('bill.col.due'), cell: (r) => formatDate(r.dueDate, lang) },
            ]}
          />

          {/* ---------- the four sentences the canon states, and what the code can support ---------------- */}
          <div className={`kv-card${anyMechanismMissing(view.mechanism) ? ' kv-card--notice' : ''}`}>
            <h2 className="kv-card__title">{t.t('bill.mechTitle')}</h2>
            <ul className="kv-list">
              {MECHANISM_ORDER.map((k) => {
                const reason = gapReasonKey(view!.mechanism[k]);
                return (
                  <li key={k}>
                    {t.t(mechanismKey(k, view!.mechanism[k]))}
                    {reason && <span className="kv-field__hint"> {t.t(reason)}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      {canBilling && !view && <p className="kv-empty-state">{t.t('bill.consoleUnavailable')}</p>}
      {!canBilling && <p className="kv-empty" role="status">{t.t('bill.restricted')}</p>}

      <h2 className="kv-section-title">{t.t('billing.current')}</h2>
      {curFailed ? <p className="kv-error" role="alert">{t.t('billing.loadError')}</p> : sub ? (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('billing.status')}</dt><dd><span className="kv-badge">{sub.status}</span></dd></div>
          <div className="kv-facts__row"><dt>{t.t('billing.cycle')}</dt><dd>{t.t(`billing.cycle.${sub.billingCycle}`)}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('billing.price')}</dt><dd>{formatMoneyMinor(sub.priceMinor, sub.currencyCode, lang)}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('billing.periodEnd')}</dt><dd>{sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, lang) : t.t('common.dash')}</dd></div>
        </dl>
      ) : (
        <p className="kv-empty-state">{t.t('billing.noSub')}</p>
      )}

      {sub && sub.status !== 'cancelled' && (
        sub.cancelAtPeriodEnd ? (
          <p className="kv-notice" role="status">{t.t('billing.cancelPending')}</p>
        ) : (
          <form action={cancelSubscriptionAction} className="kv-inline-form">
            <input type="hidden" name="subscriptionId" value={sub.id} />
            <input type="hidden" name="atPeriodEnd" value="true" />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('billing.cancelAtPeriodEnd')}</button>
          </form>
        )
      )}

      {usageRows.length > 0 && (
        <>
          <h2 className="kv-section-title">{t.t('billing.usage')}</h2>
          <DataTable
            rows={usageRows}
            empty={t.t('billing.noUsage')}
            columns={[
              { header: t.t('billing.metric'), cell: (r) => r.key },
              { header: t.t('billing.used'), cell: (r) => r.used },
              { header: t.t('billing.limit'), cell: (r) => (r.limit ?? t.t('billing.unlimited')) },
            ]}
          />
        </>
      )}

      <h2 className="kv-section-title">{t.t('billing.plans')}</h2>
      {plansFailed ? <p className="kv-error" role="alert">{t.t('billing.loadError')}</p> : plans.length === 0 ? (
        <p className="kv-empty-state">{t.t('billing.noPlans')}</p>
      ) : (
        <div className="kv-cards">
          {/* W119 lives on its own route: the compare table, the proration preview and the confirm chain. */}
          {plans.map((p) => (
            /* **A PLAN CHANGE NO LONGER POSTS FROM THIS CARD.** It now raises a real prorated invoice (TENANT-1d-2), and
               W119 is explicit that "proration always previews before any payment" — so an existing tenant gets a LINK to
               the preview, and only the FIRST subscription (nothing to prorate against) is applied from here. */
            <form key={p.id} action={applyPlanAction} className="kv-card kv-plan">
              <h3 className="kv-card__title">{p.defaultName}</h3>
              <p className="kv-plan__price">{formatMoneyMinor(planPriceMinor(p, 'monthly'), p.currencyCode, lang)} / {t.t('billing.perMonth')}</p>
              <p className="kv-field__hint">{t.t('billing.annual')}: {formatMoneyMinor(planPriceMinor(p, 'annual'), p.currencyCode, lang)} · {t.t('billing.setup')}: {formatMoneyMinor(p.setupFeeMinor, p.currencyCode, lang)}</p>
              <input type="hidden" name="planId" value={p.id} />
              {sub && <input type="hidden" name="subscriptionId" value={sub.id} />}
              {!sub && (
                <>
                  <label htmlFor={`cycle-${p.id}`} className="kv-field__label">{t.t('billing.chooseCycle')}</label>
                  <select id={`cycle-${p.id}`} name="billingCycle" className="kv-select" defaultValue="monthly">
                    <option value="monthly">{t.t('billing.cycle.monthly')}</option>
                    <option value="annual">{t.t('billing.cycle.annual')}</option>
                  </select>
                </>
              )}
              {sub ? (
                sub.planId === p.id
                  ? <span className="kv-badge kv-badge--success">{t.t('billing.currentPlan')}</span>
                  : <a href={`/billing/upgrade?planId=${encodeURIComponent(p.id)}`} className="kv-btn">{t.t('billing.previewChange')}</a>
              ) : (
                <button type="submit" className="kv-btn">{t.t('billing.apply')}</button>
              )}
            </form>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <>
          <h2 className="kv-section-title">{t.t('billing.history')}</h2>
          <DataTable
            rows={history}
            empty={t.t('billing.noHistory')}
            columns={[
              { header: t.t('billing.status'), cell: (s) => <span className="kv-badge">{s.status}</span> },
              { header: t.t('billing.cycle'), cell: (s) => t.t(`billing.cycle.${s.billingCycle}`) },
              { header: t.t('billing.price'), cell: (s) => formatMoneyMinor(s.priceMinor, s.currencyCode, lang) },
              { header: t.t('billing.started'), cell: (s) => (s.currentPeriodStart ? formatDate(s.currentPeriodStart, lang) : t.t('common.dash')) },
            ]}
          />
        </>
      )}
    </section>
  );
}
