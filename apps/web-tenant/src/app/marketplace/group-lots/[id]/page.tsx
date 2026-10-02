// apps/web-tenant/src/app/marketplace/group-lots/[id]/page.tsx · W136 · GROUP LOT DETAIL · PC-56 TENANT-11c.
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • header: product — target · status · % · GL number · coordinator (short name) + fee (bps = %) · deadline · members pledged;
//   • "Extend deadline (once)" and "Nudge non-pledgers" → the mutate chain W2633–W2635, each with a reason, offered only when the
//     API's `viewerCan` says so; the Gujarati VOICE nudge is refused by name (the nudge is a notification through the existing
//     channels, and the screen says who it reaches: members with this crop on record who have not pledged);
//   • the pledges table (A6): Member (short name · masked phone) · Pledged · KYC (the producer role's, from 9a) · Pledged at —
//     the coordinator's and tenant_admin's view; three rows, then "+ N more members · Q · all verified" (printed only from real
//     KYC rows). A MEMBER sees the lot's progress and their own pledge — the table is "restricted", said so, never faked;
//   • "Add my pledge" / pledge FOR a member (a member picker, never a UUID) → the pledge form chain; withdraw my pledge (until
//     the lot lists) → the mutate chain;
//   • the settlement panel: once the lot is SOLD, Prepare (no money) → the prepared shares (member · pledged · share · the fee
//     line) → Confirm (the second person only; the maker is named) / Refuse; after the confirm, what was paid;
//   • "Why pooling pays": a figure only from ≥ 3 confirmed pooled sales of this crop in this tenant, else the canon's honest
//     sentence; the solo estimate is refused by name;
//   • the coordinator options panel (extend once / list at the pledged quantity / cancel with a reason) as real acts;
//   • states: Loading, Flagged off, Couldn't load (+ Retry), Not found, "Coordinator tools locked" (distinct from a load error).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { GroupLotDetail, GroupLotPledge } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import {
  GROUP_LOTS_HREF, actHref, auctionHref, bpsPct, cancelReasonKey, collapse, consoleState, isUuid, kycKey, listingHref, lotHref, pledgeHref, progressPct, qtyText, statusKey,
} from '../../../../features/group-lots/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.detailTitle'), robots: { index: false, follow: false } };
}

