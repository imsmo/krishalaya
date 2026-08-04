// apps/web-tenant/src/app/logistics/[id]/page.tsx · one shipment's oversight detail (PC-25). Read-only facts —
// the deliver mutation (PoD OTP + photo) deliberately lives ONLY on the order detail page (single mutation home);
// this page links there. shipments.get is tenant-scoped server-side; a missing/foreign id → notFound() (IDOR guard).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import type { Shipment } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.detailTitle'), robots: { index: false, follow: false } };
}

export default async function ShipmentDetailPage({ params }: { params: { id: string } }) {
  await requireSession(`/logistics/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let s: Shipment;
  try { s = await tenantClient().shipments.get(params.id); }
  catch { notFound(); }

  const facts: Array<[string, string]> = [
    [t.t('logistics.colStatus'), t.t(`logistics.status.${s.status}`) || s.status],
    [t.t('logistics.awb'), s.awbNo ?? t.t('common.dash')],
    [t.t('logistics.colPickup'), s.scheduledPickupAt ? formatDate(s.scheduledPickupAt, lang) : t.t('common.dash')],
    [t.t('logistics.pickedUp'), s.pickedUpAt ? formatDate(s.pickedUpAt, lang) : t.t('common.dash')],
    [t.t('logistics.colDelivered'), s.deliveredAt ? formatDate(s.deliveredAt, lang) : t.t('common.dash')],
    [t.t('logistics.colOtp'), s.requiresOtp ? t.t('logistics.otpYes') : t.t('common.dash')],
    [t.t('logistics.pod'), s.podMediaId ? t.t('logistics.podYes') : t.t('common.dash')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('logistics.detailTitle')}</h1>
        <Link href="/logistics" className="kv-btn--link">← {t.t('logistics.title')}</Link>
      </div>

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      <p>
        <Link href={`/orders/${s.orderId}`} className="kv-btn">{t.t('logistics.openOrder')}</Link>
      </p>
      <p className="kv-field__hint">{t.t('logistics.deliverNote')}</p>
    </section>
  );
}
