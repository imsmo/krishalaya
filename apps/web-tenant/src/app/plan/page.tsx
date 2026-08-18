// apps/web-tenant/src/app/plan/page.tsx · W118 (Plan & usage) + W115's plan cards (PC-56 TENANT-4d-1).
// Server-first, requireSession-gated, noindex, every string via i18n. This route did not exist: the console
// had /billing (invoices) and /billing/upgrade (plan change), and nothing for the usage W118 meters.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • per meter, whether the platform ENFORCES the limit, merely COUNTS it, or CANNOT MEASURE it at all —
//     because two of W118's four meters have no counter and no plan limit anywhere, and a bar drawn at
//     "0 / 5,00,000" reads as headroom rather than as ignorance;
//   • the notice threshold ACTUALLY in force (the canon says 90%; the job shipped with 80%, and it is now a
//     tenant setting whose default is the number on the screen);
//   • that a trial carries the plan's limits — it used to carry none;
//   • the plan VERSION the tenant is price-locked to, read from the row the subscription points at;
//   • the thirteen metrics thirteen modules already gate on that no plan prices, so the gap is visible in the
//     product rather than only in a migration header.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  METER_ORDER, annualSavingMinor, barPct, hasAnnualSaving, limitLabelKey, limitsApplyKey, memberLimitOf,
  meterBadgeKey, needsAttention, noticeRuleKey, projectedMonth, projectionKey, refusalKey, showsBar, verdictKey,
} from '../../features/billing/usage';
import type { PlanUsageView, ChoosablePlanRow } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pu.title'), robots: { index: false, follow: false } };
}

export default async function PlanPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireSession('/plan');
  const t = getTranslator();
  const lang = getLang();
  const canView = tenantHasPerm('tenant.settings');
  const now = new Date();

  if (!canView) {
    return (
      <section>
        <h1>{t.t('pu.title')}</h1>
        {/* W118: "Plan & usage is visible to tenant_admin and owner; staff see feature availability only." */}
        <p className="kv-empty" role="status">{t.t('pu.restricted')}</p>
      </section>
    );
  }

  let view: PlanUsageView | null = null;
  let plans: ChoosablePlanRow[] = [];
  const [vRes, pRes] = await Promise.allSettled([
    tenantClient().tenancy.planUsage(),
    tenantClient().tenancy.choosablePlans('IN'),
  ]);
  if (vRes.status === 'fulfilled') view = vRes.value;
  if (pRes.status === 'fulfilled') plans = pRes.value;

  if (!view) {
    return (
      <section>
        <h1>{t.t('pu.title')}</h1>
        {/* Law 12: limits are enforced server-side regardless of this view. */}
        <p className="kv-error" role="alert">{t.t('pu.loadError')}</p>
      </section>
    );
  }

  return (
    <section>
      <h1>{t.t('pu.title')}</h1>
      {searchParams.error && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.error))}</p>}

      <div className="kv-card">
        <h2 className="kv-card__title">{view.planLabel ?? t.t('pu.noPlan')}</h2>
        {/* The version is READ from the row the subscription points at — "price-locked" is a fact about
            plans(code, version) and subscriptions.plan_id, not a badge. */}
        <p className="kv-field__hint">{t.t('pu.priceLocked', { version: String(view.planVersion ?? '—') })}</p>
        <p className="kv-badge">{t.t(limitsApplyKey(view.subscriptionStatus, view.limitsApply))}</p>
        <p className="kv-note">{t.t(noticeRuleKey(view.enforcementOn), { pct: String(view.thresholdPct) })}</p>
      </div>

      <h2 className="kv-section-title">{t.t('pu.metersTitle')}</h2>
      <div className="kv-cards">
        {METER_ORDER.map((code) => {
          const m = view!.meters.find((x) => x.code === code);
          if (!m) return null;
          const pct = barPct(m.verdict as never);
          const v = m.verdict as never as { used?: number; limit?: number; pct?: number };
          return (
            <div key={code} className={`kv-card kv-meter kv-meter--${m.state}${needsAttention(m.verdict as never) ? ' kv-meter--attention' : ''}`}>
              <h3 className="kv-card__title">{t.t(`pu.meter.${code}`)}</h3>
              <p className="kv-card__figure">
                {t.t(verdictKey(m.verdict as never), {
                  used: String(v.used ?? 0),
                  limit: String(v.limit ?? 0),
                  pct: String(v.pct ?? 0),
                })}
              </p>
              {/* No bar at all where nothing is measured: an empty bar would read as headroom. */}
              {showsBar(m.state) && pct !== null && (
                <div className="kv-meter__bar" role="img" aria-label={`${pct}%`}>
                  <span className="kv-meter__fill" style={{ width: `${pct}%` }} />
                </div>
              )}
              <p className="kv-badge">{t.t(meterBadgeKey(m.state))}</p>
              <p className="kv-field__hint">{t.t(`pu.meterBasis.${code}`)}</p>
              {/* stock vs flow, said plainly: it is why a member leaving lowers this number and an API call
                  last month does not. */}
              <p className="kv-field__hint">{t.t(`pu.shape.${m.shape}`)}</p>
            </div>
          );
        })}
      </div>

      <p className="kv-note">
        {t.t(projectionKey(view.projection), {
          months: String(view.projection.kind === 'reaches' ? view.projection.monthsAway : 0),
          perMonth: String(view.projection.kind === 'reaches' ? view.projection.perMonth : 0),
          month: view.projection.kind === 'reaches' ? projectedMonth(now, view.projection.monthsAway) : '',
        })}
      </p>

      {/* The gap that is not this wave's to price, surfaced where a founder will see it. */}
      {view.unpricedGatedMetrics.length > 0 && (
        <p className="kv-field__hint">{t.t('pu.unpriced', { count: String(view.unpricedGatedMetrics.length), list: view.unpricedGatedMetrics.join(', ') })}</p>
      )}

      <h2 className="kv-section-title">{t.t('pu.plansTitle')}</h2>
      {plans.length === 0 ? <p className="kv-empty" role="status">{t.t('pu.plansEmpty')}</p> : (
        <div className="kv-cards">
          {plans.map((p) => {
            const limit = memberLimitOf(p);
            return (
              <div key={`${p.code}-${p.version}`} className="kv-card kv-plan">
                <h3 className="kv-card__title">{p.name}</h3>
                <p className="kv-card__figure">{formatMoneyMinor(p.monthlyPriceMinor, p.currencyCode, lang)}</p>
                <p className="kv-field__hint">{t.t('pu.perMonth', { version: String(p.version) })}</p>
                {/* The annual saving is the difference between the two STORED prices, so a card can never
                    advertise a discount the invoice will not honour. */}
                {hasAnnualSaving(p) && (
                  <p className="kv-field__hint">{t.t('pu.annualSaving', { amount: formatMoneyMinor(annualSavingMinor(p), p.currencyCode, lang) })}</p>
                )}
                <p>{t.t(limitLabelKey(limit), { count: String(limit ?? 0) })}</p>
              </div>
            );
          })}
        </div>
      )}

      <p className="kv-pager">
        <Link href="/billing/upgrade" className="kv-btn--link">{t.t('pu.compareUpgrade')}</Link>
        {' · '}
        <Link href="/billing" className="kv-btn--link">{t.t('pu.toBilling')}</Link>
      </p>
    </section>
  );
}
