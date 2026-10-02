// apps/web-tenant/src/app/marketplace/auctions/[id]/settle/page.tsx · W139 · THE SETTLEMENT · PC-56 TENANT-11a.
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the header: kind · when it ended · how many bids · the reserve (per unit, the seller's and the desk's) met or not ·
//     while awaiting approval, "the seller must decide by <decision_due_at> or the auction lapses to ended (no sale, EMDs
//     released)" — the server's clock (SellerDecisionLapseJob), which a view failure cannot lapse early;
//   • the bids table — sealed bids opened at close — per unit, the bidder as B1…Bn (+ masked phone + short name for the
//     seller and the desk after close), the EMD each held (seller / desk) and "below reserve — cannot win"; the canon's
//     "kyc verified · 12 prior wins, 0 defaults" is REFUSED BY NAME (bidder qualification is not recorded);
//   • the breakdown: Order value = quantity × hammer (server-computed), Winner EMD applied, Balance due from the winner and
//     its 48 h deadline — the settlement row once settled; the same arithmetic previewed from the winning bid while the
//     seller decides (the server computes the real one at approval);
//   • "Approve — create order" → the mutate chain (the seller, or the desk with the seller's recorded consent; idempotent);
//   • "Record decline (reason to bidders)" → the decline form chain W2341–W2344;
//   • the default rule in the code's words — the EMD is forfeited to the seller, the order cancelled, the lot re-listed;
//     "the seller may offer to the next bidder at their bid" is NOT BUILT and printed as such.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuctionDetail, BidStreamPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { auditHref } from '../../../../../features/forms/chain';
import { AUCTIONS_HREF, actHref, consoleState, declineHref, isUuid, kindKey, liveHref, outcomeKey, qtyText, statusKey } from '../../../../../features/auctions/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.settle.title'), robots: { index: false, follow: false } };
}

