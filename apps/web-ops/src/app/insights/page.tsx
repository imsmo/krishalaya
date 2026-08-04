// apps/web-ops/src/app/insights/page.tsx · field-operations insights (PC-36 OW-6). Two honest layers:
//   1. Tenant analytics (tenancy/analytics — GMV/orders/disputes over the last 30 days, server-computed).
//      Needs ManageTenant; an ops member without it sees a clear permission note, never a fake zero.
//   2. Operational snapshot — status breakdowns computed from the LATEST 50 rows of each register the console
//      already reads (bounded, one call per area; labeled as exactly that). True totals need server read-models
//      (PC-54); we do not fan out pages to fake them.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { countByStatus } from '../../features/insights/summarise';
import { SdkError } from '@krishalaya/sdk-js';
import type { TenantAnalytics } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ins.title'), robots: { index: false, follow: false } };
}

export default async function InsightsPage() {
  await requireSession('/insights');
  const t = getTranslator();
  const lang = getLang();
  const client = opsClient();

  let analytics: TenantAnalytics | null = null; let analyticsDenied = false; let analyticsFailed = false;
  try { analytics = await client.tenancy.analytics(); }
  catch (e) {
    if (e instanceof SdkError && (e.status === 403 || e.status === 401)) analyticsDenied = true;
    else analyticsFailed = true;
  }

  const [bookings, rentals, bills] = await Promise.all([
    client.warehousing.bookings({ limit: 50 }).then((p) => p.items).catch(() => null),
    client.equipment.rentals({ limit: 50 }).then((p) => p.items).catch(() => null),
    client.dairy.listBills({ box: 'all', limit: 50 }).then((p) => p.items).catch(() => null),
  ]);

  const money = (m: string) => formatMoneyMinor(m, analytics?.currencyCode ?? 'INR', lang);
  const areas: Array<{ key: string; rows: Array<{ status: string }> | null }> = [
    { key: 'warehouse', rows: bookings },
    { key: 'rentals', rows: rentals },
    { key: 'bills', rows: bills },
  ];

  return (
    <section>
      <h1>{t.t('ins.title')}</h1>
      <p className="kv-field__hint">{t.t('ins.hint')}</p>

      <h2>{t.t('ins.analytics')}</h2>
      {analyticsDenied ? (
        <p className="kv-field__hint kv-note">{t.t('ins.denied')}</p>
      ) : analyticsFailed || !analytics ? (
        <p className="kv-error" role="alert">{t.t('ins.loadError')}</p>
      ) : (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('ins.gmv')}</dt><dd><strong>{money(analytics.gmvMinor)}</strong></dd></div>
          <div className="kv-facts__row"><dt>{t.t('ins.orders')}</dt><dd>{analytics.orders}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('ins.activeListings')}</dt><dd>{analytics.activeListings}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('ins.disputesOpen')}</dt><dd>{analytics.disputesOpen}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('ins.payoutsPaid')}</dt><dd>{money(analytics.payoutsPaidMinor)}</dd></div>
        </dl>
      )}
      {analytics && <p className="kv-field__hint">{t.t('ins.window')}</p>}

      <h2>{t.t('ins.snapshot')}</h2>
      <p className="kv-field__hint">{t.t('ins.snapshotHint')}</p>
      {areas.map((a) => (
        <div key={a.key} className="kv-card">
          <h3 className="kv-card__title">{t.t(`ins.area.${a.key}`)}</h3>
          {a.rows === null ? (
            <p className="kv-muted">{t.t('ins.areaUnavailable')}</p>
          ) : a.rows.length === 0 ? (
            <p className="kv-muted">{t.t('ins.areaEmpty')}</p>
          ) : (
            <ul className="kv-thread">
              {countByStatus(a.rows).map(({ status, count }) => (
                <li key={status} className="kv-thread__item">
                  <span className="kv-badge">{status}</span> <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="kv-field__hint kv-note">{t.t('ins.readModelNote')}</p>
    </section>
  );
}
