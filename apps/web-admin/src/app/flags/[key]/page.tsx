// apps/web-admin/src/app/flags/[key]/page.tsx · god-mode feature-flag detail + change history. Server component:
// requireAdmin gates, fetches GET /v1/flags/:key + GET /v1/flags/:key/history in parallel (each degrades). Actions
// are surfaced ONLY when legal for the lock/enabled state (features/flags mirrors flag.entity Law 10): a kill-
// switch-LOCKED flag offers only unlock; enable/rollout/targeting are refused until unlocked; kill is the emergency
// disable+lock. Every action is a Server-Action form carrying a mandatory audit reason. A 403 → re-auth, a 409
// (locked) → message. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { flagState, canEnable, canDisable, canSetRollout, canSetTargeting, canKill, canUnlock, type FlagRow, type FlagChange } from '../../../features/flags/flag';
import { enableFlagAction, disableFlagAction, killFlagAction, unlockFlagAction, setRolloutAction, setTargetingAction } from '../actions';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('flags.detailTitle'), robots: { index: false, follow: false } };
}

const STATE_TONE: Record<string, StatusTone> = { on: 'success', off: 'neutral', locked: 'danger' };
const OK = new Set(['created', 'enable', 'disable', 'kill', 'unlock', 'rollout', 'targeting']);
const ERR = new Set(['reason', 'rolloutPct', 'tenantIds', 'plans', 'countries', 'elevation', 'locked', 'notFound', 'generic']);

export default async function FlagDetailPage({ params, searchParams }: { params: { key: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const key = decodeURIComponent(params.key);

  let flag: FlagRow | undefined;
  let notice: string | undefined;
  try { flag = (await adminGet<FlagRow>(`flags/${encodeURIComponent(key)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: FlagChange[] = [];
  try { history = (await adminGet<FlagChange[]>(`flags/${encodeURIComponent(key)}/history`, { limit: 50 })).data ?? []; }
  catch { /* history degrades to empty independently */ }

  if (!flag) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/flags">{t.t('flags.back')}</Link></p>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = flagState(flag);
  const rules = flag.rules ?? {};
  const targetingSummary = [
    rules.tenant_ids?.length ? `${rules.tenant_ids.length} ${t.t('flags.tenants')}` : null,
    rules.plans?.length ? rules.plans.join(', ') : null,
    rules.countries?.length ? rules.countries.join(', ') : null,
  ].filter(Boolean).join(' · ') || t.t('flags.noTargeting');

  const historyCols: Column<FlagChange>[] = [
    { header: t.t('flags.histAction'), cell: (h) => h.action },
    { header: t.t('flags.histReason'), cell: (h) => h.reason },
    { header: t.t('flags.histWhen'), cell: (h) => h.createdAt },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/flags">{t.t('flags.back')}</Link></p>
      <h1>{flag.key}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`flags.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`flags.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('flags.colState')}</dt><dd><StatusPill tone={STATE_TONE[s]} label={t.t(`flags.state.${s}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('flags.colRollout')}</dt><dd>{flag.rolloutPct}%</dd></div>
        <div className="kv-facts__row"><dt>{t.t('flags.targeting')}</dt><dd>{targetingSummary}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('flags.fieldDescription')}</dt><dd>{flag.description || t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('flags.actions')}</h2>
      <p className="kv-muted kv-note">{t.t('flags.actionsNote')}</p>
      <div className="kv-action-cards">
        {canEnable(flag) && <ReasonForm id={key} action={enableFlagAction} verb={t.t('flags.enable')} reasonLabel={t.t('flags.reason')} />}
        {canDisable(flag) && <ReasonForm id={key} action={disableFlagAction} verb={t.t('flags.disable')} reasonLabel={t.t('flags.reason')} />}
        {canKill(flag) && <ReasonForm id={key} action={killFlagAction} verb={t.t('flags.kill')} reasonLabel={t.t('flags.reason')} danger />}
        {canUnlock(flag) && <ReasonForm id={key} action={unlockFlagAction} verb={t.t('flags.unlock')} reasonLabel={t.t('flags.reason')} />}
      </div>

      {canSetRollout(flag) && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('flags.setRollout')}</summary>
          <form action={setRolloutAction} className="kv-form">
            <input type="hidden" name="key" value={key} />
            <label htmlFor="pct" className="kv-field__label">{t.t('flags.fieldRollout')}</label>
            <input id="pct" name="rolloutPct" className="kv-input" inputMode="numeric" required defaultValue={String(flag.rolloutPct)} />
            <label htmlFor="rolloutReason" className="kv-field__label">{t.t('flags.reason')}</label>
            <input id="rolloutReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('flags.setRolloutSubmit')}</Button>
          </form>
        </details>
      )}

      {canSetTargeting(flag) && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('flags.setTargeting')}</summary>
          <p className="kv-field__hint">{t.t('flags.targetingHint')}</p>
          <form action={setTargetingAction} className="kv-form">
            <input type="hidden" name="key" value={key} />
            <label htmlFor="tenantIds" className="kv-field__label">{t.t('flags.fieldTenants')}</label>
            <input id="tenantIds" name="tenantIds" className="kv-input" placeholder="uuid, uuid" />
            <label htmlFor="plans" className="kv-field__label">{t.t('flags.fieldPlans')}</label>
            <input id="plans" name="plans" className="kv-input" placeholder="pro, basic" />
            <label htmlFor="countries" className="kv-field__label">{t.t('flags.fieldCountries')}</label>
            <input id="countries" name="countries" className="kv-input" placeholder="IN, US" />
            <label htmlFor="targetReason" className="kv-field__label">{t.t('flags.reason')}</label>
            <input id="targetReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('flags.setTargetingSubmit')}</Button>
          </form>
        </details>
      )}

      <h2>{t.t('flags.historyHeading')}</h2>
      <DataTable columns={historyCols} rows={history} empty={t.t('flags.historyEmpty')} />
    </section>
  );
}

function ReasonForm({ id, action, verb, reasonLabel, danger }: {
  id: string; action: (fd: FormData) => Promise<void>; verb: string; reasonLabel: string; danger?: boolean;
}) {
  return (
    <form action={action} className="kv-card kv-action-card">
      <input type="hidden" name="key" value={id} />
      <label className="kv-field__label">{reasonLabel}</label>
      <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
      <Button type="submit" variant={danger ? 'danger' : 'primary'}>{verb}</Button>
    </form>
  );
}