export default async function AuctionSettlePage({ params }: { params: { id: string } }) {
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(params.id)}/settle`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const crumbs = (label: string) => (
    <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}>
      <Link href={AUCTIONS_HREF}>{t.t('auc.breadcrumb.auctions')}</Link> / <span aria-current="page">{label}</span>
    </nav>
  );
  const notice = (state: string) => (
    <section>{crumbs(t.t('auc.settle.title'))}<h1>{t.t('auc.settle.title')}</h1>
      <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
        <strong>{t.t(`auc.settle.state.${state}.title`)}</strong><p>{t.t(`auc.settle.state.${state}.body`)}</p>
        <p>{state === 'error' ? <Link href={base} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('auc.retry')}</Link>
          : <Link href={AUCTIONS_HREF} className="kv-btn--link">{t.t('auc.backToAuctions')}</Link>}</p>
      </div></section>
  );
  if (!env.featureAuctions) return notice('flaggedOff');
  if (!isUuid(params.id)) return notice('nothing');

  let a: AuctionDetail | null = null; let stream: BidStreamPage | null = null; let state: string | null = null;
  try { a = await tenantClient().auctions.get(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; const s = consoleState(err?.code, err?.status, true, err?.details); state = s === 'notFound' ? 'nothing' : s; }
  if (state || !a) return notice(state ?? 'error');
  if (a.status === 'scheduled' || a.status === 'live' || a.status === 'extended') return notice('nothing');
  try { stream = await tenantClient().auctions.listBids(params.id, { limit: 100 }); } catch { stream = null; }

  const unit = a.unitCode ?? '';
  const perUnit = (m: string | null | undefined) => t.t('auc.perUnit', { price: money(m), unit });
  const s = a.settlement;
  const awaiting = a.status === 'awaiting_approval';
  // while the seller decides: what approval would write — the API's own arithmetic (settlementPreview), never computed here
  const winning = stream?.items.find((b) => b.id === a!.winningBidId) ?? null;
  const pv = awaiting ? a.settlementPreview : null;
  const can = a.viewerCan;
  // highest first — a numeric compare of the minor-unit strings, no arithmetic
  const sorted = [...(stream?.items ?? [])].sort((x, y) => (y.amountMinor ?? '0').localeCompare(x.amountMinor ?? '0', 'en', { numeric: true }));

  return (
    <section>
      {crumbs(t.t('auc.settle.crumb', { no: a.auctionNo ?? a.auctionId.slice(0, 8) }))}
      <div className="kv-page-head">
        <h1>{t.t('auc.lot', { title: a.listingTitle ?? t.t('auc.listingGone'), qty: qtyText(a.quantity), unit })}</h1>
        <p className="kv-field__hint">{t.t(statusKey(a.status))}</p>
      </div>
      <p>
        <strong>{a.auctionNo}</strong> · {t.t(kindKey(a.kind))} · {t.t('auc.endedAt', { at: when(a.endedAt ?? a.endsAt) })}
        {' · '}{t.t('auc.settle.bidsCount', { n: n(stream?.items.length ?? 0) })}
        {a.reservePriceMinor && <> · {t.t('auc.reserve', { price: perUnit(a.reservePriceMinor) })} {t.t(a.reserveMet ? 'auc.live.reserveMet' : 'auc.live.reserveNotMet')}</>}
      </p>
      {awaiting && a.decisionDueAt && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.settle.decideBy', { at: when(a.decisionDueAt) })}</p></div>}
      {a.status === 'ended' && a.lapsedAt && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.settle.lapsed', { at: when(a.lapsedAt) })}</p></div>}
      {a.status === 'failed_reserve' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.settle.failedReserve')}</p></div>}
      {a.status === 'cancelled' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.settle.cancelled', { reason: a.cancelReason ?? t.t('auc.settle.noReasonRecorded') })}</p></div>}
      {a.status === 'defaulted' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.settle.defaulted')}</p></div>}

      <h2>{t.t(a.kind === 'sealed' ? 'auc.settle.sealedBids' : 'auc.settle.bids')}</h2>
      {!stream ? <p className="kv-field__hint">{t.t('auc.live.streamError')}</p> : sorted.length === 0 ? <p className="kv-field__hint">{t.t('auc.noBids')}</p> : (
        <table className="kv-table">
          <caption className="kv-detail__muted">{t.t('auc.settle.shown', { n: n(sorted.length) })}</caption>
          <thead><tr><th scope="col">{t.t('auc.bid.amount')}</th><th scope="col">{t.t('auc.bid.bidder')}</th><th scope="col">{t.t('auc.bid.emd')}</th><th scope="col">{t.t('auc.bid.qualification')}</th></tr></thead>
          <tbody>{sorted.map((b) => (
            <tr key={b.id}>
              <td>{b.amountMinor === null ? t.t('auc.sealed') : perUnit(b.amountMinor)}{b.id === a!.winningBidId && <strong> · {t.t('auc.settle.winning')}</strong>}</td>
              <td>{b.bidderLabel}{b.isMine && ` · ${t.t('auc.bid.you')}`}{b.bidderShortName && ` · ${b.bidderShortName}`}{b.bidderPhoneMasked && ` · ${b.bidderPhoneMasked}`}</td>
              <td>{b.emdMinor === null || b.emdMinor === undefined ? <span className="kv-field__hint">{t.t('auc.live.kpi.emdPrivate')}</span> : t.t('auc.settle.emdHeld', { amount: money(b.emdMinor) })}</td>
              <td>{b.reserveMet === false ? <strong>{t.t('auc.settle.belowReserve')}</strong> : <span className="kv-field__hint">{t.t('auc.qualificationNotChecked')}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <div className="kv-card">
        <h2>{s ? t.t('auc.settle.breakdown') : t.t('auc.settle.ifApproved', { price: winning?.amountMinor ? perUnit(winning.amountMinor) : '' })}</h2>
        {s ? (
          <dl className="kv-detail">
            <dt>{t.t('auc.settle.orderValue', { qty: qtyText(s.quantity), unit: s.unitCode, price: perUnit(s.hammerUnitMinor) })}</dt><dd>{money(s.orderValueMinor)}</dd>
            <dt>{t.t('auc.settle.emdApplied')}</dt><dd>−{money(s.emdAppliedMinor)}</dd>
            <dt>{t.t(s.collection === 'online' ? 'auc.settle.balanceOnline' : 'auc.settle.balanceOffline')}</dt><dd>{money(s.balanceDueMinor)} · {t.t('auc.settle.dueBy', { at: when(s.balanceDueAt) })}</dd>
            <dt>{t.t('auc.settle.outcome')}</dt><dd>{t.t(outcomeKey(s.outcome))}</dd>
          </dl>
        ) : pv ? (
          <dl className="kv-detail">
            <dt>{t.t('auc.settle.orderValue', { qty: qtyText(a.quantity), unit, price: perUnit(pv.hammerUnitMinor) })}</dt><dd>{money(pv.orderValueMinor)}</dd>
            <dt>{t.t('auc.settle.emdApplied')}</dt><dd>−{money(pv.emdAppliedMinor)}</dd>
            <dt>{t.t('auc.settle.balanceIn48')}</dt><dd>{money(pv.balanceDueMinor)}</dd>
          </dl>
        ) : <p className="kv-field__hint">{t.t(awaiting ? 'auc.live.kpi.emdPrivate' : 'auc.settle.noSale')}</p>}
        <p className="kv-field__hint">{t.t('auc.settle.atomicNote')}</p>
        <p className="kv-field__hint">{t.t('auc.settle.defaultRule')}</p>
        <p className="kv-field__hint">{t.t('auc.settle.nextBidderNotBuilt')}</p>
        {awaiting && can?.decide && <p className="kv-actions"><Link href={actHref(a.auctionId, 'approve')} className="kv-btn kv-btn--primary">{t.t('auc.act.approve')}</Link></p>}
        {awaiting && can?.decide && <p className="kv-field__hint">{t.t(can.decideNeedsConsent ? 'auc.settle.approveFootStaff' : 'auc.settle.approveFootSeller')}</p>}
        {awaiting && !can?.decide && <p className="kv-field__hint">{t.t('auc.settle.state.restricted.body')}</p>}
        {s && <p><Link href={auditHref('auction', a.auctionId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
      </div>

      {awaiting && (
        <div className="kv-card">
          <h2>{t.t('auc.settle.ifDeclines')}</h2>
          <p>{t.t('auc.settle.declineBody', { value: pv ? money(pv.orderValueMinor) : t.t('auc.live.kpi.emdPrivate') })}</p>
          {can?.decide && <p><Link href={`${declineHref(a.auctionId)}?step=edit`} className="kv-btn kv-btn--muted">{t.t('auc.settle.recordDecline')}</Link></p>}
        </div>
      )}
      <p><Link href={liveHref(a.auctionId)} className="kv-btn--link">{t.t('auc.row.monitor')}</Link></p>
    </section>
  );
}
