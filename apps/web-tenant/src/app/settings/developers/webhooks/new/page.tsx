// apps/web-tenant/src/app/settings/developers/webhooks/new/page.tsx · "Add endpoint" — the form chain W2832–W2835 · PC-56 TENANT-13a.
// Server half: the session, the catalogue (public names, payload version, the fields a v1 payload carries), the translated strings,
// and ONE Idempotency-Key for this attempt. The chain itself (AddEndpointChain) is a client component so the endpoint URL and the
// signing secret never enter a URL (see that file). States: restricted (api.manage) · Flagged off · Couldn't load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookCatalogueEntry } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { NEW_ENDPOINT_HREF, WEBHOOKS_HREF, formKeysWithRefusals, pageState } from '../../../../../features/webhooks/webhooks';
import { auditHref } from '../../../../../features/forms/chain';
import { AddEndpointChain } from './AddEndpointChain';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.form.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function NewEndpointPage() {
  await requireSession(NEW_ENDPOINT_HREF);
  const t = getTranslator();
  let catalogue: WebhookCatalogueEntry[] | null = null; let state: string | null = null;
  try { catalogue = await tenantClient().webhooks.events(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const labels = Object.fromEntries(formKeysWithRefusals().map((k) => [k, t.t(k)]));
  // the audit link (W2834 "View audit trail"): the auditor screen filters by entity; the chain appends the new endpoint's id
  const auditBase = auditHref('webhook_endpoint', 'ID').replace(/&entityId=ID$/, '');

  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint">{t.t('wh.breadcrumb.settings')} › {t.t('wh.breadcrumb.developers')} › <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.list.crumb')}</Link> › {t.t('wh.form.title')}</nav>
      <h1>{t.t('wh.form.title')}</h1>
      <p className="kv-field__hint">{t.t('wh.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`wh.state.${state}.title`)}</strong><p>{t.t(`wh.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={NEW_ENDPOINT_HREF} className="kv-btn--link">{t.t('wh.state.retry')}</Link></p>}
        </div>
      )}
      {catalogue && <AddEndpointChain catalogue={catalogue} labels={labels} idempotencyKey={randomUUID()} backHref={WEBHOOKS_HREF} auditBase={auditBase} />}
    </section>
  );
}
