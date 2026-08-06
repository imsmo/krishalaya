// apps/web-ops/src/app/devices/page.tsx · OW-7 sensor fleet + breach feed (PC-55 B4, on W54-12).
// TWO SECTIONS, ONE HONEST FRAME.
//
// THE FLEET IS NOT AN INVENTORY. `GET cold-chain/devices` derives the list from LEDGERED READINGS in the last 30
// days: a sensor that never reported does not appear, because the platform has no evidence it exists. The heading
// therefore says "sensors we have heard from" — a count that reads as an equipment register would be a lie that
// hides exactly the device somebody forgot to install.
//
// AND THE WORST TRUTH WINS. A sensor that has gone quiet is shown as SILENT even when its last readings were
// breaching, because a silent sensor means we no longer know what the cargo is doing, and that ignorance is the more
// dangerous of the two. The silence threshold shown here is the API's own device_silent default (12h), named on the
// page so nobody mistakes it for a rule that is actually firing — rules live on /devices/rules.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { deviceHealth, fleetSummary, hoursSince, type DeviceRow } from '../../features/devices/alerting';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('iot.title'), robots: { index: false, follow: false } };
}

const SILENT_AFTER_HOURS = 12;   // the API's own device_silent default — displayed, never silently assumed
const BREACH_WINDOWS = [6, 24, 72, 168] as const;

type BreachRow = { subjectType?: string; subjectId?: string; deviceRef?: string | null; tempC?: string | null; humidityPct?: string | null; recordedAt?: string };

export default async function DevicesPage({ searchParams }: { searchParams: { hours?: string } }) {
  await requireSession('/devices');
  const t = getTranslator();
  const lang = getLang();
  const now = Date.now();

  const hours = BREACH_WINDOWS.includes(Number(searchParams.hours) as (typeof BREACH_WINDOWS)[number])
    ? Number(searchParams.hours) : 24;

  const client = opsClient();
  let devices: DeviceRow[] = []; let devicesFailed = false; let forbidden = false;
  try { devices = (await client.shipments.coldChainDevices()) as DeviceRow[]; }
  catch (e) { forbidden = (e as { status?: number }).status === 403; devicesFailed = !forbidden; }

  // Each section degrades on its own: a failed breach feed must not blank the fleet an operator is checking.
  let breaches: BreachRow[] = []; let breachesFailed = false;
  if (!forbidden) {
    try { breaches = (await client.shipments.coldChainBreaches({ hours, limit: 200 })) as BreachRow[]; }
    catch { breachesFailed = true; }
  }

  const fleet = fleetSummary(devices, now, SILENT_AFTER_HOURS);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('iot.title')}</h1>
        <span>
          <Link href="/devices/alerts" className="kv-btn--link">{t.t('iot.alertsLink')}</Link>
          {' · '}
          <Link href="/devices/rules" className="kv-btn--link">{t.t('iot.rulesLink')}</Link>
        </span>
      </div>
      <p className="kv-field__hint">{t.t('iot.hint')}</p>
      <p className="kv-notice" role="note">{t.t('iot.evidenceNotice')}</p>

      {forbidden && <p className="kv-error" role="alert">{t.t('iot.forbidden')}</p>}

      {!forbidden && (
        <>
          <h2 className="kv-section-title">{t.t('iot.fleetTitle')}</h2>
          {devicesFailed ? <p className="kv-error" role="alert">{t.t('iot.loadError')}</p> : (
            <>
              <dl className="kv-facts kv-facts--totals">
                <div className="kv-facts__row"><dt>{t.t('iot.heardFrom')}</dt><dd>{fleet.total}</dd></div>
                <div className="kv-facts__row">
                  <dt>{t.t('iot.silentCount', { h: String(SILENT_AFTER_HOURS) })}</dt>
                  <dd>{fleet.silent > 0 ? <strong className="kv-amount--debit">{fleet.silent}</strong> : fleet.silent}</dd>
                </div>
                <div className="kv-facts__row"><dt>{t.t('iot.breachingCount')}</dt><dd>{fleet.breaching}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('iot.okCount')}</dt><dd>{fleet.ok}</dd></div>
              </dl>
              <DataTable
                rows={devices}
                empty={t.t('iot.fleetEmpty')}
                columns={[
                  { header: t.t('iot.colDevice'), cell: (d) => d.deviceRef ?? t.t('common.dash') },
                  {
                    header: t.t('iot.colHealth'),
                    cell: (d) => {
                      const h = deviceHealth(d, now, SILENT_AFTER_HOURS);
                      const label = t.t(`iot.health.${h}`);
                      return h === 'silent' || h === 'unknown' ? <strong className="kv-amount--debit">{label}</strong> : <span className="kv-badge">{label}</span>;
                    },
                  },
                  {
                    header: t.t('iot.colLastSeen'),
                    cell: (d) => {
                      const age = hoursSince(d.lastSeen, now);
                      return d.lastSeen
                        ? `${formatDate(d.lastSeen, lang, { dateStyle: 'medium', timeStyle: 'short' })}${age !== null ? ` · ${t.t('iot.agoHours', { h: String(age) })}` : ''}`
                        : t.t('common.dash');
                    },
                  },
                  { header: t.t('iot.colReadings24h'), cell: (d) => String(d.readings24h ?? 0) },
                  { header: t.t('iot.colBreaches24h'), cell: (d) => String(d.breaches24h ?? 0) },
                  { header: t.t('iot.colLastTemp'), cell: (d) => (d.lastTempC ? `${d.lastTempC} °C` : t.t('common.dash')) },
                ]}
              />
            </>
          )}

          <h2 className="kv-section-title">{t.t('iot.breachTitle')}</h2>
          <nav className="kv-tabs" aria-label={t.t('iot.windowLabel')}>
            {BREACH_WINDOWS.map((w) => (
              <a key={w} href={`/devices?hours=${w}`} className={`kv-tab${w === hours ? ' kv-tab--active' : ''}`} aria-current={w === hours ? 'page' : undefined}>
                {t.t('iot.windowHours', { h: String(w) })}
              </a>
            ))}
          </nav>
          {breachesFailed ? <p className="kv-error" role="alert">{t.t('iot.loadError')}</p> : (
            <DataTable
              rows={breaches}
              empty={t.t('iot.breachEmpty', { h: String(hours) })}
              columns={[
                { header: t.t('iot.colWhen'), cell: (b) => (b.recordedAt ? formatDate(b.recordedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')) },
                { header: t.t('iot.colDevice'), cell: (b) => b.deviceRef ?? t.t('common.dash') },
                { header: t.t('iot.colSubject'), cell: (b) => `${b.subjectType ?? ''} ${b.subjectId ? `${b.subjectId.slice(0, 8)}…` : ''}`.trim() || t.t('common.dash') },
                { header: t.t('iot.colTemp'), cell: (b) => (b.tempC ? `${b.tempC} °C` : t.t('common.dash')) },
                { header: t.t('iot.colHumidity'), cell: (b) => (b.humidityPct ? `${b.humidityPct} %` : t.t('common.dash')) },
              ]}
            />
          )}
          <p className="kv-field__hint kv-note">{t.t('iot.breachNote')}</p>
        </>
      )}
    </section>
  );
}
