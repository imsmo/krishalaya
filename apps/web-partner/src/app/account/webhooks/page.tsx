// apps/web-partner/src/app/account/webhooks/page.tsx · PC-56 PARTNER-1b · founder D2 — WEBHOOKS (canon W268, its own path `account/webhooks`),
// READ-ONLY. Reads `GET /v1/partner/webhooks` (the endpoints + the subscribable events) and `GET /v1/partner/webhooks/deliveries` (keyset;
// `?state=` / `?endpoint=` / `?cursor=`). `?delivery=<id>` is one delivery and its attempts (`GET …/deliveries/:id`). `?form=…` is the
// Add-endpoint chain (W3017–W3020) and `?act=…` the Activate / Rotate secret / Send test ping / Replay chain (W3021–W3023) — both DECOR.
// components/partner1/{WebhooksView,DeliveriesTable}.tsx render.
import type { Metadata } from 'next';
import { SdkError, type PartnerDeliveriesPage, type PartnerDeliveryDetail, type PartnerWebhookEndpoint } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../lib/console-flag';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { ChainNotice } from '../../../components/partner1/ChainNotice';
import { WebhooksView, type HooksState } from '../../../components/partner1/WebhooksView';
import { DeliveryDetail } from '../../../components/partner1/DeliveriesTable';
import { chainState } from '../../../features/partner1/refusals';
import { deliveriesQuery, deliveryParam } from '../../../features/partner1/webhooks';
import { PARTNER_WEBHOOK_EVENT_TYPES } from '../../../features/partner1/webhook-contract';
import { failureOf } from '../../../features/partner1/dashboard';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.hooks.title'), robots: { index: false, follow: false } };
}

export default async function WebhooksPage({ searchParams }: { searchParams?: SP }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const form = chainState('hooks_form', searchParams);
  if (form) return <ChainNotice t={t} chain="hooks_form" state={form} />;
  const act = chainState('hooks_act', searchParams);
  if (act) return <ChainNotice t={t} chain="hooks_act" state={act} />;

  const c = partnerClient();
  let endpoints: PartnerWebhookEndpoint[] = []; let events: readonly string[] = PARTNER_WEBHOOK_EVENT_TYPES; let state: HooksState = 'ok';
  try {
    const r = await c.partner.webhooks.list();
    endpoints = r.items; if (r.subscribableEvents.length) events = r.subscribableEvents;
  } catch (e) {
    const status = e instanceof SdkError ? e.status : undefined;
    state = status === 403 ? 'forbidden' : failureOf(status, status === 404 ? await partnerConsoleSwitch() : 'unknown');
  }
  const detailId = deliveryParam(searchParams);
  if (detailId && state === 'ok') {
    let d: PartnerDeliveryDetail | null = null;
    try { d = await c.partner.webhooks.delivery(detailId); } catch { d = null; }
    return <DeliveryDetail t={t} lang={lang} d={d} endpoints={endpoints} />;
  }
  const filter = deliveriesQuery(searchParams);
  let deliveries: PartnerDeliveriesPage | null = null;
  if (state === 'ok') { try { deliveries = await c.partner.webhooks.deliveries({ ...filter, state: filter.state as never, limit: 25 }); } catch { deliveries = null; } }
  return <WebhooksView t={t} lang={lang} state={state} endpoints={endpoints} events={events} deliveries={deliveries} filter={filter} mailbox={await partnersMailbox()} />;
}
