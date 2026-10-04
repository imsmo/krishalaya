// apps/web-tenant/src/app/insights/demand-map/page.tsx · W194 · Demand map — around your members — PC-56 TENANT-SW-f.
//
// Open buyer requirements (11d) with Qty wanted (less what is already accepted) · MEMBER STOCK FIT (the cooperative's listed stock of the
// same crop in the same unit, the buyer's own excluded — covers / partial / none; an aggregate) · Value (qty × the buyer's per-unit budget,
// or REFUSED BY NAME when the requirement carries none) · Respond (the existing 11d flow). "Within reach of your districts" is a REAL filter
// (delivery pincode → district against the cooperative's districts) — or refused by name when the cooperative has no district on record.
// Member-level rows appear ONLY where that member consented to a quote on the requirement (the privacy line, printed). "Gap the other way"
// is refused by name (no unmet-demand method). Export → dataset demand_map on the plane (W2569 → W2570).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { DemandMap } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { AsOf } from '../../../components/AsOf';
import { DEMAND_HREF, RETRY_HREF, asOfLabels, swfPageState, swfCodeKey } from '../../../features/swf/console';
import { InsightsNav } from '../InsightsNav';
import { MethodLine, RefusedLine } from '../RefusedLine';
import { exportDemandAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.demand.title'), robots: { index: false, follow: false } }; }

export default async function DemandMapPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DEMAND_HREF);
  const t = getTranslator(); const lang = getLang();
  const reach = searchParams.reach === 'districts' ? 'districts' : 'all';
  let m: DemandMap | null = null; let state: string | null = null;
  try { m = await tenantClient().insights.demandMap({ cursor: searchParams.cursor, limit: 25, reach }); }
  catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); }
  const exportError = searchParams.error ? swfCodeKey(searchParams.error) : null;
  const filterHref = (r: 'all' | 'districts') => `${DEMAND_HREF}?reach=${r}`;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.nav.label')}><span>{t.t('swf.nav.insights')}</span> / <span aria-current="page">{t.t('swf.demand.title')}</span></nav>
      <h1>{t.t('swf.demand.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.demand.lead')}</p>
      <InsightsNav t={t} active="demand" />
      {exportError && <div className="kv-error" role="alert"><p>{t.t(exportError)} <code>{searchParams.error}</code></p></div>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'swf.demand.flaggedOff' : `swf.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={`${RETRY_HREF}?from=demand`} className="kv-btn--link">{t.t('swf.retry')}</Link> <span className="kv-field__hint">{t.t('swf.demand.error.body')}</span></p>}
        </div>
      ) : m && (
        <>
          <AsOf at={m.asOf} labels={asOfLabels(t)} />
          <form action={exportDemandAction}><input type="hidden" name="reach" value={reach} /><button type="submit" className="kv-btn">{t.t('swf.export')}</button> <span className="kv-field__hint">{t.t('swf.export.unsigned')}</span></form>
          {m.reach.kind === 'filter' ? (
            <nav className="kv-tabs" aria-label={t.t('swf.demand.reach')}>
              <a href={filterHref('all')} className={`kv-tab${reach === 'all' ? ' kv-tab--active' : ''}`} aria-current={reach === 'all' ? 'page' : undefined}>{t.t('swf.demand.reachAll')}</a>
              <a href={filterHref('districts')} className={`kv-tab${reach === 'districts' ? ' kv-tab--active' : ''}`} aria-current={reach === 'districts' ? 'page' : undefined}>{t.t('swf.demand.reachDistricts', { n: String(m.reach.districts) })}</a>
            </nav>
          ) : <p><RefusedLine t={t} lang={lang} code={m.reach.code} words={m.refusals} label={t.t('swf.demand.reach')} /></p>}
          <h2>{t.t('swf.demand.serve')}</h2>
          {m.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t(reach === 'districts' ? 'swf.demand.quiet.title' : 'swf.demand.empty.title')}</strong><p>{t.t(reach === 'districts' ? 'swf.demand.quiet.body' : 'swf.demand.empty.body')}</p>
              <p><Link href="/marketplace/requirements" className="kv-btn--link">{t.t('swf.demand.viewAll')}</Link></p></div>
          ) : (
            <DataTable rows={m.items} empty={t.t('swf.demand.empty.title')} columns={[
              { header: t.t('swf.demand.col.requirement'), cell: (r) => <span><strong>{r.reqNo ?? r.id.slice(0, 8)}</strong> <span className="kv-detail__muted">· {r.title}{r.crop ? ` · ${r.crop}` : ''}</span></span> },
              { header: t.t('swf.demand.col.wanted'), cell: (r) => `${r.wanted.quantity} ${r.wanted.unit}` },
              { header: t.t('swf.demand.col.fit'), cell: (r) => <span><span className={r.stock.fit === 'covers' ? 'kv-badge' : 'kv-badge kv-badge--muted'}>{t.t(`swf.demand.fit.${r.stock.fit}`)}</span> {r.stock.quantity} {r.stock.unit}
                {r.basis === 'category' && <span className="kv-detail__muted"> · {t.t('swf.demand.byCategory')}</span>}
                {r.consented.length > 0 && <ul className="kv-list">{r.consented.map((c, i) => <li key={i}>{t.t('swf.demand.consented', { name: c.memberName ?? t.t('common.dash'), qty: c.quantity ?? '', unit: c.unit ?? '' })}</li>)}</ul>}</span> },
              { header: t.t('swf.demand.col.value'), cell: (r) => (r.value.kind === 'value'
                ? <span className="kv-money">{r.value.fromMinor ? `${formatMoneyMinor(r.value.fromMinor, r.value.currency, lang)} – ` : `${t.t('swf.demand.upTo')} `}{formatMoneyMinor(r.value.upToMinor, r.value.currency, lang)}</span>
                : <RefusedLine t={t} lang={lang} code={r.value.code} words={m!.refusals} />) },
              { header: t.t('swf.demand.col.reach'), cell: (r) => (typeof r.reach === 'string' ? t.t(`swf.demand.reach.${r.reach}`) : t.t('common.dash')) },
              { header: t.t('swf.demand.col.respond'), cell: (r) => <Link href={`/marketplace/requirements/${encodeURIComponent(r.id)}`} className="kv-btn--link">{t.t('swf.demand.respond')}</Link> },
            ]} />
          )}
          {m.nextCursor && <p><Link href={`${DEMAND_HREF}?reach=${reach}&cursor=${encodeURIComponent(m.nextCursor)}`} className="kv-btn--link">{t.t('swf.more')}</Link></p>}
          <div className="kv-card"><h2>{t.t('swf.demand.gap')}</h2><p><RefusedLine t={t} lang={lang} code={m.unmetDemand.code} words={m.refusals} /></p></div>
          <div className="kv-card"><h2>{t.t('swf.demand.privacy.title')}</h2><p>{t.t('swf.demand.privacy.body')}</p></div>
          <div className="kv-card"><h2>{t.t('swf.methods')}</h2><ul className="kv-list">{['qty_wanted', 'stock_fit', 'demand_value', 'geo_reach'].map((x) => <MethodLine key={x} t={t} lang={lang} code={x} words={m!.methods} />)}</ul></div>
        </>
      )}
    </section>
  );
}
