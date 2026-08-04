// apps/web-admin/src/app/tenants/[id]/page.tsx · god-mode tenant scorecard + lifecycle. Server component:
// requireAdmin gates, adminGet hits GET /v1/tenants/:id (404 → notFound() = no cross-realm enumeration signal).
// Lifecycle actions (approve/suspend/archive) are surfaced ONLY when legal for the current status (features/tenants
// mirrors the server state machine); each is a Server-Action form carrying a mandatory audit reason. Quota limits
// are edited via PATCH :id/limits. Mutations are consequential → admin-api requires FIDO2 + step-up; a 403 degrades
// to a re-auth notice. Money via formatMoneyMinor (bigint minor-unit string — never a float). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { canApprove, canSuspend, canArchive, statusKey, type TenantScorecard } from '../../../features/tenants/tenant';
import { approveTenantAction, suspendTenantAction, archiveTenantAction, overrideLimitAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tenants.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['approve', 'suspend', 'archive', 'limits']);
const ERR = new Set(['elevation', 'illegal', 'notFound', 'reason', 'limitCode', 'limitValue', 'expiresAt', 'generic']);

export default async function TenantDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let card: TenantScorecard | undefined;
  let notice: string | undefined;
  try {
    const res = await adminGet<TenantScorecard>(`tenants/${params.id}`);
    card = res.data;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!card) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/tenants">{t.t('tenants.back')}</Link></p>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = statusKey(card.tenant.status);
  const sub = card.subscription;

  return (
    <section>
      <p className="kv-backlink"><Link href="/tenants">{t.t('tenants.back')}</Link></p>
      <h1>{card.tenant.slug}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`tenants.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`tenants.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('tenants.colStatus')}</dt><dd><span className="kv-status">{t.t(`tenants.status.${s}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('tenants.colRisk')}</dt><dd>{card.tenant.riskScore}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('tenants.subscription')}</dt><dd>{sub ? `${sub.planId} · ${sub.status} · ${formatMoneyMinor(sub.priceMinor, sub.currency)}` : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('tenants.liveListings')}</dt><dd>{card.liveListings.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('tenants.openDisputes')}</dt><dd>{card.openDisputes.toLocaleString()}</dd></div>
      </dl>

      <h2>{t.t('tenants.actions')}</h2>
      <p className="kv-muted kv-note">{t.t('tenants.actionsNote')}</p>
      <div className="kv-action-cards">
        {canApprove(s) && <LifecycleForm id={params.id} action={approveTenantAction} verb={t.t('tenants.approve')} reasonLabel={t.t('tenants.reason')} />}
        {canSuspend(s) && <LifecycleForm id={params.id} action={suspendTenantAction} verb={t.t('tenants.suspend')} reasonLabel={t.t('tenants.reason')} danger />}
        {canArchive(s) && <LifecycleForm id={params.id} action={archiveTenantAction} verb={t.t('tenants.archive')} reasonLabel={t.t('tenants.reason')} danger />}
        {!canApprove(s) && !canSuspend(s) && !canArchive(s) && <p className="kv-muted">{t.t('tenants.noActions')}</p>}
      </div>

      <h2>{t.t('tenants.limitsHeading')}</h2>
      {card.limitOverrides.length === 0
        ? <p className="kv-muted">{t.t('tenants.limitsEmpty')}</p>
        : (
          <table className="kv-table">
            <thead><tr><th>{t.t('tenants.limitCode')}</th><th>{t.t('tenants.limitValue')}</th><th>{t.t('tenants.limitExpires')}</th></tr></thead>
            <tbody>{card.limitOverrides.map((o) => (
              <tr key={o.limitCode}><td>{o.limitCode}</td><td>{o.limitValue === '-1' ? t.t('tenants.unlimited') : o.limitValue}</td><td>{o.expiresAt ?? t.t('common.dash')}</td></tr>
            ))}</tbody>
          </table>
        )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('tenants.editLimit')}</summary>
        <p className="kv-field__hint">{t.t('tenants.editLimitHint')}</p>
        <form action={overrideLimitAction} className="kv-form">
          <input type="hidden" name="id" value={params.id} />
          <label htmlFor="limitCode" className="kv-field__label">{t.t('tenants.limitCode')}</label>
          <input id="limitCode" name="limitCode" className="kv-input" required placeholder="max_listings" />
          <label htmlFor="limitValue" className="kv-field__label">{t.t('tenants.limitValue')}</label>
          <input id="limitValue" name="limitValue" className="kv-input" required inputMode="numeric" placeholder="500 / -1" />
          <label htmlFor="limitExpires" className="kv-field__label">{t.t('tenants.limitExpires')}</label>
          <input id="limitExpires" name="expiresAt" type="datetime-local" className="kv-input" />
          <label htmlFor="limitReason" className="kv-field__label">{t.t('tenants.reason')}</label>
          <input id="limitReason" name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <button type="submit" className="kv-btn">{t.t('tenants.saveLimit')}</button>
        </form>
      </details>
    </section>
  );
}

function LifecycleForm({ id, action, verb, reasonLabel, danger }: {
  id: string; action: (fd: FormData) => Promise<void>; verb: string; reasonLabel: string; danger?: boolean;
}) {
  return (
    <form action={action} className="kv-card kv-action-card">
      <input type="hidden" name="id" value={id} />
      <label className="kv-field__label">{reasonLabel}</label>
      <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
      <button type="submit" className={`kv-btn${danger ? ' kv-btn--danger' : ''}`}>{verb}</button>
    </form>
  );
}
