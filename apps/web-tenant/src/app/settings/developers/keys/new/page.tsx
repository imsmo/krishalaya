// apps/web-tenant/src/app/settings/developers/keys/new/page.tsx · "Create key" — the form chain W2488–W2491 · PC-56 TENANT-13c.
// Server half: the session, the scope catalogue and the issuing contract (as the API built them), the translated strings, ONE
// Idempotency-Key for this attempt. The chain itself (CreateKeyChain) is a client component so the key never enters a URL.
// States: Locked (no api_access — the chain is not offered) · restricted (api.manage) · Flagged off · Couldn't load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ApiKeyList } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { auditHref } from '../../../../../features/forms/chain';
import { DEVELOPERS_HREF, NEW_KEY_HREF, formKeysWithRefusals, pageState } from '../../../../../features/api-keys/api-keys';
import { CreateKeyChain } from './CreateKeyChain';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ak.form.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function NewKeyPage() {
  await requireSession(NEW_KEY_HREF);
  const t = getTranslator();
  let data: ApiKeyList | null = null; let state: string | null = null;
  try { data = await tenantClient().apiKeys.list({ limit: 1 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const labels = Object.fromEntries(formKeysWithRefusals().map((k) => [k, t.t(k)]));
  const auditBase = auditHref('api_key', 'ID').replace(/&entityId=ID$/, '');

  return (
    <section>
      <nav aria-label={t.t('ak.breadcrumb.label')} className="kv-field__hint">{t.t('ak.breadcrumb.settings')} › {t.t('ak.breadcrumb.developers')} › <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.list.crumb')}</Link> › {t.t('ak.form.title')}</nav>
      <h1>{t.t('ak.form.title')}</h1>
      <p className="kv-field__hint">{t.t('ak.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`ak.state.${state}.title`)}</strong><p>{t.t(`ak.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={NEW_KEY_HREF} className="kv-btn--link">{t.t('ak.state.retry')}</Link></p>}
        </div>
      )}
      {data && !data.access.enabled && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t('ak.state.locked.title')}</strong>
          <p>{t.t('ak.state.locked.body', { plan: data.access.planCode ?? t.t('ak.state.locked.noPlan') })}</p>
          <p><Link href="/billing/upgrade" className="kv-btn--link">{t.t('ak.state.locked.upgrade')}</Link></p>
        </div>
      )}
      {data && data.access.enabled && (
        <CreateKeyChain catalogue={data.catalogue} rate={data.contract.rate} labels={labels} idempotencyKey={randomUUID()} backHref={DEVELOPERS_HREF}
          auditBase={auditBase} proposalBase={`${DEVELOPERS_HREF}/keys/proposals`} />
      )}
    </section>
  );
}
