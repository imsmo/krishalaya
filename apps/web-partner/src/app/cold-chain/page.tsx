// apps/web-partner/src/app/cold-chain/page.tsx · the reefer/vaccine cold-chain temperature log. The API list is
// SUBJECT-SCOPED (GET logistics/cold-chain/readings needs subjectType + subjectId), so the page first takes a
// subject scope, then renders that subject's readings (breach-only toggle, keyset) + a record form (POST, append-
// only — no Idempotency-Key). Temperatures are physical decimals (°C), rendered as plain strings — NOT money.
// Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { COLD_CHAIN_SUBJECTS, coldSubjectKey, buildColdChainQuery, NetworkError, type ColdChainRow } from '../../features/logistics/network';
import { recordReadingAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('net.coldTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['subjectType', 'subjectId', 'tempC', 'humidity', 'deviceRef', 'recordedAt', 'allowedMinC', 'allowedMaxC', 'bandOrder', 'forbidden', 'conflict', 'notFound', 'generic']);

function NetworkNav({ active }: { active: 'zones' | 'routes' | 'cold' }) {
  const t = getTranslator();
  return (
    <nav className="kv-filters" aria-label={t.t('net.nav')}>
      <Link href="/zones" className={`kv-chip${active === 'zones' ? ' is-active' : ''}`} aria-current={active === 'zones' ? 'true' : undefined}>{t.t('net.navZones')}</Link>
      <Link href="/routes" className={`kv-chip${active === 'routes' ? ' is-active' : ''}`} aria-current={active === 'routes' ? 'true' : undefined}>{t.t('net.navRoutes')}</Link>
      <Link href="/cold-chain" className={`kv-chip${active === 'cold' ? ' is-active' : ''}`} aria-current={active === 'cold' ? 'true' : undefined}>{t.t('net.navCold')}</Link>
    </nav>
  );
}

export default async function ColdChainPage({ searchParams }: { searchParams: { subjectType?: string; subjectId?: string; breachOnly?: string; ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let scope: ReturnType<typeof buildColdChainQuery> = null;
  let scopeError: string | null = null;
  try { scope = buildColdChainQuery(searchParams); }
  catch (e) { scopeError = e instanceof NetworkError ? e.fieldKey : 'generic'; }

  let rows: ColdChainRow[] = [];
  let notice: string | undefined;
  if (scope) {
    try {
      rows = (await partnerClient().request<ColdChainRow[]>('GET', 'logistics/cold-chain/readings', { query: { subjectType: scope.subjectType, subjectId: scope.subjectId, breachOnly: scope.breachOnly } })).data ?? [];
    } catch { notice = t.t('dash.unavailable'); }
  }

  const okRecorded = searchParams.ok === 'recorded';
  const errKey = (scopeError && ERR.has(scopeError) ? scopeError : null) ?? (searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null);
  const selType = scope?.subjectType ?? (searchParams.subjectType ?? '');
  const selId = scope?.subjectId ?? (searchParams.subjectId ?? '');

  const columns: Column<ColdChainRow>[] = [
    { header: t.t('net.colRecordedAt'), cell: (r) => formatDate(r.recordedAt, 'en', { dateStyle: 'medium', timeStyle: 'short' }) },
    { header: t.t('net.colTemp'), cell: (r) => `${r.tempC} °C` },
    { header: t.t('net.colHumidity'), cell: (r) => (r.humidityPct === null ? t.t('common.dash') : `${r.humidityPct}%`) },
    { header: t.t('net.colDevice'), cell: (r) => r.deviceRef ?? t.t('common.dash') },
    { header: t.t('net.colBreach'), cell: (r) => <span className={`kv-status kv-status--${r.isBreach ? 'danger' : 'ok'}`}>{t.t(r.isBreach ? 'net.breach' : 'net.inBand')}</span> },
  ];

  return (
    <section>
      <h1>{t.t('net.coldTitle')}</h1>
      <p className="kv-muted">{t.t('net.coldLead')}</p>
      <NetworkNav active="cold" />
      {okRecorded && <p className="kv-success" role="status">{t.t('net.ok.recorded')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`net.err.${errKey}`)}</p>}

      <form className="kv-form" aria-label={t.t('net.subjectScope')}>
        <label htmlFor="cc-st" className="kv-field__label">{t.t('net.subjectType')}</label>
        <select id="cc-st" name="subjectType" className="kv-input" defaultValue={selType} required>
          <option value="">{t.t('net.subjectPick')}</option>
          {COLD_CHAIN_SUBJECTS.map((s) => <option key={s} value={s}>{t.t(coldSubjectKey(s))}</option>)}
        </select>
        <label htmlFor="cc-sid" className="kv-field__label">{t.t('net.subjectId')}</label>
        <input id="cc-sid" name="subjectId" className="kv-input" defaultValue={selId} placeholder={t.t('net.uuidHint')} required />
        <label className="kv-field__label"><input type="checkbox" name="breachOnly" value="true" defaultChecked={scope?.breachOnly ?? false} /> {t.t('net.breachOnly')}</label>
        <button type="submit" className="kv-btn">{t.t('net.loadReadings')}</button>
      </form>

      {scope ? (
        <>
          {notice ? <p className="kv-error" role="alert">{notice}</p> : <DataTable columns={columns} rows={rows} empty={t.t('net.coldEmpty')} />}

          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('net.recordReading')}</summary>
            <form action={recordReadingAction} className="kv-form">
              <input type="hidden" name="subjectType" value={scope.subjectType} />
              <input type="hidden" name="subjectId" value={scope.subjectId} />
              <label htmlFor="rr-temp" className="kv-field__label">{t.t('net.tempC')}</label>
              <input id="rr-temp" name="tempC" className="kv-input" inputMode="decimal" required placeholder={t.t('net.tempHint')} />
              <label htmlFor="rr-min" className="kv-field__label">{t.t('net.allowedMinC')}</label>
              <input id="rr-min" name="allowedMinC" className="kv-input" inputMode="decimal" required />
              <label htmlFor="rr-max" className="kv-field__label">{t.t('net.allowedMaxC')}</label>
              <input id="rr-max" name="allowedMaxC" className="kv-input" inputMode="decimal" required />
              <label htmlFor="rr-hum" className="kv-field__label">{t.t('net.humidity')}</label>
              <input id="rr-hum" name="humidityPct" className="kv-input" inputMode="decimal" placeholder={t.t('net.optionalHint')} />
              <label htmlFor="rr-dev" className="kv-field__label">{t.t('net.deviceRef')}</label>
              <input id="rr-dev" name="deviceRef" className="kv-input" maxLength={100} placeholder={t.t('net.optionalHint')} />
              <label htmlFor="rr-at" className="kv-field__label">{t.t('net.recordedAt')}</label>
              <input id="rr-at" name="recordedAt" className="kv-input" type="datetime-local" required />
              <button type="submit" className="kv-btn">{t.t('net.recordReadingSubmit')}</button>
            </form>
          </details>
        </>
      ) : (
        <p className="kv-muted">{t.t('net.coldPickPrompt')}</p>
      )}
    </section>
  );
}
