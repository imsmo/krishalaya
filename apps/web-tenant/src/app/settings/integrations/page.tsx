// apps/web-tenant/src/app/settings/integrations/page.tsx · the tenant's third-party integrations. Server-first,
// requireSession-gated. Lists the provider catalogue + the tenant's connected integrations (masked — the credential
// is vaulted server-side and never returned). Connect/disconnect are Server Actions → the audited, RBAC-gated API.
// The credential field is a password input and is never echoed back. All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { connectIntegrationAction, disconnectIntegrationAction } from './actions';
import type { IntegrationProvider, TenantIntegration } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('integrations.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['connected', 'disconnected']);

export default async function IntegrationsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/settings/integrations');
  const t = getTranslator();

  let providers: IntegrationProvider[] = []; let mine: TenantIntegration[] = [];
  let providersFailed = false; let mineFailed = false;
  const [pRes, mRes] = await Promise.allSettled([
    tenantClient().integrations.providers(),
    tenantClient().integrations.list(),
  ]);
  if (pRes.status === 'fulfilled') providers = pRes.value; else providersFailed = true;
  if (mRes.status === 'fulfilled') mine = mRes.value; else mineFailed = true;

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;

  return (
    <section>
      <h1>{t.t('integrations.title')}</h1>
      <p className="kv-muted">{t.t('integrations.subtitle')} · <Link href="/settings">{t.t('integrations.backToSettings')}</Link></p>
      {okKey && <p className="kv-success" role="status">{t.t(`integrations.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{errorKey === 'provider' ? t.t('integrations.error.provider') : errorKey === 'credential' ? t.t('integrations.error.credential') : `${t.t('integrations.error.generic')}: ${errorKey}`}</p>}

      <h2 className="kv-section-title">{t.t('integrations.connected')}</h2>
      {mineFailed ? <p className="kv-error" role="alert">{t.t('integrations.loadError')}</p> : (
        <DataTable
          rows={mine}
          empty={t.t('integrations.empty')}
          columns={[
            { header: t.t('integrations.provider'), cell: (i) => i.providerName ?? i.providerCode },
            { header: t.t('integrations.category'), cell: (i) => i.category ?? t.t('common.dash') },
            { header: t.t('integrations.status'), cell: (i) => i.connected ? <span className="kv-badge">{t.t('integrations.active')}</span> : <span className="kv-badge">{t.t('integrations.inactive')}</span> },
            { header: '', cell: (i) => i.connected ? (
              <form action={disconnectIntegrationAction}><input type="hidden" name="providerCode" value={i.providerCode} /><button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('integrations.disconnect')}</button></form>
            ) : <span className="kv-muted">{t.t('common.dash')}</span> },
          ]}
        />
      )}

      <h2 className="kv-section-title">{t.t('integrations.connectTitle')}</h2>
      <p className="kv-muted kv-fine">{t.t('integrations.credentialNote')}</p>
      {providersFailed ? <p className="kv-error" role="alert">{t.t('integrations.loadError')}</p> : (
        <form action={connectIntegrationAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('integrations.provider')}
            <select className="kv-input" name="providerCode" required defaultValue="">
              <option value="" disabled>{t.t('integrations.providerPlaceholder')}</option>
              {providers.map((p) => <option key={p.code} value={p.code}>{p.defaultName} ({p.category})</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('integrations.credential')}
            <input className="kv-input" name="credential" type="password" autoComplete="off" required maxLength={8000} />
          </label>
          <label className="kv-check">
            <input type="checkbox" name="sandbox" /> {t.t('integrations.sandbox')}
          </label>
          <button type="submit" className="kv-btn">{t.t('integrations.connect')}</button>
        </form>
      )}
    </section>
  );
}
