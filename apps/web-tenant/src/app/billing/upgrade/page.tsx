// apps/web-tenant/src/app/billing/upgrade/page.tsx · W119 "Compare plans / Upgrade" (PC-56 TENANT-1d-2).
//
// "You are on Growth (v3, monthly). Upgrades apply immediately with to-the-day proration; downgrades apply at period end —
// no clawbacks mid-cycle."
//
// **THE PANEL THIS PAGE EXISTS FOR IS THE INVOICE PREVIEW, AND UNTIL THIS WAVE THE PLATFORM COULD NOT PRODUCE ONE.** The
// arithmetic existed (TENANT-1d) and nothing called it, so /billing's change-plan button swapped the plan and charged ₹0.
//
// Server component. Selecting a plan is a LINK (`?planId=…`), not a client-side state change: the preview is a server read,
// so the URL is the confirm step and a tenant can send it to whoever signs off.
import type { Metadata } from 'next';
import type { PlanChangePreview, PlanCompareView } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  actionLabel, breachSummary, canConfirm, directionOf, featureCell, invoiceRows, limitCell,
  offerablePlans, orderedLimitCodes, pendingNotice, showsCustomPricingNotice, taxPct,
} from '../../../features/billing/upgrade';
import { cancelPendingChangeAction, changePlanAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('upg.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['upgraded', 'scheduled', 'replayed', 'cancelled']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'conflict', 'invalid', 'unavailable', 'taxUnavailable']);

export default async function UpgradePage({ searchParams }: {
  searchParams: { planId?: string; ok?: string; error?: string };
}) {
  await requireSession('/billing/upgrade');
  const t = getTranslator();
  const lang = getLang();

  let view: PlanCompareView | null = null;
  let loadFailed = false;
  try { view = await tenantClient().tenancy.comparePlans(); }
  catch { loadFailed = true; }

  // The preview is its own read and degrades on its own: W119 has a named state for it failing, and it must not take the
  // compare table down with it ("No charge was made — proration always previews before any payment").
  const wanted = (searchParams.planId ?? '').trim();
  let preview: PlanChangePreview | null = null;
  let previewFailed = false;
  if (view?.current && wanted) {
    try { preview = await tenantClient().tenancy.planPreview(view.current.subscriptionId, wanted); }
    catch { previewFailed = true; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const pending = view ? pendingNotice(view) : null;

  return (
    <section>
      <h1>{t.t('upg.title')}</h1>
      {view?.current ? (
        <p className="kv-field__hint">
          {t.t('upg.onPlan', { plan: view.current.planName, cycle: t.t(`upg.cycle.${view.current.billingCycle}`) })}
          {' '}{t.t('upg.rule')}
        </p>
      ) : <p className="kv-field__hint">{t.t('upg.rule')}</p>}

      {okKey && <p className="kv-success" role="status">{t.t(`upg.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`upg.error.${errKey}`)}</p>}

      {loadFailed ? (
        <div className="kv-card">
          <p className="kv-error" role="alert">{t.t('upg.loadError')}</p>
          <a href="/billing/upgrade" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('upg.retry')}</a>
        </div>
      ) : !view ? null : !view.current ? (
        <div className="kv-card">
          <strong>{t.t('upg.noSub.title')}</strong>
          <p className="kv-detail__muted">{t.t('upg.noSub.body')}</p>
          <a href="/billing" className="kv-btn kv-btn--sm">{t.t('upg.noSub.cta')}</a>
        </div>
      ) : (
        <>
          {/* A change already scheduled comes FIRST — a tenant must not stack a second one without seeing the first. */}
          {pending && (
            <div className="kv-card">
              <strong>{t.t('upg.pending.title', { plan: pending.planName })}</strong>
              <p className="kv-detail__muted">
                {t.t('upg.pending.body', { d: formatDate(pending.effectiveDate, lang, { dateStyle: 'medium' }) })}
                {pending.reason ? ` · ${pending.reason}` : ''}
              </p>
              <form action={cancelPendingChangeAction}>
                <input type="hidden" name="subscriptionId" value={view.current.subscriptionId} />
                <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('upg.pending.cancel')}</button>
              </form>
            </div>
          )}

          {/* W119's "Custom plan in force" — the table is still shown, but it is not the tenant's terms. */}
          {showsCustomPricingNotice(view) && (
            <div className="kv-notice" role="note">
              <strong>{t.t('upg.custom.title')}</strong>
              <p>{t.t('upg.custom.body', { price: formatMoneyMinor(view.current.priceMinor, view.current.currencyCode, lang) })}</p>
            </div>
          )}

          <h2>{t.t('upg.compare')}</h2>
          <table className="kv-table">
            <thead>
              <tr>
                <th scope="col">{t.t('upg.capability')}</th>
                {view.plans.map((p) => (
                  <th key={p.id} scope="col">
                    {p.name}
                    <div className="kv-detail__muted">
                      {formatMoneyMinor(p.monthlyPriceMinor, p.currencyCode, lang)}{t.t('upg.perMonth')}
                    </div>
                    {p.isCurrent ? <span className="kv-badge kv-badge--success">{t.t('upg.current')}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedLimitCodes(view).map((code) => (
                <tr key={code}>
                  <th scope="row">{t.t(`upg.limit.${code}`) || code}</th>
                  {view.plans.map((p) => {
                    const cell = limitCell(p, code, t);
                    return (
                      <td key={p.id}>
                        {/* "—" for absent, never 0: a quota of zero is a different claim from "not included". */}
                        {cell.kind === 'number' ? Number(cell.text).toLocaleString(lang) : cell.text}
                        {/* The tenant's own usage sits beside their current plan's cell, which is where the question
                            "would I still fit?" is actually asked. */}
                        {p.isCurrent && view.usage[code] !== undefined ? (
                          <div className="kv-detail__muted">{t.t('upg.using', { n: Number(view.usage[code]).toLocaleString(lang) })}</div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {view.features.map((f) => (
                <tr key={f.code}>
                  <th scope="row">{f.name}</th>
                  {view.plans.map((p) => <td key={p.id}>{featureCell(p, f.code) ? '✓' : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="kv-actions">
            {offerablePlans(view).map((p) => {
              const dir = directionOf(view!, p);
              return (
                <a key={p.id} href={`/billing/upgrade?planId=${encodeURIComponent(p.id)}`}
                   className={`kv-btn kv-btn--sm${wanted === p.id ? '' : ' kv-btn--muted'}`}>
                  {t.t('upg.previewFor', { plan: p.name, action: actionLabel(dir, t) })}
                </a>
              );
            })}
          </div>

          {/* ---- the preview panel: the reason this page exists ------------------------------------------------------ */}
          {previewFailed && (
            <div className="kv-card">
              <p className="kv-error" role="alert">{t.t('upg.prorationError')}</p>
              <a href={`/billing/upgrade?planId=${encodeURIComponent(wanted)}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('upg.retry')}</a>
            </div>
          )}

          {preview && (() => {
            const rows = invoiceRows(preview);
            const confirm = canConfirm(preview);
            const breaches = breachSummary(preview.breaches);
            const upgrading = preview.lines.direction === 'upgrade';
            return (
              <div className="kv-card">
                <h2>
                  {upgrading
                    ? t.t('upg.panel.upgrade', { plan: preview.toPlan.name })
                    : t.t('upg.panel.downgrade', { plan: preview.toPlan.name, d: formatDate(preview.lines.effectiveDate, lang, { dateStyle: 'medium' }) })}
                </h2>

                {upgrading ? (
                  <>
                    <ul className="kv-account-list">
                      {rows.map((r) => (
                        <li key={r.key}>
                          {t.t(`upg.row.${r.key}`, {
                            plan: preview.toPlan.name, from: preview.fromPlan.name,
                            days: preview.lines.daysRemaining, of: preview.lines.daysInPeriod, pct: taxPct(preview),
                          })}
                          {' · '}
                          {r.negative ? '−' : ''}{formatMoneyMinor(r.minor, preview.currencyCode, lang)}
                        </li>
                      ))}
                    </ul>
                    {/* **THE TOTAL COMES FROM totalDueMinor, NEVER FROM ADDING THE ROWS ABOVE.** The rows are rounded for
                        display; adding them gives a different number from the amount due (W119's own lines sum to ₹7,954
                        against a true ₹7,955.48). */}
                    <p>
                      <strong>{t.t('upg.total')} · {formatMoneyMinor(preview.lines.totalDueMinor, preview.currencyCode, lang)}</strong>
                    </p>
                    <p className="kv-detail__muted">{t.t('upg.dueNote')}</p>
                    {preview.taxUsedDefault && <p className="kv-detail__muted">{t.t('upg.taxDefault', { pct: taxPct(preview) })}</p>}
                  </>
                ) : (
                  <p className="kv-detail__muted">
                    {t.t('upg.downgradeNote', { d: formatDate(preview.lines.effectiveDate, lang, { dateStyle: 'medium' }) })}
                  </p>
                )}

                {/* The heads-up warns; it never blocks. Existing members are never removed to enforce a price. */}
                {breaches.any && (
                  <div className="kv-notice" role="note">
                    <strong>{t.t('upg.breach.title')}</strong>
                    <ul>
                      {preview.breaches.map((b) => (
                        <li key={b.limitCode}>
                          {t.t('upg.breach.row', {
                            what: t.t(`upg.limit.${b.limitCode}`) || b.limitCode,
                            have: Number(b.currentUsage).toLocaleString(lang),
                            cap: Number(b.limitValue).toLocaleString(lang),
                          })}
                        </li>
                      ))}
                    </ul>
                    <p>{t.t('upg.breach.note')}</p>
                  </div>
                )}

                {confirm.ok ? (
                  <form action={changePlanAction} className="kv-form">
                    <input type="hidden" name="subscriptionId" value={view.current.subscriptionId} />
                    <input type="hidden" name="planId" value={preview.toPlan.id} />
                    <label htmlFor="upg-reason" className="kv-form__label">{t.t('upg.reason')}</label>
                    <input id="upg-reason" name="reason" className="kv-field__input" maxLength={300}
                           placeholder={t.t('upg.reasonHint')} />
                    <button type="submit" className="kv-btn">
                      {upgrading ? t.t('upg.action.upgrade') : t.t('upg.action.schedule')}
                    </button>
                    <p className="kv-detail__muted">{t.t('upg.recorded')}</p>
                  </form>
                ) : (
                  // Refused BEFORE the click, with the reason, rather than after it with a 503.
                  <p className="kv-error" role="alert">{t.t(`upg.blocked.${confirm.reason}`)}</p>
                )}
              </div>
            );
          })()}

          <p className="kv-field__hint kv-note">{t.t('upg.footerNote')}</p>
        </>
      )}
    </section>
  );
}
