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
import { diffAgainstPrevious, isRegressive, type VersionRow } from '../../../features/plans/version-diff';
import { planStatusKey, canPublish, canArchive, canReactivate, type PlanDetail, type FeatureCatalogueItem, type PlanChange } from '../../../features/plans/plan';
import { lifecycleAction, setPricingAction, versionPlanAction, setFeatureAction, removeFeatureAction, setLimitAction, removeLimitAction } from '../actions';

import { Button, Callout, EmptyState } from '@krishalaya/ui';
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

  // PC-56 ADMIN-1c (canon W011): the previous version of the SAME plan code, so the page can show what this version
  // changes. Plan versions are separate rows sharing a code, so this is a filtered list read — and it degrades
  // independently: without it the page says "no comparison available", never "nothing changed".
  let siblings: VersionRow[] = [];
  let catalogue: FeatureCatalogueItem[] = [];
  let history: PlanChange[] = [];
  try { catalogue = (await adminGet<FeatureCatalogueItem[]>('plans/features')).data ?? []; } catch { /* degrade */ }
  if (plan) {
    // the plan LIST filtered by this code gives every version of it; `previousVersion` picks the highest below this one
    try { siblings = (await adminGet<VersionRow[]>('plans', { q: plan.code, limit: 50 })).data ?? []; } catch { siblings = []; }
  }
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
                  <Button type="submit" variant="tertiary">{t.t('plans.remove')}</Button>
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
          <Button type="submit">{t.t('plans.setFeatureSubmit')}</Button>
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
                  <Button type="submit" variant="tertiary">{t.t('plans.remove')}</Button>
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
          <Button type="submit">{t.t('plans.setLimitSubmit')}</Button>
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
          <Button type="submit">{t.t('plans.setPricing')}</Button>
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
          <Button type="submit">{t.t('plans.newVersion')}</Button>
        </form>
      </div>

      {/* CHANGE SUMMARY vs the previous version (PC-56 ADMIN-1c, canon W011). A plan version is a PRICE LIST, and
          every real pricing mistake is a number that looked plausible on its own. Nothing here computes anything about
          money — it reports "was X, now Y". A percentage rise would be arithmetic on money for presentation, and the
          figure a pricing conversation needs is the actual price on the actual invoice. */}
      <h2>{t.t('plans.diffHeading')}</h2>
      {(() => {
        const diff = diffAgainstPrevious(
          { id: plan.id, code: plan.code, version: plan.version, defaultName: plan.defaultName, currency: plan.currency,
            monthlyPriceMinor: plan.monthlyPriceMinor, annualPriceMinor: plan.annualPriceMinor,
            setupFeeMinor: plan.setupFeeMinor, isPublic: plan.isPublic,
            features: plan.features?.map((f) => ({ code: f.code, isIncluded: f.isIncluded })), limits: plan.limits },
          siblings,
        );
        if (!diff.previous) {
          // "nothing to compare against" is NOT "nothing changed" — a first version must not read as a no-op
          return <EmptyState variant="empty" title={t.t('plans.diffNoPrevious')} />;
        }
        if (diff.identical) {
          return <Callout tone="warning">{t.t('plans.diffIdentical', { v: String(diff.previous.version) })}</Callout>;
        }
        return (
          <>
            <p className="kv-detail__muted">{t.t('plans.diffVs', { v: String(diff.previous.version) })}</p>
            {isRegressive(diff) && <p className="kv-error" role="alert">{t.t('plans.diffRegressive')}</p>}
            {diff.fields.length > 0 && (
              <table className="kv-table">
                <thead><tr>
                  <th scope="col">{t.t('plans.diffField')}</th>
                  <th scope="col">{t.t('plans.diffFrom')}</th>
                  <th scope="col">{t.t('plans.diffTo')}</th>
                </tr></thead>
                <tbody>
                  {diff.fields.map((f) => (
                    <tr key={f.field}>
                      <td>{t.t(`plans.field.${f.field}`)}</td>
                      <td>{f.from === null ? t.t('plans.diffAbsent') : f.field.endsWith('Minor') ? formatMoneyMinor(f.from, plan.currency) : f.from}</td>
                      <td>{f.to === null ? t.t('plans.diffAbsent') : f.field.endsWith('Minor') ? formatMoneyMinor(f.to, plan.currency) : f.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Four separate lines, because switching a feature OFF is not the same act as adding one. */}
            {diff.features.added.length > 0 && <p>{t.t('plans.diffAdded', { list: diff.features.added.join(', ') })}</p>}
            {diff.features.included.length > 0 && <p>{t.t('plans.diffIncluded', { list: diff.features.included.join(', ') })}</p>}
            {diff.features.excluded.length > 0 && <p className="kv-error">{t.t('plans.diffExcluded', { list: diff.features.excluded.join(', ') })}</p>}
            {diff.features.removed.length > 0 && <p className="kv-error">{t.t('plans.diffRemoved', { list: diff.features.removed.join(', ') })}</p>}
            {diff.limits.length > 0 && (
              <ul className="kv-list" role="list">
                {diff.limits.map((l) => (
                  <li key={l.code}>
                    <code>{l.code}</code>: {l.from ?? t.t('plans.diffAbsent')} → {l.to ?? t.t('plans.diffAbsent')}
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      })()}

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
      <Button type="submit" variant={danger ? 'danger' : 'primary'}>{verb}</Button>
    </form>
  );
}
