// apps/web-tenant/src/app/ops/logistics/cold-chain/devices/page.tsx · the cold-chain loggers — PC-56 TENANT-SW-e. Each registered logger
// (12's device registry), its active key (the hint only — the key itself is never readable again), the subject it signs for, when it last
// spoke; the silences flagged by the 15-minute rule ("alerted, not called"). Register a logger; issue or revoke a key with a reason.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { DataTable } from '../../../../../components/DataTable';
import { COLD_HREF, DEVICES_HREF, coldSubjectHref, failedCodes, swePageState, sweCodeKey } from '../../../../../features/swe/console';
import { registerLoggerAction, revokeKeyAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.devices'), robots: { index: false, follow: false } }; }

export default async function DevicesPage({ searchParams }: { searchParams: { error?: string; registered?: string; revoked?: string } }) {
  await requireSession(DEVICES_HREF);
  const t = getTranslator(); const lang = getLang();
  const canDevices = tenantHasPerm('logistics.devices.manage');
  let data: Awaited<ReturnType<ReturnType<typeof tenantClient>['coldChain']['loggers']>> | null = null; let state: string | null = null;
  try { data = await tenantClient().coldChain.loggers(); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, true); }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const errors = failedCodes(searchParams.error);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.title')}><Link href={COLD_HREF}>{t.t('swe.cold.title')}</Link> / <span aria-current="page">{t.t('swe.cold.devices')}</span></nav>
      <h1>{t.t('swe.cold.devices')}</h1>
      <p className="kv-field__hint">{t.t('swe.devices.subtitle')}</p>
      {errors.length > 0 && <div className="kv-error" role="alert"><ul>{errors.map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul></div>}
      {searchParams.registered === '1' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.devices.registered')}</p></div>}
      {searchParams.revoked === '1' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.devices.revoked')}</p></div>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>
      ) : data && (
        <>
          {data.items.length === 0 ? <p className="kv-field__hint">{t.t('swe.devices.none')}</p> : (
            <DataTable rows={data.items} empty={t.t('swe.devices.none')} columns={[
              { header: t.t('swe.devices.serial'), cell: (d) => <span><strong>{d.serial}</strong>{d.label ? <span className="kv-detail__muted"> · {d.label}</span> : null}</span> },
              { header: t.t('swe.cold.col.status'), cell: (d) => d.status },
              { header: t.t('swe.devices.lastReading'), cell: (d) => when(d.lastReadingAt) },
              { header: t.t('swe.devices.key'), cell: (d) => (d.key ? <span><code>{d.key.hint}</code> · <Link href={coldSubjectHref(d.key.subjectType, d.key.subjectId)} className="kv-btn--link">{t.t(`swe.cold.kind.${d.key.subjectType}`)}</Link> · {when(d.key.issuedAt)}</span> : t.t('swe.devices.noKey')) },
              { header: '', cell: (d) => (canDevices ? (
                <span>
                  <Link href={`${DEVICES_HREF}/key?deviceId=${d.deviceId}`} className="kv-btn--link">{t.t(d.key ? 'swe.key.reissue' : 'swe.key.issue')}</Link>
                  {d.key && (
                    <form action={revokeKeyAction} className="kv-inline-form">
                      <input type="hidden" name="deviceId" value={d.deviceId} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                      <input name="reason" className="kv-input" minLength={10} maxLength={500} required placeholder={t.t('swe.reason')} aria-label={t.t('swe.reason')} />
                      <button type="submit" className="kv-btn--link">{t.t('swe.key.revoke')}</button>
                    </form>
                  )}
                </span>) : null) },
            ]} />
          )}
          <h2>{t.t('swe.devices.silences', { n: String(data.silenceMinutes) })}</h2>
          {data.silences.length === 0 ? <p className="kv-field__hint">{t.t('swe.devices.noSilences')}</p> : (
            <ul className="kv-list">{data.silences.map((s) => <li key={s.id}>{when(s.flaggedAt)} · {t.t('swe.devices.silentSince', { at: when(s.lastReadingAt) })} · {t.t(`swe.cold.alert.${s.alertState}`, { n: '' })}{s.resolvedAt ? ` · ${t.t('swe.devices.resolved', { at: when(s.resolvedAt) })}` : ''}</li>)}</ul>
          )}
          <p className="kv-field__hint">{t.t('swe.cold.alertedNotCalled')}</p>
          {canDevices && (
            <form action={registerLoggerAction} className="kv-card kv-form">
              <h2>{t.t('swe.devices.register')}</h2>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="l-serial"><span>{t.t('swe.devices.serial')}</span><input id="l-serial" name="serial" className="kv-input" maxLength={80} required /></label>
              <label className="kv-field" htmlFor="l-label"><span>{t.t('swe.devices.label')}</span><input id="l-label" name="label" className="kv-input" maxLength={120} /></label>
              <button type="submit" className="kv-btn">{t.t('swe.devices.register')}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
