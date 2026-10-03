// apps/web-tenant/src/app/settings/integrations/connect/page.tsx · "Connect provider" / "Rotate" — the form chain W2643–W2646 · PC-56 TENANT-13c.
// Server half: the session, the provider catalogue (ownable ones offered; platform-managed ones listed as refused), the translated
// strings, ONE Idempotency-Key. The chain itself (ConnectChain) is a client component so the credential never enters a URL. The
// query string carries only a provider CODE and the kind (connect / rotate) — never a value.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { IntegrationProvider } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { CONNECT_HREF, INTEGRATIONS_HREF, formKeysWithRefusals, isProviderCode, pageState } from '../../../../features/integrations/integrations';
import { ConnectChain } from './ConnectChain';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('int.form.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ConnectProviderPage({ searchParams }: { searchParams: { provider?: string; kind?: string } }) {
  await requireSession(CONNECT_HREF);
  const t = getTranslator();
  let providers: IntegrationProvider[] | null = null; let state: string | null = null;
  try { providers = await tenantClient().integrations.providers(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const labels = Object.fromEntries(formKeysWithRefusals().map((k) => [k, t.t(k)]));
  const kind = searchParams.kind === 'rotate' ? 'rotate' : 'connect';
  const managed = (providers ?? []).filter((p) => p.managed);

  return (
    <section>
      <nav aria-label={t.t('int.breadcrumb.label')} className="kv-field__hint">{t.t('int.breadcrumb.settings')} › <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.list.crumb')}</Link> › {t.t('int.form.title')}</nav>
      <h1>{t.t(kind === 'rotate' ? 'int.form.titleRotate' : 'int.form.title')}</h1>
      <p className="kv-field__hint">{t.t('int.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`int.state.${state}.title`)}</strong><p>{t.t(`int.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={CONNECT_HREF} className="kv-btn--link">{t.t('int.state.retry')}</Link></p>}
        </div>
      )}
      {providers && (
        <ConnectChain providers={providers} initialProvider={isProviderCode(searchParams.provider) ? searchParams.provider : ''} initialKind={kind}
          labels={labels} idempotencyKey={randomUUID()} backHref={INTEGRATIONS_HREF} proposalBase={`${INTEGRATIONS_HREF}/proposals`} />
      )}
      {managed.length > 0 && (
        <p className="kv-field__hint">{t.t('int.form.managedRefused', { list: managed.map((p) => p.code).join(', ') })}</p>
      )}
    </section>
  );
}
