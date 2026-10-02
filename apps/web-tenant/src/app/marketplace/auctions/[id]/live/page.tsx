// apps/web-tenant/src/app/marketplace/auctions/[id]/live/page.tsx · W138 · THE LIVE MONITOR · PC-56 TENANT-11a.
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • header facts from GET /auctions/:id: kind · start (per unit) · reserve (per unit, the seller's and the desk's to see)
//     with "met ✓" COMPUTED from the highest visible bid · min increment · EMD (per lot) · anti-snipe seconds — the API's;
//   • the stream badge says what this page IS: the console ships no realtime client (the realtime gateway serves the mobile
//     app), so the page REFRESHES ITSELF EVERY 5 SECONDS — printed as such, never "stream live · 2s lag";
//   • KPIs: highest bid per unit = the lot value (server-computed) · time left + the number of anti-snipe extensions
//     (counted from auction_events) · active bidders + the EMD the ledger holds for this auction right now (seller / desk);
//   • the bid stream, MASKED: B1…Bn, "reserve met" from each bid against the reserve, "highest", never another person's id
//     (F-17); "seller notified / push sent" is NOT annotated — nothing here reads the notification log;
//   • integrity: same-IP / device check — NOT RUN (named); EMDs — the ledger figure; identities masked — true by construction;
//   • the seller panel says what the code does (auto-settle into an order, or wait for the seller's decision with the clock);
//     the voice call at close is named as not built;
//   • Emergency stop and Pause entry → the mutate chain (tenant_admin, reason) — offered only when the API's `viewerCan` says;
//   • states: Loading, Flagged off (API 404 on the list flag), No auction selected (404), Restricted (403), Couldn't load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuctionDetail, BidStreamPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { AUCTIONS_HREF, actHref, consoleState, isUuid, kindKey, monitorActs, qtyText, settleHref, statusKey, timeLeft } from '../../../../../features/auctions/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.live.title'), robots: { index: false, follow: false } };
}

