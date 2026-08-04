// apps/web-admin/src/app/plans/[id]/page.tsx · plan detail + composition + change history + admin actions. Server
// component: requireAdmin gates, fetches GET /v1/plans/:id, GET :id/history and the GET /v1/plans/features
// catalogue in parallel (404 → notFound; history/catalogue degrade independently). Lifecycle (publish/archive/
// reactivate) is surfaced only when legal (features/plans mirrors plan.state). Pricing / new-version / feature
// set+clear / limit set+clear are Server-Action forms carrying a mandatory audit reason. Plans are catalogue
// config — money is minor-unit strings (Law 2, never floated) shown via formatMoneyMinor. A 403 → re-auth notice.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { planStatusKey, canPublish, canArchive, canReactivate, type PlanDetail, type FeatureCatalogueItem, type PlanChange } from '../../../features/plans/plan';
import { lifecycleAction, setPricingAction, versionPlanAction, setFeatureAction, removeFeatureAction, setLimitAction, removeLimitAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('plans.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'publish', 'archive', 'reactivate', 'pricing', 'versioned', 'feature', 'featureRemoved', 'limit', 'limitRemoved']);
const ERR = new Set(['reason', 'price', 'limitCode', 'limitValue', 'featureCode', 'elevation', 'conflict', 'notFound', 'generic']);

export default async function PlanDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let plan: PlanDetail | undefined; let notice: string | undefined;
  try { plan = (await adminGet<PlanDetail>(`plans/${params.id}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let catalogue: FeatureCatalogueItem[] = [];
  let history: PlanChange[] = [];
  try { catalogue = (await adminGet<FeatureCatalogueItem[]>('plans/features')).data ?? []; } catch { /* degrade */ }
  try { history = (await adminGet<PlanChange[]>(`plans/${params.id}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!plan) {
    return <section><p className="kv-backlink"><Link href="/plans">{t.t('plans.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = planStatusKey(plan.status);
  const limits = Object.entries(plan.limits ?? {});

  const histCols: Column<PlanChange>[] = [
    { header: t.t('plans.histAction'), cell: (h) => h.action },
    { header: t.t('plans.histReason'), cell: (h) => h.reason },
    { header: t.t('plans.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/plans">{t.t('plans.back')}</Link></p>
      <h1>{plan.code} <span className="kv-muted">v{plan.version}</span></h1>
      {okKey && <p className="kv-success" role="status">{t.t(`plans.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`plans.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('plans.name')}</dt><dd>{plan.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.status')}</dt><dd>{t.t(`plans.state.${s}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.monthly')}</dt><dd>{formatMoneyMinor(plan.monthlyPriceMinor, plan.currency)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.annual')}</dt><dd>{formatMoneyMinor(plan.annualPriceMinor, plan.currency)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.setup')}</dt><dd>{formatMoneyMinor(plan.setupFeeMinor, plan.currency)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.public')}</dt><dd>{plan.isPublic ? t.t('plans.yes') : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('plans.country')}</dt><dd>{plan.countryCode}</dd></div>
      </dl>

      <h2>{t.t('plans.lifecycle')}</h2>
      <div className="kv-action-cards">
        {canPublish(s) && <ReasonForm id={plan.id} action="publish" verb={t.t('plans.publish')} label={t.t('plans.reason')} fn={lifecycleAction} />}
        {canArchive(s) && <ReasonForm id={plan.id} action="archive" verb={t.t('plans.archive')} label={t.t('plans.reason')} fn={lifecycleAction} danger />}
        {canReactivate(s) && <ReasonForm id={plan.id} action="reactivate" verb={t.t('plans.reactivate')} label={t.t('plans.reason')} fn={lifecycleAction} />}
      </div>

      <h2>{t.t('plans.features')}</h2>
      {plan.features.length === 0 ? <p className="kv-muted">{t.t('plans.noFeatures')}</p> : (
        <table className="kv-table">
          <thead><tr><th>{t.t('plans.featureCode')}</th><th>{t.t('plans.included')}</th><th></th></tr></thead>
          <tbody>{plan.features.map((f) => (
            <tr key={f.code}>
              <td>{f.code}</td>
              <td>{f.isIncluded ? t.t('plans.yes') : t.t('common.dash')}</td>
              <td>
                <form action={removeFeatureAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={plan!.id} /><input type="hidden" name="code" value={f.code} />
                  <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={1000} placeholder={t.t('plans.reason')} />
                  <button type="submit" className="kv-btn--link">{t.t('plans.remove')}</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('plans.setFeature')}</summary>
        <form action={setFeatureAction} className="kv-form">
          <input type="hidden" name="id" value={plan.id} />
          <label htmlFor="featCode" className="kv-field__label">{t.t('plans.featureCode')}</label>
          <select id="featCode" name="code" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('plans.choose')}</option>
            {catalogue.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.defaultName}</option>)}
          </select>
          <label htmlFor="isIncluded" className="kv-field__label">{t.t('plans.included')}</label>
          <select id="isIncluded" name="isIncluded" className="kv-input" defaultValue="true"><option value="true">{t.t('plans.yes')}</option><option value="false">{t.t('plans.no')}</option></select>
          <label htmlFor="featReason" className="kv-field__label">{t.t('plans.reason')}</label>
          <input id="featReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('plans.setFeatureSubmit')}</button>
        </form>
      </details>

      <h2>{t.t('plans.limits')}</h2>
      {limits.length === 0 ? <p className="kv-muted">{t.t('plans.noLimits')}</p> : (
        <table className="kv-table">
          <thead><tr><th>{t.t('plans.limitCode')}</th><th>{t.t('plans.limitValue')}</th><th></th></tr></thead>
          <tbody>{limits.map(([code, value]) => (
            <tr key={code}>
              <td>{code}</td>
              <td>{value === '-1' ? t.t('plans.unlimited') : value}</td>
              <td>
                <form action={removeLimitAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={plan!.id} /><input type="hidden" name="code" value={code} />
                  <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={1000} placeholder={t.t('plans.reason')} />
                  <button type="submit" className="kv-btn--link">{t.t('plans.remove')}</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('plans.setLimit')}</summary>
        <p className="kv-field__hint">{t.t('plans.setLimitHint')}</p>
        <form action={setLimitAction} className="kv-form">
          <input type="hidden" name="id" value={plan.id} />
          <label htmlFor="limitCode" className="kv-field__label">{t.t('plans.limitCode')}</label>
          <input id="limitCode" name="limitCode" className="kv-input" required placeholder="max_listings" />
          <label htmlFor="limitValue" className="kv-field__label">{t.t('plans.limitValue')}</label>
          <input id="limitValue" name="limitValue" className="kv-input" required inputMode="numeric" placeholder="500 / -1" />
          <label htmlFor="limitReason" className="kv-field__label">{t.t('plans.reason')}</label>
          <input id="limitReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('plans.setLimitSubmit')}</button>
        </form>
      </details>

      <h2>{t.t('plans.pricingHeading')}</h2>
      <div className="kv-action-cards">
        <form action={setPricingAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={plan.id} />
          <label className="kv-field__label">{t.t('plans.monthlyMinor')}</label>
          <input name="monthlyPriceMinor" className="kv-input" required inputMode="numeric" defaultValue={plan.monthlyPriceMinor} />
          <label className="kv-field__label">{t.t('plans.annualMinor')}</label>
          <input name="annualPriceMinor" className="kv-input" required inputMode="numeric" defaultValue={plan.annualPriceMinor} />
          <label className="kv-field__label">{t.t('plans.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('plans.setPricing')}</button>
        </form>
        <form action={versionPlanAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={plan.id} />
          <p className="kv-field__hint">{t.t('plans.versionHint')}</p>
          <label className="kv-field__label">{t.t('plans.monthlyMinor')}</label>
          <input name="monthlyPriceMinor" className="kv-input" required inputMode="numeric" defaultValue={plan.monthlyPriceMinor} />
          <label className="kv-field__label">{t.t('plans.annualMinor')}</label>
          <input name="annualPriceMinor" className="kv-input" required inputMode="numeric" defaultValue={plan.annualPriceMinor} />
          <label className="kv-field__label">{t.t('plans.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('plans.newVersion')}</button>
        </form>
      </div>

      <h2>{t.t('plans.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('plans.noHistory')} />
    </section>
  );
}

function ReasonForm({ id, action, verb, label, fn, danger }: { id: string; action: string; verb: string; label: string; fn: (fd: FormData) => Promise<void>; danger?: boolean }) {
  return (
    <form action={fn} className="kv-card kv-action-card">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <label className="kv-field__label">{label}</label>
      <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
      <button type="submit" className={`kv-btn${danger ? ' kv-btn--danger' : ''}`}>{verb}</button>
    </form>
  );
}
