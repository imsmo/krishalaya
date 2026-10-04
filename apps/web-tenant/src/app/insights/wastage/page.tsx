// apps/web-tenant/src/app/insights/wastage/page.tsx · W195 · Wastage — PC-56 TENANT-SW-f (DELTA-031, founder: FROM RECORDED FACTS ONLY).
//
// Measured loss (90 days) is the money value each SOURCE recorded for a loss — a refunded return, a rejected milk pour's priced amount, a
// POD-opened dispute's refund, a recorded cold-chain loss, a POD reviewer's variance — per currency; losses with no money fact are counted
// by quantity (or by count) beside it, never valued. A POD rejection and the dispute it opened count once. Split by where the source places
// it; ÷ GMV of the same window by SW-d's AGM method, only in one currency. Refused by name: the national statistic (unsourced), "what
// saved money" (a counterfactual), weighbridge slips (no object), and a typed loss (facts only). Export → W2824 / W2825; the W2826–W2828
// chain is the facts re-run (idempotent) and a Retry that re-reads.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { Wastage, WastageEvent } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber, formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { AsOf } from '../../../components/AsOf';
import { WASTAGE_HREF, RETRY_HREF, asOfLabels, sharePercent, swfPageState, swfCodeKey } from '../../../features/swf/console';
import { InsightsNav } from '../InsightsNav';
import { MethodLine, RefusedLine } from '../RefusedLine';
import { exportWastageAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.wastage.title'), robots: { index: false, follow: false } }; }

export default async function WastagePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(WASTAGE_HREF);
  const t = getTranslator(); const lang = getLang();
  const canRerun = tenantHasPerm('insights.manage');
  let w: Wastage | null = null; let ev: { items: WastageEvent[]; nextCursor: string | null } | null = null; let state: string | null = null;
  try { [w, ev] = await Promise.all([tenantClient().insights.wastage(), tenantClient().insights.wastageEvents({ cursor: searchParams.cursor, limit: 25 })]); }
  catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); }
  const exportError = searchParams.error ? swfCodeKey(searchParams.error) : null;
  const when = (iso: string) => formatDate(iso, lang, { dateStyle: 'medium' });
  const money = (rows: Array<{ currency: string; valueMinor: string }>) => rows.map((r) => formatMoneyMinor(r.valueMinor, r.currency, lang)).join(' · ');
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.nav.label')}><span>{t.t('swf.nav.insights')}</span> / <span aria-current="page">{t.t('swf.wastage.title')}</span></nav>
      <h1>{t.t('swf.wastage.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.wastage.lead')}</p>
      <InsightsNav t={t} active="wastage" />
      {exportError && <div className="kv-error" role="alert"><p>{t.t(exportError)} <code>{searchParams.error}</code></p></div>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'swf.wastage.flaggedOff' : `swf.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={`${RETRY_HREF}?from=wastage`} className="kv-btn--link">{t.t('swf.retry')}</Link> <span className="kv-field__hint">{t.t('swf.wastage.error.body')}</span></p>}
        </div>
      ) : w && ev && (
        <>
          <AsOf at={w.asOf} labels={asOfLabels(t)} />
          <p><RefusedLine t={t} lang={lang} code={w.refused.externalStatistic.code} words={w.refusals} label={t.t('swf.wastage.national')} /></p>
          <form action={exportWastageAction}><button type="submit" className="kv-btn">{t.t('swf.export')}</button> <span className="kv-field__hint">{t.t('swf.export.unsigned')}</span>
            {canRerun && <>{' · '}<Link href={`${WASTAGE_HREF}/act?step=confirm`} className="kv-btn--link">{t.t('swf.wastage.rerun')}</Link></>}</form>
          {w.loss.events === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swf.wastage.empty.title')}</strong><p>{t.t('swf.wastage.empty.body')}</p><p><Link href="/disputes" className="kv-btn--link">{t.t('swf.wastage.viewDisputes')}</Link></p></div>
          ) : (
            <div className="kv-tiles">
              <div className="kv-card"><p className="kv-detail__muted">{t.t('swf.wastage.measured', { days: String(w.window.days) })}</p>
                <p className="kv-money"><strong>{w.loss.byCurrency.length ? money(w.loss.byCurrency) : t.t('swf.wastage.noMoney')}</strong></p>
                {w.loss.byUnit.length > 0 && <p className="kv-field__hint">{t.t('swf.wastage.plusQuantity', { q: w.loss.byUnit.map((u) => `${u.quantity} ${u.unit}`).join(' · ') })}</p>}
                {w.loss.withoutValueOrQuantity > 0 && <p className="kv-field__hint">{t.t('swf.wastage.counted', { n: String(w.loss.withoutValueOrQuantity) })}</p>}
                <p className="kv-field__hint">{w.share.kind === 'share'
                  ? t.t('swf.wastage.share', { pct: sharePercent(w.share.bps), gmv: formatMoneyMinor(w.share.gmvMinor, w.share.currency, lang) })
                  : <RefusedLine t={t} lang={lang} code={w.share.code} words={w.refusals} label={t.t('swf.wastage.shareLabel')} />}</p></div>
              {w.loss.split.map((s) => (
                <div key={s.kind} className="kv-card"><p className="kv-detail__muted">{t.t(`swf.wastage.kind.${s.kind}`)}</p>
                  <p className="kv-money"><strong>{s.byCurrency.length ? money(s.byCurrency) : t.t('swf.wastage.noMoney')}</strong></p>
                  {s.byUnit.length > 0 && <p className="kv-field__hint">{s.byUnit.map((u) => `${u.quantity} ${u.unit}`).join(' · ')}</p>}
                  <p className="kv-field__hint">{t.t('swf.wastage.events', { n: String(s.events) })}</p></div>
              ))}
            </div>
          )}
          <h2>{t.t('swf.wastage.facts')}</h2>
          <DataTable rows={ev.items} empty={t.t('swf.wastage.empty.title')} columns={[
            { header: t.t('swf.wastage.col.when'), cell: (e) => when(e.occurredAt) },
            { header: t.t('swf.wastage.col.kind'), cell: (e) => t.t(`swf.wastage.kind.${e.kind}`) },
            { header: t.t('swf.wastage.col.source'), cell: (e) => <span>{t.t(`swf.wastage.source.${e.sourceKind}`)}{e.chainKey ? <span className="kv-detail__muted"> · {t.t('swf.wastage.chained')}</span> : null}</span> },
            { header: t.t('swf.wastage.col.what'), cell: (e) => [e.crop, e.quantity ? `${e.quantity} ${e.unit}` : null].filter(Boolean).join(' · ') || t.t('common.dash') },
            { header: t.t('swf.wastage.col.value'), cell: (e) => (e.valueMinor && e.currency ? <span className="kv-money">{formatMoneyMinor(e.valueMinor, e.currency, lang)}</span> : <span className="kv-detail__muted">{t.t(`swf.wastage.reason.${e.valueReason ?? 'no_money_fact'}`)}</span>) },
            { header: t.t('swf.wastage.col.method'), cell: (e) => t.t(`swf.wastage.methodCode.${e.methodCode}`) },
          ]} />
          {ev.nextCursor && <p><Link href={`${WASTAGE_HREF}?cursor=${encodeURIComponent(ev.nextCursor)}`} className="kv-btn--link">{t.t('swf.more')}</Link></p>}
          <div className="kv-card"><h2>{t.t('swf.wastage.saved')}</h2>
            <p><RefusedLine t={t} lang={lang} code={w.refused.savedMoney.code} words={w.refusals} /></p>
            <p><RefusedLine t={t} lang={lang} code={w.refused.weighbridge.code} words={w.refusals} /></p></div>
          <div className="kv-card"><h2>{t.t('swf.wastage.manual')}</h2><p><RefusedLine t={t} lang={lang} code={w.refused.manualEntry.code} words={w.refusals} /></p></div>
          <div className="kv-card"><h2>{t.t('swf.methods')}</h2>
            <ul className="kv-list">{['measured_loss', 'loss_share', 'loss_split'].map((x) => <MethodLine key={x} t={t} lang={lang} code={x} words={w!.methods} />)}</ul>
            <p className="kv-field__hint">{t.t('swf.wastage.sources', { list: w.sources.map((s) => `${t.t(`swf.wastage.source.${s.sourceKind}`)} ${formatNumber(s.events, lang)}`).join(' · ') || t.t('common.dash') })}</p></div>
        </>
      )}
    </section>
  );
}
