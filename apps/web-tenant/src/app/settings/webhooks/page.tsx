// apps/web-tenant/src/app/settings/webhooks/page.tsx · tenant outbound webhooks. Server-first, requireSession-gated.
// Lists the tenant's endpoints (masked — the signing secret is encrypted server-side and never returned), and a
// register form (URL + event-type multiselect, both validated server-side: only public https + allow-listed events).
// On register/rotate the API returns the signing secret ONCE; it's surfaced here in a one-time banner and never
// persisted by the app. Each section degrades independently (Law 12). All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import {
  registerWebhookAction, updateWebhookAction, rotateWebhookSecretAction, deleteWebhookAction,
} from './actions';
import type { WebhookEndpoint } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('webhooks.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['updated', 'deleted']);

export default async function WebhooksPage({ searchParams }: { searchParams: { ok?: string; error?: string; secret?: string; secretFor?: string } }) {
  await requireSession('/settings/webhooks');
  const t = getTranslator();

  let endpoints: WebhookEndpoint[] = []; let events: string[] = [];
  let endpointsFailed = false; let eventsFailed = false;
  const [eRes, evRes] = await Promise.allSettled([
    tenantClient().webhooks.list(),
    tenantClient().webhooks.events(),
  ]);
  if (eRes.status === 'fulfilled') endpoints = eRes.value; else endpointsFailed = true;
  if (evRes.status === 'fulfilled') events = evRes.value; else eventsFailed = true;

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const secret = searchParams.secret || null;

  const errText = errorKey === 'url' ? t.t('webhooks.error.url')
    : errorKey === 'events' ? t.t('webhooks.error.events')
    : errorKey ? `${t.t('webhooks.error.generic')}: ${errorKey}` : null;

  return (
    <section>
      <h1>{t.t('webhooks.title')}</h1>
      <p className="kv-muted">{t.t('webhooks.subtitle')} · <Link href="/settings">{t.t('webhooks.backToSettings')}</Link></p>

      {secret && (
        <div className="kv-callout kv-callout--warn" role="status">
          <strong>{t.t('webhooks.secretOnce')}</strong>
          <p className="kv-fine">{t.t('webhooks.secretOnceHelp')}</p>
          <code className="kv-code">{secret}</code>
        </div>
      )}
      {okKey && <p className="kv-success" role="status">{t.t(`webhooks.ok.${okKey}`)}</p>}
      {errText && <p className="kv-error" role="alert">{errText}</p>}

      {/* ---- registered endpoints ---- */}
      <h2 className="kv-section-title">{t.t('webhooks.endpoints')}</h2>
      {endpointsFailed ? <p className="kv-error" role="alert">{t.t('webhooks.loadError')}</p> : (
        <DataTable
          rows={endpoints}
          empty={t.t('webhooks.empty')}
          columns={[
            { header: t.t('webhooks.url'), cell: (w) => <code className="kv-code kv-code--inline">{w.url}</code> },
            { header: t.t('webhooks.events'), cell: (w) => w.eventTypes.length ? w.eventTypes.join(', ') : t.t('common.dash') },
            { header: t.t('webhooks.status'), cell: (w) => <span className="kv-badge">{w.isActive ? t.t('webhooks.active') : t.t('webhooks.inactive')}</span> },
            { header: '', cell: (w) => (
              <span className="kv-actions">
                <form action={updateWebhookAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="toggleActive" value="1" />
                  <input type="hidden" name="isActive" value={w.isActive ? 'false' : 'true'} />
                  <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{w.isActive ? t.t('webhooks.disable') : t.t('webhooks.enable')}</button>
                </form>
                <form action={rotateWebhookSecretAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('webhooks.rotate')}</button>
                </form>
                <form action={deleteWebhookAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('webhooks.delete')}</button>
                </form>
              </span>
            ) },
          ]}
        />
      )}

      {/* ---- register a new endpoint ---- */}
      <h2 className="kv-section-title">{t.t('webhooks.registerTitle')}</h2>
      <p className="kv-muted kv-fine">{t.t('webhooks.urlNote')}</p>
      {eventsFailed ? <p className="kv-error" role="alert">{t.t('webhooks.loadError')}</p> : (
        <form action={registerWebhookAction} className="kv-form">
          <label className="kv-label">{t.t('webhooks.url')}
            <input className="kv-input" name="url" type="url" required maxLength={500} placeholder="https://example.com/hooks/krishi" pattern="https://.*" />
          </label>
          <fieldset className="kv-fieldset">
            <legend>{t.t('webhooks.subscribe')}</legend>
            {events.length === 0 ? <p className="kv-muted">{t.t('webhooks.noEvents')}</p> : events.map((ev) => (
              <label key={ev} className="kv-check">
                <input type="checkbox" name="eventTypes" value={ev} /> <code className="kv-code kv-code--inline">{ev}</code>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="kv-btn">{t.t('webhooks.register')}</button>
        </form>
      )}
    </section>
  );
}
