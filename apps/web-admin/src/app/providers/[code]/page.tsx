// apps/web-admin/src/app/providers/[code]/page.tsx · integration-provider detail + credential-ref health + change
// history + the one consequential write. Server component: requireAdmin gates, fetches GET /v1/providers/:code
// (404 → notFound) and GET :code/history (degrades independently). The enable/disable toggle (Law 12 — pull a
// failing provider out of rotation PLATFORM-WIDE) is surfaced only when it is a real change (admin-api rejects a
// no-op → 409) and carries a mandatory audit reason; admin-api re-authorises with providers.manage + FIDO2 +
// step-up, so a 403 degrades to a re-auth notice. Counts only — no secret material. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { categoryKey, providerHealthKey, isDegraded, canEnable, canDisable, type ProviderDetail, type ProviderChange } from '../../../features/providers/provider';
import { toggleProviderAction } from '../actions';
import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('providers.detailTitle'), robots: { index: false, follow: false } };
}

const HEALTH_TONE: Record<string, StatusTone> = { active: 'success', degraded: 'danger', disabled: 'neutral' };
const OK = new Set(['enable', 'disable']);
const ERR = new Set(['action', 'reason', 'elevation', 'conflict', 'notFound', 'generic']);

export default async function ProviderDetailPage({ params, searchParams }: { params: { code: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let provider: ProviderDetail | undefined; let notice: string | undefined;
  try { provider = (await adminGet<ProviderDetail>(`providers/${encodeURIComponent(params.code)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: ProviderChange[] = [];
  try { history = (await adminGet<ProviderChange[]>(`providers/${encodeURIComponent(params.code)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!provider) {
    return <section><p className="kv-backlink"><Link href="/providers">{t.t('providers.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const healthKey = providerHealthKey(provider);

  const histCols: Column<ProviderChange>[] = [
    { header: t.t('providers.histAction'), cell: (h) => t.t(`providers.histVerb.${h.action}`) },
    { header: t.t('providers.histReason'), cell: (h) => h.reason },
    { header: t.t('providers.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/providers">{t.t('providers.back')}</Link></p>
      <h1>{provider.code}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`providers.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`providers.error.${errKey}`)}</p>}
      {isDegraded(provider) && <p className="kv-error" role="alert">{t.t('providers.degradedNote')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('providers.name')}</dt><dd>{provider.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('providers.category')}</dt><dd>{t.t(`providers.cat.${categoryKey(provider.category)}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('providers.health')}</dt><dd><StatusPill tone={HEALTH_TONE[healthKey]} label={t.t(`providers.healthState.${healthKey}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('providers.configuredTenants')}</dt><dd>{provider.health.configuredTenants.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('providers.activeTenants')}</dt><dd>{provider.health.activeTenants.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('providers.createdAt')}</dt><dd>{provider.createdAt ?? t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('providers.toggleHeading')}</h2>
      <p className="kv-field__hint">{t.t('providers.toggleNote')}</p>
      <div className="kv-action-cards">
        {canEnable(provider.isActive) && <ToggleForm code={provider.code} action="enable" verb={t.t('providers.enable')} label={t.t('providers.reason')} />}
        {canDisable(provider.isActive) && <ToggleForm code={provider.code} action="disable" verb={t.t('providers.disable')} label={t.t('providers.reason')} danger />}
      </div>

      <h2>{t.t('providers.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('providers.noHistory')} />
    </section>
  );
}

function ToggleForm({ code, action, verb, label, danger }: { code: string; action: string; verb: string; label: string; danger?: boolean }) {
  return (
    <form action={toggleProviderAction} className="kv-card kv-action-card">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="action" value={action} />
      <label className="kv-field__label">{label}</label>
      <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
      <Button type="submit" variant={danger ? 'danger' : 'primary'}>{verb}</Button>
    </form>
  );
}
