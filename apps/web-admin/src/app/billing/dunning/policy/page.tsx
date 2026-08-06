// apps/web-admin/src/app/billing/dunning/policy/page.tsx · the COLLECTIONS LADDER (PC-56 ADMIN-1b, canon W015
// policy panel — closes ADMIN-1-Q6; tables in migration 0094). Server component: requireAdmin gates, adminGet hits
// GET /v1/billing/dunning-policy (+ /versions).
//
// WHAT THIS PAGE IS. A ladder is a promise about how the platform treats a customer who owes it money: when we first
// remind, when it becomes a phone call, and whether non-payment ever suspends them. PC-56 ADMIN-1 had to label the
// collection queue's suggested channel a "convention" because no such promise was stored anywhere. It is stored now,
// and this is where it is written.
//
// PUBLISH, NEVER EDIT. Saving creates a NEW VERSION and retires the current one; the previous ladder stays readable
// because six months from now the only defensible answer to "why was I chased on day 3?" is the ladder that was active
// then. There is deliberately no edit-in-place control anywhere on this page.
//
// SUSPENSION IS A THRESHOLD, NOT AN AUTOMATION. Leaving the field blank means the platform never suspends a tenant for
// non-payment, and that is the default. When it is set, nothing in this codebase acts on it by itself: the queue shows
// the threshold has passed and a human decides through the audited tenant-ops path. Suspending a tenant stops farmers
// transacting — that is not a side effect of a cron job reading a config row.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { POLICY_CHANNELS, type LadderStep } from '../../../../features/billing/money-controls';
import { publishDunningPolicyAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pol.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['published']);
const ERR = new Set(['pol_empty', 'pol_day', 'pol_channel', 'pol_duplicate', 'pol_template', 'pol_suspendTooEarly',
  'pol_tooMany', 'pol_suspend', 'pol_name', 'pol_effectiveFrom', 'elevation', 'notFound', 'generic']);

/** Blank rows offered beyond the current ladder, so a step can be added without JavaScript. Server-rendered forms
 *  cannot grow a table on click, and a console that needs JS to change a collections policy is a console that cannot
 *  be used from a locked-down machine. */
const SPARE_ROWS = 4;

interface PolicyView { policy: { id: string; version: number; name: string; effectiveFrom: string; suspendAfterDays: number | null; notes: string | null }; steps: LadderStep[] }
interface VersionRow { id: string; version: number; name: string; isActive: boolean; effectiveFrom: string; suspendAfterDays: number | null }

