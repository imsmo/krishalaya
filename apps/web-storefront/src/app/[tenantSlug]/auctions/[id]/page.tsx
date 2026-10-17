// apps/web-storefront/src/app/[tenantSlug]/auctions/[id]/page.tsx · PC-56 STORE-2c · C6 — canon W278, the auction, under the ORGANISATION's chrome
// (the platform's /auctions/[id] redirects here). Dynamic, server-rendered.
//
// What was true (survey C-3 / F-23): the page read the AuthGuard auction route anonymously and ALWAYS said "couldn't load"; it printed the
// reserve AMOUNT; it computed the minimum next bid and the lot total in the browser; `env.featureAuctions` defaulted ON over a DB flag that is
// OFF. Now:
//   • the `auctions` flag (the DB's, via `storefront.flags`) decides — OFF is said honestly (and the public read answers 404 behind it);
//   • every figure is the SERVER's (`storefront.auction` — apps/api auction-public.read-model.ts): the current bid, the minimum next bid, the lot
//     total for each, the countdown from `endsAt` with the server's anti-snipe seconds, the EMD rule as the API holds it;
//   • the reserve as MET / NOT MET only (founder 2a D1); the bid history as time + amount, NO bidder identity at all;
//   • the states from the read: no bids / leading / outbid (a signed-in buyer of THIS store whose best bid is not the top) / won (an order was
//     created; it is paid by balance within the window the API states — never "by tomorrow 18:00") / ended / scheduled / connection lost →
//     Retry / flagged off / loading (the route's loading.tsx);
//   • the bid form only with a session; the canon claims this build does not make, refused by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import type { PublicAuction, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../../lib/api-client';
import { resolveSessionToken } from '../../../../lib/session';
import { getSessionTenant } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { auctionState, emdRule } from '../../../../features/store2c/auction';
import { payHref } from '../../../../features/store2c/checkout';
import { Countdown, type CountdownLabels } from '../../../../components/Countdown';
import { SubmitButton } from '../../../../components/SubmitButton';
import { RefusalList } from '../../../../components/RefusalList';
import { placeBidAction, toggleWatchAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auctions.detailTitle'), robots: { index: false, follow: true } };
}

const BID_STATUS_KEYS: Record<string, string> = {
  bid: 'store2c.auction.status.bid', too_low: 'store2c.auction.status.tooLow', ended: 'store2c.auction.status.ended', leading: 'store2c.auction.status.leading',
  emd: 'store2c.auction.status.emd', paused: 'store2c.auction.status.paused', seller: 'store2c.auction.status.seller', bad_amount: 'store2c.auction.status.badAmount',
  failed: 'store2c.auction.status.failed', watched: 'auctions.watchOn', unwatched: 'auctions.watchOff', watch_err: 'auctions.watchError',
  sealed_raise: 'store3c.bid.sealedRaise',   // PC-56 STORE-3c · B2 (founder D1)
};

