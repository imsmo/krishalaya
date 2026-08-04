// apps/web-tenant/src/app/billing/page.tsx · the tenant's subscription + plan catalogue + usage. Server-first,
// requireSession-gated. Loads the current subscription (+ limits/usage), the public plan catalogue, and the
// subscription history in parallel — each degrades independently (Law 12). Apply/change plan is a Server-Action
// form (idempotency-keyed). Money via formatMoneyMinor (Law 2); all copy via i18n; noindex.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { planPriceMinor, mergeUsageRows } from '../../features/billing/plan';
import { applyPlanAction, changePlanAction, cancelSubscriptionAction } from './actions';
import type { Plan, Subscription } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['plan', 'apply', 'cancel']);
const OKK = new Set(['applied', 'changed', 'cancelScheduled', 'cancelled']);

export default async function BillingPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/billing');
  const t = getTranslator();
  const lang = getLang();

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

  const okKey = searchParams.ok && OKK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const usageRows = mergeUsageRows(current.limits, current.usage);
  const sub = current.subscription;

  return (
    <section>
      <h1>{t.t('billing.title')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`billing.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`billing.error.${errorKey}`)}</p>}

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
          {plans.map((p) => (
            <form key={p.id} action={sub && sub.planId !== p.id ? changePlanAction : applyPlanAction} className="kv-card kv-plan">
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
              <button type="submit" className="kv-btn" disabled={!!sub && sub.planId === p.id}>
                {sub ? (sub.planId === p.id ? t.t('billing.currentPlan') : t.t('billing.changeTo')) : t.t('billing.apply')}
              </button>
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