export default async function DunningPolicyPage({ searchParams }: {
  searchParams: { ok?: string; error?: string; row?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let view: PolicyView | null = null; let notice: string | undefined;
  try { view = (await adminGet<PolicyView | null>('billing/dunning-policy')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  let versions: VersionRow[] = [];
  try { versions = (await adminGet<{ items: VersionRow[] }>('billing/dunning-policy/versions')).data?.items ?? []; }
  catch { /* the version list degrades independently — it is history, not the control */ }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const badRow = /^\d{1,2}$/.test(searchParams.row ?? '') ? searchParams.row : null;
  const steps = view?.steps ?? [];
  // Pre-fill the form with the ACTIVE ladder: a new version is almost always a small change to the current one, and
  // making someone retype six rungs is how a policy ends up with a typo in it.
  const rows = [...steps, ...Array.from({ length: SPARE_ROWS }, () => null)];

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing/dunning">{t.t('pol.backToQueue')}</Link></p>
      <h1>{t.t('pol.title')}</h1>
      <p className="kv-field__hint">{t.t('pol.hint')}</p>

      {okKey && <p className="kv-success" role="status">{t.t('pol.ok.published')}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {t.t(`pol.error.${errKey}`)}
          {badRow ? ` ${t.t('pol.errorRow', { n: badRow })}` : ''}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* No active policy is a REAL state and is said plainly — an empty step table would read as a policy of
              doing nothing, which is a different (and worse) claim. */}
          {!view ? <p className="kv-notice" role="note">{t.t('pol.noneActive')}</p> : (
            <dl className="kv-facts">
              <div className="kv-facts__row"><dt>{t.t('pol.active')}</dt><dd>v{view.policy.version} · {view.policy.name}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('pol.effectiveFrom')}</dt><dd>{view.policy.effectiveFrom}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('pol.suspendAfter')}</dt><dd>
                {view.policy.suspendAfterDays === null
                  ? <span className="kv-status kv-status--ok">{t.t('pol.neverSuspend')}</span>
                  : t.t('pol.suspendDays', { n: String(view.policy.suspendAfterDays) })}
              </dd></div>
            </dl>
          )}
          {view?.policy.suspendAfterDays !== null && view && <p className="kv-notice" role="note">{t.t('pol.suspendManualNote')}</p>}

          <h2>{t.t('pol.editTitle')}</h2>
          <p className="kv-field__hint">{t.t('pol.editHint')}</p>
          <form action={publishDunningPolicyAction} className="kv-form">
            <label htmlFor="pol-name" className="kv-field__label">{t.t('pol.name')}</label>
            <input id="pol-name" name="name" className="kv-input" required minLength={3} maxLength={120}
              defaultValue={view?.policy.name ?? ''} />

            <label htmlFor="pol-from" className="kv-field__label">{t.t('pol.effectiveFrom')}</label>
            <input id="pol-from" name="effectiveFrom" className="kv-input" required type="date" />

            <label htmlFor="pol-suspend" className="kv-field__label">{t.t('pol.suspendAfter')}</label>
            <input id="pol-suspend" name="suspendAfterDays" className="kv-input" inputMode="numeric" maxLength={3}
              defaultValue={view?.policy.suspendAfterDays === null || view === null ? '' : String(view.policy.suspendAfterDays)} />
            <p className="kv-field__hint">{t.t('pol.suspendHint')}</p>

            <table className="kv-table">
              <caption>{t.t('pol.stepsCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('pol.colDay')}</th>
                  <th scope="col">{t.t('pol.colChannel')}</th>
                  <th scope="col">{t.t('pol.colTemplate')}</th>
                  <th scope="col">{t.t('pol.colEscalate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((step, i) => (
                  <tr key={`step-${i}`}>
                    <td>
                      <label className="kv-visually-hidden" htmlFor={`day-${i}`}>{t.t('pol.colDay')}</label>
                      <input id={`day-${i}`} name="dayOffset" className="kv-input" inputMode="numeric" maxLength={3}
                        defaultValue={step ? String(step.dayOffset) : ''} />
                    </td>
                    <td>
                      <label className="kv-visually-hidden" htmlFor={`ch-${i}`}>{t.t('pol.colChannel')}</label>
                      <select id={`ch-${i}`} name="channel" className="kv-input" defaultValue={step?.channel ?? ''}>
                        <option value="">{t.t('pol.chooseChannel')}</option>
                        {POLICY_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`billing.channel.${c}`)}</option>)}
                      </select>
                    </td>
                    <td>
                      <label className="kv-visually-hidden" htmlFor={`tpl-${i}`}>{t.t('pol.colTemplate')}</label>
                      <input id={`tpl-${i}`} name="templateCode" className="kv-input" maxLength={80}
                        defaultValue={step?.templateCode ?? ''} />
                    </td>
                    <td>
                      <label className="kv-visually-hidden" htmlFor={`esc-${i}`}>{t.t('pol.colEscalate')}</label>
                      {/* the checkbox VALUE is the row index, because an unticked box sends nothing and the rows must
                          still line up with the parallel dayOffset/channel arrays */}
                      <input id={`esc-${i}`} name="escalate" type="checkbox" value={String(i)}
                        defaultChecked={step?.escalate === true} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="kv-field__hint">{t.t('pol.templateHint')}</p>

            <label htmlFor="pol-notes" className="kv-field__label">{t.t('pol.notes')}</label>
            <input id="pol-notes" name="notes" className="kv-input" maxLength={2000} />

            <button type="submit" className="kv-btn">{t.t('pol.publish')}</button>
            <p className="kv-field__hint">{t.t('pol.publishNote')}</p>
          </form>

          <h2>{t.t('pol.versionsTitle')}</h2>
          {versions.length === 0 ? <p className="kv-empty">{t.t('pol.noVersions')}</p> : (
            <ul className="kv-list" role="list">
              {versions.map((v) => (
                <li key={v.id} className="kv-card">
                  <p className="kv-card__title">
                    v{v.version} · {v.name}
                    {v.isActive && <> <span className="kv-status kv-status--ok">{t.t('pol.activeBadge')}</span></>}
                  </p>
                  <p className="kv-detail__muted">
                    {t.t('pol.effectiveFrom')}: {v.effectiveFrom}
                    {' · '}{v.suspendAfterDays === null ? t.t('pol.neverSuspend') : t.t('pol.suspendDays', { n: String(v.suspendAfterDays) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="kv-field__hint">{t.t('pol.footerNote')}</p>
    </section>
  );
}