export default async function TenantAuctionPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const id = params.id;
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;
  const self = `/${encodeURIComponent(slug)}/auctions/${encodeURIComponent(id)}`;

  // the DB flag decides (survey F-11 / C-3): OFF → the honest state, never a broken page
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags && flags.auctions !== true) {
    return (
      <section className="kv-auction" data-kv-auction="off">
        <h1>{t.t('auctions.detailTitle')}</h1>
        <div className="kv-state" role="status" data-kv-state="auctions-off"><p>{t.t('store2c.auction.off', { org })}</p></div>
        <RefusalList surface="auction" />
      </section>
    );
  }

  // a session of THIS organisation adds the viewer's own facts (their best bid, leading, won + the order); any other session reads anonymously
  const token = await resolveSessionToken();
  const ownStore = !!token && shell.kind === 'ok' && getSessionTenant() === shell.tenant.tenantId;
  let v: PublicAuction | null = null; let notFound = false;
  try { v = ownStore ? await serverClient(slug).storefront.auction(id, { withSession: true }) : await publicClient(slug).storefront.auction(id); }
  catch (e) { notFound = e instanceof SdkError && e.isNotFound; v = null; }
  if (!v) {
    return (
      <section className="kv-auction">
        <h1>{t.t('auctions.detailTitle')}</h1>
        {notFound ? <p className="kv-detail__muted" data-kv-state="not-found">{t.t('store2c.auction.notFound')}</p> : (
          // "Connection lost mid-auction": the last accepted bid stands on the server; Retry re-reads the true state before any new bid
          <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
            <p>{t.t('store2c.auction.lost')}</p>
            <a href={reloadHref(self, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        )}
        <RefusalList surface="auction" />
      </section>
    );
  }

  const money = (minor: string | null) => (minor ? moneyText(minor, v!.currencyCode, lang) : null) ?? t.t('money.unavailable');
  const state = auctionState(v);
  const emd = emdRule(v.emd);
  const unit = v.lot.unitCode;
  const cd: CountdownLabels = { ended: t.t('auctions.ended'), d: t.t('auctions.cd.d'), h: t.t('auctions.cd.h'), m: t.t('auctions.cd.m'), s: t.t('auctions.cd.s') };
  const statusKey = searchParams.status ? BID_STATUS_KEYS[searchParams.status] : undefined;
  const bidKey = randomUUID();   // minted at render: a double tap of THIS form is one bid

  return (
    <section className="kv-auction" data-kv-auction-state={state}>
      <h1>{v.lot.title}</h1>
      <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('store2c.auction.lotOf', { org: v.lot.organisation?.name ?? org, qty: v.lot.quantity, unit })}</p>
      {statusKey && <p className={searchParams.status === 'bid' || searchParams.status === 'watched' || searchParams.status === 'unwatched' ? 'kv-form__notice' : 'kv-form__error'} role="status" data-kv-bid-status={searchParams.status}>{t.t(statusKey)}</p>}

      <p className="kv-auction__reserve" data-kv-reserve={v.reserveMet ? 'met' : 'not-met'}>{t.t(v.reserveMet ? 'store2c.auction.reserveMet' : 'store2c.auction.reserveNotMet')}</p>

      <dl className="kv-offer__facts">
        <div><dt>{t.t('auctions.currentBid')}</dt><dd data-kv-current="">{v.currentBidMinor ? t.t('store2c.auction.perUnit', { price: money(v.currentBidMinor), unit }) : t.t(v.sealedHidden ? 'store2c.auction.sealed' : 'store2c.auction.noBids')}</dd></div>
        {v.lotTotalMinor && <div><dt>{t.t('store2c.auction.lotTotal')}</dt><dd data-kv-lot-total="">{money(v.lotTotalMinor)}</dd></div>}
        <div><dt>{t.t('auctions.minNext')}</dt><dd data-kv-min-next="">{t.t('store2c.auction.perUnit', { price: money(v.minNextBidMinor), unit })} · {t.t('store2c.auction.forLot', { total: money(v.minNextLotTotalMinor) })}</dd></div>
        {emd && <div><dt>{t.t('auctions.emd')}</dt><dd data-kv-emd={emd.kind}>{emd.kind === 'flat' ? money(emd.minor) : t.t('store2c.auction.emdPct', { pct: emd.pct })}</dd></div>}
        {v.isOpen && <div><dt>{t.t('auctions.endsIn')}</dt><dd><Countdown endsAt={v.endsAt} labels={cd} /></dd></div>}
      </dl>
      {v.isOpen && <p className="kv-field__hint" data-kv-anti-snipe="">{t.t('store2c.auction.antiSnipe', { trigger: String(v.antiSnipe.triggerSec), extend: String(v.antiSnipe.extendSec) })}</p>}

      {/* the canon's states */}
      {state === 'no_bids' && <p className="kv-detail__muted" data-kv-state="no-bids">{t.t('store2c.auction.state.noBids')}</p>}
      {state === 'leading' && <p className="kv-form__notice" role="status" data-kv-state="leading">{t.t('store2c.auction.state.leading', { price: money(v.viewer?.bestBidMinor ?? null) })}</p>}
      {state === 'outbid' && <p className="kv-form__error" role="status" data-kv-state="outbid">{t.t('store2c.auction.state.outbid', { mine: money(v.viewer?.bestBidMinor ?? null), next: money(v.minNextBidMinor) })}</p>}
      {state === 'won' && (
        <div className="kv-form__notice" role="status" data-kv-state="won">
          <p>{t.t('store2c.auction.state.won', { price: money(v.currentBidMinor), hours: String(v.balanceDueHours) })}</p>
          {/* PC-56 STORE-3c · C4 (founder D2): the balance is paid end to end — THIS store's pay step (charging the DUE) and the order under its chrome */}
          {v.viewer?.orderId && v.status === 'settled' && <p><Link href={payHref(slug, v.viewer.orderId)} className="kv-btn" data-kv-pay-balance={v.viewer.orderId}>{t.t('store3c.won.pay')}</Link></p>}
          {v.viewer?.orderId && <p><Link href={`/${encodeURIComponent(slug)}/orders/${encodeURIComponent(v.viewer.orderId)}`} className="kv-link">{t.t('store2c.auction.seeOrder')}</Link></p>}
          {v.viewer?.orderId && <p><Link href={`/${encodeURIComponent(slug)}/auctions/bids`} className="kv-btn--link" data-kv-nav="my-bids">{t.t('store3c.bids.title')}</Link></p>}
        </div>
      )}
      {state === 'ended' && <p className="kv-detail__muted" data-kv-state="ended">{t.t('auctions.endedNote')}</p>}
      {state === 'scheduled' && <p className="kv-detail__muted" data-kv-state="scheduled">{t.t('store2c.auction.state.scheduled')}</p>}

      {v.isOpen && state !== 'scheduled' && (ownStore ? (
        <form action={placeBidAction} className="kv-auction__bid" data-kv-form="bid">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="auctionId" value={v.auctionId} />
          <input type="hidden" name="idempotencyKey" value={bidKey} />
          <label htmlFor="bid-amount" className="kv-field__label">{t.t('store2c.auction.bidLabel', { unit })}</label>
          <input id="bid-amount" name="amount" type="text" inputMode="decimal" className="kv-field__input kv-actions__qty" required />
          <SubmitButton idle={t.t('auctions.placeBid')} busy={t.t('store2c.auction.placing')} className="kv-btn kv-btn--money" />
          <p className="kv-field__hint">{emd ? t.t(emd.kind === 'flat' ? 'store2c.auction.emdRuleFlat' : 'store2c.auction.emdRulePct', emd.kind === 'flat' ? { amount: money(emd.minor) } : { pct: emd.pct }) : t.t('store2c.auction.emdNone')}</p>
          <p className="kv-field__hint">{t.t('store2c.auction.commitment')}</p>
          {v.kind === 'sealed' && <p className="kv-field__hint" data-kv-sealed-raise="">{t.t('store3c.sealed.raiseOnly')}</p>}
        </form>
      ) : (
        <p data-kv-bid="signin"><a href={`/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(self)}`} className="kv-btn">{t.t('store2c.auction.signinToBid', { org })}</a></p>
      ))}
      {ownStore && v.isOpen && (
        <form action={toggleWatchAction} className="kv-auction__watch">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="auctionId" value={v.auctionId} />
          <input type="hidden" name="intent" value="watch" />
          <button type="submit" className="kv-btn kv-btn--ghost">{t.t('auctions.watch')}</button>
        </form>
      )}

      <section className="kv-order__section" aria-labelledby="hist-h" data-kv-history={v.bids.length}>
        <h2 id="hist-h">{t.t('auctions.history')}</h2>
        {v.bids.length === 0 ? <p className="kv-detail__muted">{t.t('store2c.auction.state.noBids')}</p> : (
          <ul className="kv-confirm__items">
            {v.bids.map((b, i) => (
              <li key={`${b.at}-${i}`} className="kv-confirm__item">
                <span>{new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(b.at))}</span>
                <span>{b.amountMinor ? t.t('store2c.auction.perUnit', { price: money(b.amountMinor), unit }) : t.t('auctions.sealedBid')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="kv-field__hint">{t.t('store2c.auction.historyNote', { count: String(v.bidCount) })}</p>
      </section>
      <RefusalList surface="auction" />
      <p><Link href={`/${encodeURIComponent(slug)}`} className="kv-btn--link">{t.t('store2c.browseStore', { org })}</Link></p>
    </section>
  );
}