export default async function GroupLotDetailPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const self = lotHref(params.id);
  await requireSession(self);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const showAll = searchParams.all === '1';
  const crumbs = (label: string) => (
    <nav className="kv-breadcrumb" aria-label={t.t('gl.breadcrumb')}>
      <Link href="/listings">{t.t('gl.breadcrumb.marketplace')}</Link> / <Link href={GROUP_LOTS_HREF}>{t.t('gl.breadcrumb.groupLots')}</Link> / <span aria-current="page">{label}</span>
    </nav>
  );
  const flaggedOff = <section>{crumbs(t.t('gl.detailTitle'))}<h1>{t.t('gl.detailTitle')}</h1>
    <div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.state.flaggedOffDetail.title')}</strong><p>{t.t('gl.state.flaggedOff.body')}</p></div></section>;
  if (!env.featureGroupLots) return flaggedOff;

  let lot: GroupLotDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { lot = await tenantClient().groupLots.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  }
  if (state === 'flaggedOff') return flaggedOff;
  if (!lot) {
    return (
      <section>{crumbs(t.t('gl.detailTitle'))}<h1>{t.t('gl.detailTitle')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`gl.detailState.${state ?? 'error'}.title`)}</strong><p>{t.t(`gl.detailState.${state ?? 'error'}.body`)}</p>
          {state === 'error' && <p><Link href={self} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.retry')}</Link></p>}
        </div>
      </section>
    );
  }

  const can = lot.viewerCan;
  const unit = lot.unitCode;
  const q = (x: string | null | undefined) => `${qtyText(x)} ${unit}`;
  const pledges: GroupLotPledge[] = lot.pledges ?? [];
  const active = pledges.filter((p) => p.status === 'active');
  const { head, rest } = showAll ? { head: active, rest: null } : collapse(active);
  const below = !!lot.targetQuantity && lot.progressBps < 10000;
  const st = lot.settlement;

  return (
    <section>
      {crumbs(lot.lotNo ?? t.t('gl.detailTitle'))}
      <div className="kv-page-head">
        <h1>{t.t('gl.header.title', { product: lot.productName ?? t.t('gl.productUnknown'), target: q(lot.targetQuantity) })}</h1>
        <p className="kv-actions">
          {can.extend && <Link href={actHref(lot.id, 'extend')} className="kv-btn kv-btn--muted">{t.t('gl.act.extend')}</Link>}{' '}
          {can.nudge && <Link href={actHref(lot.id, 'nudge')} className="kv-btn kv-btn--muted">{t.t('gl.act.nudge')}</Link>}
        </p>
      </div>
      <p>{t.t(statusKey(lot.status))} · {progressPct(lot.progressBps)}%</p>
      <p className="kv-field__hint">{t.t('gl.header.facts', {
        lotNo: lot.lotNo ?? '', coordinator: lot.coordinatorShortName ?? t.t('gl.nameNotRecorded'), bps: String(lot.coordinationFeeBps), pct: bpsPct(lot.coordinationFeeBps),
        deadline: when(lot.pledgeDeadline), members: n(lot.memberCount ?? 0) })}</p>
      {lot.extendedOnce && lot.originalDeadline && <p className="kv-field__hint">{t.t('gl.header.extended', { from: when(lot.originalDeadline) })}</p>}
      {lot.status === 'ready' && lot.readyReason && <p className="kv-field__hint">{t.t('gl.header.readyReason', { reason: lot.readyReason })}</p>}
      {lot.status === 'cancelled' && <p className="kv-card kv-card--notice">{t.t('gl.header.cancelled', { reason: lot.cancelReasonText ?? t.t(cancelReasonKey(lot.cancelReasonCode)) })}</p>}
      {lot.listing && <p>{lot.auction
        ? <Link href={auctionHref(lot.auction.id)} className="kv-btn--link">{t.t('gl.header.auction', { no: lot.auction.auctionNo, at: when(lot.auction.endsAt) })}</Link>
        : <Link href={listingHref(lot.listing.id)} className="kv-btn--link">{t.t('gl.header.listing')}</Link>}</p>}
      {lot.status === 'sold' && lot.grossProceedsMinor && <p className="kv-card kv-card--notice">{t.t('gl.header.sold', { gross: money(lot.grossProceedsMinor) })}</p>}
      {can.nudge || can.coordinate ? <p className="kv-field__hint">{t.t('gl.nudge.audience')} {t.t('gl.nudge.voiceRefused')}</p> : null}
      {lot.nudge.nextAt && can.coordinate && <p className="kv-field__hint">{t.t('gl.nudge.nextAt', { at: when(lot.nudge.nextAt) })}</p>}

      {/* ---- my pledge (every member) ---- */}
      <div className="kv-card">
        <h2>{t.t('gl.mine.title')}</h2>
        {lot.myPledge ? <p>{t.t(`gl.mine.${lot.myPledge.status}`, { qty: q(lot.myPledge.quantity), at: when(lot.myPledge.createdAt) })}
          {lot.myPledge.settledShareMinor && <> · {t.t('gl.mine.share', { share: money(lot.myPledge.settledShareMinor) })}</>}</p>
          : <p className="kv-field__hint">{t.t('gl.mine.none')}</p>}
        <p className="kv-actions">
          {can.pledgeSelf && <Link href={pledgeHref(lot.id)} className="kv-btn kv-btn--sm">{t.t('gl.addMyPledge')}</Link>}{' '}
          {can.withdraw && <Link href={actHref(lot.id, 'withdraw')} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.act.withdraw')}</Link>}
        </p>
        <p className="kv-field__hint">{t.t('gl.promiseNote')}</p>
      </div>

      {/* ---- the pledges table (coordinator / tenant_admin) ---- */}
      <h2 className="kv-section-title">{t.t('gl.pledges.title', { n: n(lot.summary?.activeCount ?? lot.memberCount ?? 0) })}</h2>
      {lot.pledgesRestricted ? (
        <div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.locked.title')}</strong><p>{t.t('gl.locked.body')}</p></div>
      ) : active.length === 0 ? (
        <div className="kv-card"><strong>{t.t('gl.pledges.empty.title')}</strong><p className="kv-detail__muted">{t.t('gl.pledges.empty.body')}</p>
          {can.pledgeSelf && <Link href={pledgeHref(lot.id)} className="kv-btn kv-btn--sm">{t.t('gl.addMyPledge')}</Link>}</div>
      ) : (
        <>
          <table className="kv-table">
            <caption className="kv-detail__muted">{t.t('gl.pledges.showing', { n: n(head.length), m: n(active.length), total: q(lot.summary?.activeQuantity) })}</caption>
            <thead><tr><th scope="col">{t.t('gl.pledges.col.member')}</th><th scope="col">{t.t('gl.pledges.col.pledged')}</th><th scope="col">{t.t('gl.pledges.col.kyc')}</th><th scope="col">{t.t('gl.pledges.col.at')}</th></tr></thead>
            <tbody>
              {head.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.memberShortName ?? t.t('gl.nameNotRecorded')}{p.memberPhoneMasked && <> · <span className="kv-field__hint">{p.memberPhoneMasked}</span></>}
                    {p.recordedByCoordinator && <div className="kv-field__hint">{t.t('gl.pledges.byCoordinator')}</div>}</th>
                  <td>{q(p.quantity)}</td>
                  <td>{t.t(kycKey(p.kycStatus))}</td>
                  <td>{when(p.createdAt)}</td>
                </tr>
              ))}
              {rest && (
                <tr><th scope="row"><Link href={`${self}?all=1`} className="kv-btn--link">{t.t('gl.pledges.more', { n: n(rest.count) })}</Link></th>
                  <td>{q(rest.quantity)}</td><td>{t.t(rest.allVerified ? 'gl.kyc.allVerified' : 'gl.kyc.notAllVerified')}</td><td /></tr>
              )}
            </tbody>
          </table>
          {lot.summary && lot.summary.allVerified !== null && <p className="kv-field__hint">{t.t(lot.summary.allVerified ? 'gl.pledges.allVerified' : 'gl.pledges.notAllVerified')}</p>}
          {(lot.summary?.withdrawnCount ?? 0) > 0 && <p className="kv-field__hint">{t.t('gl.pledges.withdrawn', { n: n(lot.summary!.withdrawnCount) })}</p>}
        </>
      )}
      {can.pledgeOnBehalf && <p><Link href={pledgeHref(lot.id, true)} className="kv-btn--link">{t.t('gl.pledgeForMember')}</Link></p>}

      {/* ---- why pooling pays (B) ---- */}
      <div className="kv-card">
        <h2>{t.t('gl.pooled.title')}</h2>
        {lot.pooled.available && lot.pooled.pooledPerUnitMinor
          ? <p>{t.t('gl.pooled.figure', { price: money(lot.pooled.pooledPerUnitMinor), unit, n: n(lot.pooled.basedOn ?? lot.pooled.needed) })}</p>
          : <p>{t.t(lot.pooled.salesCount === 0 ? 'gl.pooled.none' : 'gl.pooled.tooFew', { n: n(lot.pooled.salesCount), needed: n(lot.pooled.needed) })}</p>}
        <p className="kv-field__hint">{t.t('gl.pooled.soloRefused')}</p>
        <p className="kv-field__hint">{t.t('gl.pooled.splitNote')}</p>
      </div>

      {/* ---- the settlement (A3) ---- */}
      {(lot.status === 'sold' || lot.status === 'settled' || st) && (
        <div className="kv-card">
          <h2>{t.t('gl.settle.title')}</h2>
          {lot.grossProceedsMinor && <p>{t.t('gl.settle.held', { gross: money(lot.grossProceedsMinor) })}</p>}
          {!st && lot.status === 'sold' && <p className="kv-field__hint">{t.t('gl.settle.notPrepared')}</p>}
          {st && (
            <>
              <p>{t.t(`gl.settle.status.${st.status}`, { at: when(st.confirmedAt ?? st.refusedAt ?? st.preparedAt) })}{st.preparedByMe && <> · {t.t('gl.settle.youPrepared')}</>}</p>
              {st.status === 'refused' && st.refuseReason && <p className="kv-field__hint">{t.t('gl.settle.refusedReason', { reason: st.refuseReason })}</p>}
              <table className="kv-table">
                <thead><tr><th scope="col">{t.t('gl.settle.col.member')}</th><th scope="col">{t.t('gl.settle.col.pledged')}</th><th scope="col">{t.t('gl.settle.col.share')}</th></tr></thead>
                <tbody>
                  {st.lines.map((l) => (
                    <tr key={l.pledgeId}><th scope="row">{l.isMine ? t.t('gl.settle.you') : l.memberShortName ?? t.t('gl.nameNotRecorded')}</th><td>{q(l.quantity)}</td><td>{money(l.shareMinor)}</td></tr>
                  ))}
                  {!st.linesRestricted && <tr><th scope="row">{t.t('gl.settle.feeLine', { pct: bpsPct(st.feeBps) })}</th><td /><td>{money(st.feeMinor)}</td></tr>}
                  {!st.linesRestricted && <tr><th scope="row">{t.t('gl.settle.grossLine')}</th><td>{q(st.quantity)}</td><td><strong>{money(st.grossMinor)}</strong></td></tr>}
                </tbody>
              </table>
              {st.linesRestricted && <p className="kv-field__hint">{t.t('gl.settle.ownLineOnly')}</p>}
            </>
          )}
          <p className="kv-actions">
            {can.prepare && <Link href={actHref(lot.id, 'prepare')} className="kv-btn kv-btn--sm">{t.t('gl.act.prepare')}</Link>}{' '}
            {can.confirm && <Link href={actHref(lot.id, 'confirm')} className="kv-btn kv-btn--primary kv-btn--sm">{t.t('gl.act.confirm')}</Link>}{' '}
            {can.refuse && <Link href={actHref(lot.id, 'refuse')} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.act.refuse')}</Link>}
          </p>
          {can.confirmBlocked && <p className="kv-field__hint">{t.t(`gl.settle.blocked.${can.confirmBlocked}`)}</p>}
          <p className="kv-field__hint">{t.t('gl.settle.rule')}</p>
        </div>
      )}

      {/* ---- the coordinator's options ---- */}
      {can.coordinate ? (
        (lot.status === 'pledging' || lot.status === 'ready' || lot.status === 'listed') && (
          <div className="kv-card">
            <h2>{t.t('gl.options.title', { pct: progressPct(lot.progressBps) })}</h2>
            <ol>
              <li>{can.extend ? <Link href={actHref(lot.id, 'extend')} className="kv-btn--link">{t.t('gl.options.extend')}</Link> : <span className="kv-field__hint">{t.t(lot.extendedOnce ? 'gl.options.extendUsed' : 'gl.options.extendClosed')}</span>}</li>
              <li>{can.ready && <Link href={actHref(lot.id, 'ready')} className="kv-btn--link">{t.t(below ? 'gl.options.readyBelow' : 'gl.options.ready', { qty: q(lot.pledgedQuantity) })}</Link>}
                {can.list && <Link href={actHref(lot.id, 'list')} className="kv-btn--link">{t.t('gl.options.list', { qty: q(lot.pledgedQuantity) })}</Link>}
                {!can.ready && !can.list && <span className="kv-field__hint">{t.t('gl.options.listDone')}</span>}</li>
              <li>{can.cancel ? <Link href={actHref(lot.id, 'cancel')} className="kv-btn--link">{t.t('gl.options.cancel')}</Link> : <span className="kv-field__hint">{t.t('gl.options.cancelClosed')}</span>}</li>
            </ol>
            <p className="kv-field__hint">{t.t('gl.options.foot')}</p>
          </div>
        )
      ) : null /* a member already read "Coordinator tools locked" above, where the table would be */}
    </section>
  );
}
