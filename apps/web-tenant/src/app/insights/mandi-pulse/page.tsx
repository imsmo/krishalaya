// apps/web-tenant/src/app/insights/mandi-pulse/page.tsx · W193 · Mandi Pulse — your crops — PC-56 TENANT-SW-f (F-18, F-24).
//
// "Your crops today" is the MEMBER-CROP FILTER: crops in a published listing of this cooperative, or declared in a crop season of this
// year or last — joined to the latest accepted modal per mandi (Δ against that mandi's previous earlier day). "Member stock" is LISTED
// stock (what is up for sale), a fact, labelled so. Price alerts active / fired this week are the tenant's own counts. Three canon figures
// are REFUSED BY NAME: stored stock (no stock declaration), "members who sold on an alert" (a causal claim with no method) and the "AI band"
// (no registered model). Every figure prints its method; the export is the 6e-2 plane (W2678 queued → W2679 ready, unsigned).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { MemberPulse } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { AsOf } from '../../../components/AsOf';
import { MANDI_HREF, RETRY_HREF, asOfLabels, bpsPercent, swfPageState, swfCodeKey } from '../../../features/swf/console';
import { InsightsNav } from '../InsightsNav';
import { MethodLine, RefusedLine } from '../RefusedLine';
import { exportMandiAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.mandi.title'), robots: { index: false, follow: false } }; }

export default async function MandiPulsePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(MANDI_HREF);
  const t = getTranslator(); const lang = getLang();
  let p: MemberPulse | null = null; let state: string | null = null;
  try { p = await tenantClient().insights.memberPulse({ cursor: searchParams.cursor, limit: 25 }); }
  catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); }
  const exportError = searchParams.error ? swfCodeKey(searchParams.error) : null;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.nav.label')}><span>{t.t('swf.nav.insights')}</span> / <span aria-current="page">{t.t('swf.mandi.title')}</span></nav>
      <h1>{t.t('swf.mandi.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.mandi.lead')}</p>
      <InsightsNav t={t} active="mandi" />
      {exportError && <div className="kv-error" role="alert"><p>{t.t(exportError)} <code>{searchParams.error}</code></p></div>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'swf.mandi.flaggedOff' : `swf.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={`${RETRY_HREF}?from=mandi`} className="kv-btn--link">{t.t('swf.retry')}</Link> <span className="kv-field__hint">{t.t('swf.mandi.error.body')}</span></p>}
        </div>
      ) : p && (
        <>
          <AsOf at={p.asOf} labels={asOfLabels(t)} />
          <form action={exportMandiAction}><button type="submit" className="kv-btn">{t.t('swf.export')}</button> <span className="kv-field__hint">{t.t('swf.export.unsigned')}</span></form>
          <div className="kv-tiles">
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swf.mandi.tracked')}</p><p><strong>{formatNumber(p.cropsTracked.count, lang)}</strong></p>
              <p className="kv-field__hint">{t.t('swf.mandi.trackedFrom', { listings: String(p.cropsTracked.fromListings), seasons: String(p.cropsTracked.fromSeasons) })}</p></div>
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swf.mandi.alerts')}</p><p><strong>{formatNumber(p.alerts.active, lang)}</strong></p>
              <p className="kv-field__hint">{t.t('swf.mandi.firedThisWeek', { n: String(p.alerts.firedThisWeek) })}</p></div>
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swf.mandi.soldOnAlert')}</p><p><RefusedLine t={t} lang={lang} code={p.soldOnAlert.code} words={p.refusals} /></p></div>
            <div className="kv-card"><p className="kv-detail__muted">{t.t('swf.mandi.stored')}</p><p><RefusedLine t={t} lang={lang} code={p.storedStock.code} words={p.refusals} /></p></div>
          </div>
          <div className="kv-card"><p><strong>{t.t('swf.mandi.band')}</strong></p><p><RefusedLine t={t} lang={lang} code={p.band.code} words={p.refusals} /></p></div>
          <h2>{t.t('swf.mandi.yourCrops')}</h2>
          {p.crops.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swf.mandi.empty.title')}</strong><p>{t.t('swf.mandi.empty.body')}</p><p><Link href="/listings" className="kv-btn--link">{t.t('swf.mandi.viewListings')}</Link></p></div>
          ) : (
            <DataTable rows={p.crops.items} empty={t.t('swf.mandi.empty.title')} columns={[
              { header: t.t('swf.mandi.col.crop'), cell: (c) => <span>{c.crop} <span className="kv-detail__muted">· {[c.listed ? t.t('swf.mandi.fromListing') : null, c.declared ? t.t('swf.mandi.fromSeason') : null].filter(Boolean).join(' · ')}</span></span> },
              { header: t.t('swf.mandi.col.mandi'), cell: (c) => (c.mandis.length ? <ul className="kv-list">{c.mandis.map((m) => <li key={m.mandiId}>{m.mandi} <span className="kv-detail__muted">· {m.priceDate}</span></li>)}</ul> : t.t('swf.mandi.noPrice')) },
              { header: t.t('swf.mandi.col.modal'), cell: (c) => (c.mandis.length ? <ul className="kv-list">{c.mandis.map((m) => <li key={m.mandiId} className="kv-money">{formatMoneyMinor(m.modalMinor, m.currency, lang)} <span className="kv-detail__muted">/ {m.unit}</span></li>)}</ul> : t.t('common.dash')) },
              { header: t.t('swf.mandi.col.change'), cell: (c) => (c.mandis.length ? <ul className="kv-list">{c.mandis.map((m) => <li key={m.mandiId}>{m.change ? bpsPercent(m.change.changeBps) : t.t('swf.mandi.noPrevious')}</li>)}</ul> : t.t('common.dash')) },
              { header: t.t('swf.mandi.col.stock'), cell: (c) => (c.listedStock.length ? c.listedStock.map((s) => `${s.quantity} ${s.unit}`).join(' · ') : t.t('swf.mandi.noListedStock')) },
            ]} />
          )}
          {p.crops.nextCursor && <p><Link href={`${MANDI_HREF}?cursor=${encodeURIComponent(p.crops.nextCursor)}`} className="kv-btn--link">{t.t('swf.more')}</Link></p>}
          <div className="kv-card">
            <h2>{t.t('swf.methods')}</h2>
            <ul className="kv-list">{['member_crops', 'mandi_modal', 'listed_stock', 'alerts_active', 'alerts_fired'].map((m) => <MethodLine key={m} t={t} lang={lang} code={m} words={p!.methods} />)}</ul>
            <p className="kv-field__hint">{t.t('swf.mandi.memberDecides')}</p>
          </div>
        </>
      )}
    </section>
  );
}