export default async function AuctionLivePage({ params }: { params: { id: string } }) {
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(params.id)}/live`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const clock = (iso: string) => formatDate(iso, lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const crumbs = (label: string) => (
    <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}>
      <Link href={AUCTIONS_HREF}>{t.t('auc.breadcrumb.auctions')}</Link> / <span aria-current="page">{label}</span>
    </nav>
  );
  const notice = (state: string) => (
    <section>{crumbs(t.t('auc.live.title'))}<h1>{t.t('auc.live.title')}</h1>
      <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
        <strong>{t.t(`auc.live.state.${state}.title`)}</strong><p>{t.t(`auc.live.state.${state}.body`)}</p>
        <p>{state === 'error' ? <Link href={base} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('auc.retry')}</Link>
          : <Link href={AUCTIONS_HREF} className="kv-btn--link">{t.t('auc.backToAuctions')}</Link>}</p>
      </div></section>
  );
  if (!env.featureAuctions) return notice('flaggedOff');
  if (!isUuid(params.id)) return notice('notFound');

  let a: AuctionDetail | null = null; let stream: BidStreamPage | null = null; let state: string | null = null; let streamState: string | null = null;
  try { a = await tenantClient().auctions.get(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  if (state || !a) return notice(state ?? 'error');
  try { stream = await tenantClient().auctions.listBids(params.id, { limit: 50 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; streamState = consoleState(err?.code, err?.status); }

  const unit = a.unitCode ?? '';
  const perUnit = (m: string | null | undefined) => t.t('auc.perUnit', { price: money(m), unit });
  const left = timeLeft(a.endsAt, new Date());
  const live = a.status === 'live' || a.status === 'extended';
  const acts = monitorActs(a.status, a.viewerCan, !!a.entryPaused);
  const emdText = a.emdMinor !== '0' ? t.t('auc.emdFlat', { amount: money(a.emdMinor) }) : a.emdPctBps ? t.t('auc.emdPct', { pct: String(a.emdPctBps / 100) }) : t.t('auc.noEmd');

  return (
    <section>
      {live && <meta httpEquiv="refresh" content="5" />}
      {crumbs(a.auctionNo ?? a.auctionId.slice(0, 8))}
      <div className="kv-page-head">
        <h1>{t.t('auc.lot', { title: a.listingTitle ?? t.t('auc.listingGone'), qty: qtyText(a.quantity), unit })}</h1>
        <p className="kv-field__hint">{t.t(statusKey(a.status))} · {t.t('auc.live.endsAt', { at: when(a.endsAt) })}</p>
      </div>
      <p>
        <strong>{a.auctionNo}</strong> · {t.t(kindKey(a.kind))} · {t.t('auc.live.start', { price: perUnit(a.startPriceMinor) })}
        {' · '}{a.reservePriceMinor ? t.t('auc.reserve', { price: perUnit(a.reservePriceMinor) }) : a.reserveHidden ? t.t('auc.reserveHidden') : t.t('auc.noReserve')}
        {a.hasReserve && a.reserveMet !== null && a.reserveMet !== undefined && <> {t.t(a.reserveMet ? 'auc.live.reserveMet' : 'auc.live.reserveNotMet')}</>}
        {' · '}{t.t('auc.live.increment', { price: perUnit(a.minIncrementMinor) })} · {emdText}
        {' · '}{t.t('auc.live.antiSnipe', { add: String(a.autoExtendSecs ?? 120), last: String(a.extendTriggerSecs ?? 60) })}
      </p>
      <p className="kv-field__hint">{t.t(live ? 'auc.live.refreshes' : 'auc.live.notLive')}</p>
      {a.entryPaused && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.live.entryPausedNote')}</p></div>}
      {acts.length > 0 && <p className="kv-actions">{acts.map((act) => <Link key={act} href={actHref(a!.auctionId, act)} className={act === 'cancel' ? 'kv-btn kv-btn--danger' : 'kv-btn kv-btn--muted'}>{t.t(`auc.act.${act}`)}</Link>)}</p>}
      {!live && a.status !== 'scheduled' && <p><Link href={settleHref(a.auctionId)} className="kv-btn--link">{t.t('auc.row.review')}</Link></p>}

      <h2>{t.t('auc.live.standing')}</h2>
      <dl className="kv-tiles">
        <div className="kv-tile"><dt>{t.t('auc.live.kpi.highest')}</dt>
          <dd><strong>{a.sealedHidden ? t.t('auc.sealedUntilClose') : a.highBidMinor ? perUnit(a.highBidMinor) : t.t('auc.noBids')}</strong></dd>
          {a.highLotValueMinor && <dd className="kv-field__hint">{t.t('auc.live.kpi.lotValue', { value: money(a.highLotValueMinor) })}</dd>}</div>
        <div className="kv-tile"><dt>{t.t('auc.live.kpi.timeLeft')}</dt><dd><strong>{live ? left.text : t.t('auc.live.kpi.closed')}</strong></dd>
          <dd className="kv-field__hint">{a.extensionCount === 0 ? t.t('auc.live.kpi.noExtensions') : t.t('auc.live.kpi.extensions', { n: n(a.extensionCount) })}</dd></div>
        <div className="kv-tile"><dt>{t.t('auc.live.kpi.bidders')}</dt><dd><strong>{n(a.bidderCount ?? 0)}</strong></dd>
          <dd className="kv-field__hint">{a.emdHeldMinor !== null ? t.t('auc.live.kpi.emdHeld', { amount: money(a.emdHeldMinor) }) : t.t('auc.live.kpi.emdPrivate')}</dd>
          <dd className="kv-field__hint">{t.t('auc.qualificationNotChecked')}</dd></div>
      </dl>

      <h2>{t.t('auc.live.stream')}</h2>
      {streamState ? <p className="kv-field__hint">{t.t(streamState === 'restricted' ? 'auc.live.streamRestricted' : 'auc.live.streamError')}</p>
        : !stream || stream.items.length === 0 ? <p className="kv-field__hint">{t.t('auc.noBids')}</p> : (
        <table className="kv-table">
          <thead><tr><th scope="col">{t.t('auc.bid.amount')}</th><th scope="col">{t.t('auc.bid.bidder')}</th><th scope="col">{t.t('auc.bid.notes')}</th><th scope="col">{t.t('auc.bid.time')}</th></tr></thead>
          <tbody>{stream.items.map((b) => (
            <tr key={b.id}>
              <td>{b.amountMinor === null ? t.t('auc.sealed') : perUnit(b.amountMinor)}{b.lotValueMinor && <div className="kv-field__hint">{t.t('auc.lotValue', { value: money(b.lotValueMinor) })}</div>}</td>
              <td>{b.bidderLabel}{b.isMine && ` · ${t.t('auc.bid.you')}`}{b.bidderShortName && ` · ${b.bidderShortName}`}{b.bidderPhoneMasked && ` · ${b.bidderPhoneMasked}`}</td>
              <td>{b.isHighest && <strong>{t.t('auc.bid.highest')} </strong>}
                {b.reserveMet === true && a!.hasReserve && <span className="kv-field__hint">{t.t('auc.bid.reserveMet')}</span>}
                {b.reserveMet === false && <span className="kv-field__hint">{t.t('auc.bid.belowReserve')}</span>}</td>
              <td>{b.createdAt ? clock(b.createdAt) : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="kv-field__hint">{t.t('auc.live.streamNote')}</p>

      <h2>{t.t('auc.live.integrity')}</h2>
      <ul className="kv-list">
        <li>{t.t('auc.live.integrity.ip')}</li>
        <li>{a.emdHeldMinor !== null ? t.t('auc.live.integrity.emd', { amount: money(a.emdHeldMinor) }) : t.t('auc.live.kpi.emdPrivate')}</li>
        <li>{t.t('auc.live.integrity.masked', { n: n(stream?.bidders ?? a.bidderCount ?? 0) })}</li>
      </ul>

      <div className="kv-card">
        <h2>{t.t('auc.live.sellerView')}</h2>
        <p>{t.t(a.requiresSellerApproval ? 'auc.live.sellerApproval' : 'auc.live.sellerAuto', { hours: String(a.decisionWindowHours ?? 24) })}</p>
        <p className="kv-field__hint">{t.t('auc.live.voiceNotBuilt')}</p>
      </div>
      <div className="kv-card">
        <h2>{t.t('auc.live.emergency')}</h2>
        <p>{t.t('auc.live.emergencyBody')}</p>
        <p className="kv-field__hint">{t.t('auc.live.emergencyFoot')}</p>
        {!acts.includes('cancel') && <p className="kv-field__hint">{t.t('auc.live.readMostly')}</p>}
      </div>
    </section>
  );
}
