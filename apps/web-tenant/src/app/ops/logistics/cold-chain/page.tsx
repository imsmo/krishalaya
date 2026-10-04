// apps/web-tenant/src/app/ops/logistics/cold-chain/page.tsx · W234 · Cold chain — PC-56 TENANT-SW-e (F-13).
//
// Every subject with a band, a reading or a logger: Subject · Kind · Now (the latest reading and its source) · Target (the band from the
// threshold store — the only source of a band) · Device (the registered logger and when it last spoke) · Status. Breaches in 7 days is a
// count of breach rows. A breach is two CONSECUTIVE device readings out of band; a manual reading is labelled and never opens one. A logger
// silent for 15 minutes is flagged and the operator ALERTED — the canon's "auto-call" is refused by name (no voice channel).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ColdOverview } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { BREACHES_HREF, COLD_HREF, DEVICES_HREF, bandLabel, coldSubjectHref, refusedKey, swePageState } from '../../../../features/swe/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.title'), robots: { index: false, follow: false } }; }

export default async function ColdChainPage() {
  await requireSession(COLD_HREF);
  const t = getTranslator(); const lang = getLang();
  const canManage = tenantHasPerm('logistics.manage');
  let o: ColdOverview | null = null; let state: string | null = null;
  try { o = await tenantClient().coldChain.subjects(); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, true); }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swe.cold.title')}</span></nav>
      <h1>{t.t('swe.cold.title')}</h1>
      <p className="kv-field__hint">{t.t('swe.cold.subtitle')}</p>
      <p><Link href={BREACHES_HREF} className="kv-btn--link">{t.t('swe.cold.breaches')}</Link>{' · '}<Link href={DEVICES_HREF} className="kv-btn--link">{t.t('swe.cold.devices')}</Link>
        {canManage && <>{' · '}<Link href={`${COLD_HREF}/threshold`} className="kv-btn--link">{t.t('swe.cold.setBand')}</Link></>}</p>
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={COLD_HREF} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}
        </div>
      ) : o && (
        <>
          <div className="kv-tiles">
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swe.cold.breaches7d')}</p><p><strong>{o.breaches7d}</strong></p></div>
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swe.cold.subjects')}</p><p><strong>{o.items.length}</strong></p></div>
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swe.cold.silence', { n: String(o.silenceMinutes) })}</p><p className="kv-detail__muted">{t.t('swe.cold.alertedNotCalled')}</p></div>
          </div>
          {o.items.length === 0 ? <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swe.cold.empty.title')}</strong><p>{t.t('swe.cold.empty.body')}</p></div> : (
            <DataTable rows={o.items} empty={t.t('swe.cold.empty.title')} columns={[
              { header: t.t('swe.cold.col.subject'), cell: (s) => <Link href={coldSubjectHref(s.subjectType, s.subjectId)} className="kv-btn--link">{s.label}</Link> },
              { header: t.t('swe.cold.col.kind'), cell: (s) => t.t(`swe.cold.kind.${s.subjectType}`) },
              { header: t.t('swe.cold.col.now'), cell: (s) => (s.now ? <span>{s.now.tempC} °C <span className="kv-detail__muted">· {s.now.source ? t.t(`swe.cold.source.${s.now.source}`) : ''} · {when(s.now.at)}</span></span> : t.t('common.dash')) },
              { header: t.t('swe.cold.col.target'), cell: (s) => bandLabel(s.target) ?? t.t('swe.cold.noBand') },
              { header: t.t('swe.cold.col.device'), cell: (s) => (s.device ? <span>{s.device.serial ?? s.device.id.slice(0, 8)} <span className="kv-detail__muted">· {when(s.device.lastReadingAt)}</span></span> : t.t('common.dash')) },
              { header: t.t('swe.cold.col.status'), cell: (s) => <span className={s.status === 'breach_open' || s.status === 'silent' ? 'kv-badge kv-badge--danger' : 'kv-badge'}>{t.t(`swe.cold.status.${s.status}`)}</span> },
            ]} />
          )}
          <div className="kv-card">
            <h2>{t.t('swe.methods')}</h2>
            <ul className="kv-list">
              <li>{t.t('swe.cold.method.band')}</li>
              <li>{t.t('swe.cold.method.breach')}</li>
              <li>{t.t('swe.cold.method.silence')}</li>
              <li>{t.t('swe.cold.autoCall')}: {t.t(refusedKey(o.refused.autoCall))}</li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
