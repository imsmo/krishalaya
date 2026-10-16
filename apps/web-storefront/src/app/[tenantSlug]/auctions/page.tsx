// apps/web-storefront/src/app/[tenantSlug]/auctions/page.tsx · PC-56 STORE-3c · C1 / C2 — canon W295 "Auctions", under the ORGANISATION's chrome
// (the platform's /auctions is a door — lib/store-door.ts). Dynamic, server-rendered.
//
// What was true (survey C-5 / 1H): the only list was the PLATFORM's page, which read the AuthGuard `GET /v1/auctions` anonymously (it always
// failed and said "no auctions are running"), hid behind a build-time switch (`env.featureAuctions`, DELETED), printed the start price as rupees
// and said "Lot (kind)". Now:
//   • the store's `auctions` flag is read FIRST (the DB decides, through the allow-list) — OFF → the honest state and NO list call (it would 404);
//   • the tabs Live · Upcoming · With my bids (a session of THIS store only) · Ended — the public list's groups (`storefront.auctions`, keyset
//     Next only, NO numbers in the tabs: the API serves none) and, for "With my bids", the caller's own per-auction read (`auctions.myBids`);
//   • each card: the lot title · quantity + unit · the ORGANISATION; the kind ("sealed — nobody sees anyone's number until close" is TRUE); the
//     status label (all nine statuses × three languages); "reserve met / not met" (never the amount); bidders (never bids, never a name); the
//     end (or the opening) with the server's anti-snipe seconds; the current bid and the minimum next bid AS SERVED (hidden while sealed); the
//     EMD as the API's rule; the per-status note (reserve not met → deposits released; awaiting → the organisation decides by its own deadline);
//     money in the DATA's currency; on the mine tab, "you're leading / you were outbid" from the read;
//   • empty ≠ error ≠ off: each says its own sentence; the error has a Retry that reloads (W3077–W3079 DECOR); the refusals by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { MyBid, PublicAuctionCard, StorefrontFlags } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../lib/api-client';
import { resolveSessionToken, requireSession } from '../../../lib/session';
import { getSessionTenant } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { loadTenantShell } from '../../../lib/storefront-data';
import { moneyText } from '../../../features/discovery/money';
import { reloadHref } from '../../../features/home/load-result';
import { emdRule } from '../../../features/store2c/auction';
import {
  readAuctionTab, tabGroup, auctionsHref, auctionHref, myBidsHref, auctionTabs, auctionStatusKey, auctionKindKey, auctionNoteKey, bidOutcome, bidOutcomeKey,
} from '../../../features/store3c/auctions';
import { Countdown, type CountdownLabels } from '../../../components/Countdown';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList } from '../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auctions.title'), robots: { index: false, follow: true } };
}

/** One card's facts, from either read (the public list or the caller's own) — every figure as served. */
interface CardView {
  auctionId: string; title: string; quantity: string; unitCode: string; org: string | null; kind: string; status: string; isOpen: boolean;
  sealedHidden: boolean; reserveMet: boolean | null; bidderCount: number | null; startsAt: string | null; endsAt: string; decisionDueAt: string | null;
  currentBidMinor: string | null; minNextBidMinor: string | null; currencyCode: string | null; antiSnipe: { triggerSec: number; extendSec: number } | null;
  emd: { flatMinor: string | null; pctBps: number | null } | null; mine: MyBid | null;
}
const fromCard = (a: PublicAuctionCard): CardView => ({
  auctionId: a.auctionId, title: a.lot.title, quantity: a.lot.quantity, unitCode: a.lot.unitCode, org: a.lot.organisation?.name ?? null, kind: a.kind, status: a.status,
  isOpen: a.isOpen, sealedHidden: a.sealedHidden, reserveMet: a.reserveMet, bidderCount: a.bidderCount, startsAt: a.startsAt, endsAt: a.endsAt, decisionDueAt: a.decisionDueAt,
  currentBidMinor: a.currentBidMinor, minNextBidMinor: a.minNextBidMinor, currencyCode: a.currencyCode, antiSnipe: a.antiSnipe, emd: a.emd, mine: null,
});
const fromMine = (b: MyBid): CardView => ({
  auctionId: b.auctionId, title: b.listingTitle ?? '', quantity: b.quantity ?? '', unitCode: b.unitCode ?? '', org: b.organisation?.name ?? null, kind: b.kind ?? '',
  status: b.status ?? b.auctionStatus, isOpen: b.isOpen === true, sealedHidden: b.sealedHidden === true, reserveMet: null, bidderCount: null, startsAt: null,
  endsAt: b.endsAt, decisionDueAt: b.decisionDueAt ?? null, currentBidMinor: b.currentBidMinor ?? null, minNextBidMinor: b.minNextBidMinor ?? null,
  currencyCode: b.currencyCode, antiSnipe: null, emd: b.emdRule ?? null, mine: b,
});

export default async function TenantAuctionsPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const tab = readAuctionTab(searchParams.tab);
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor.slice(0, 512) : undefined;
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;

  // THE FLAG FIRST (founder D4): an OFF store never calls the auction API
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.auctions !== true) {
    return (
      <section className="kv-auctions" data-kv-store={slug} data-kv-state="auctions-off">
        <h1>{t.t('auctions.title')}</h1>
        <div className="kv-state" role="status" data-kv-state="flag-off">
          <p><strong>{t.t('store3c.off.title')}</strong></p>
          <p>{t.t('store3c.off.body', { org })}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-cta="browse">{t.t('store2c.browseStore', { org })}</Link>
        </div>
        <RefusalList surface="auctions" />
      </section>
    );
  }

  // a session of THIS organisation sees "With my bids" (one store per session — W278's rule)
  const token = await resolveSessionToken();
  const ownStore = !!token && shell.kind === 'ok' && getSessionTenant() === shell.tenant.tenantId;
  if (tab === 'mine' && !ownStore) await requireSession(auctionsHref(slug, 'mine'));

  let cards: CardView[] = [];
  let nextCursor: string | null = null;
  let failed = flags === null;
  if (!failed) {
    try {
      const group = tabGroup(tab);
      if (group) {
        const page = await publicClient(slug).storefront.auctions({ group, cursor, limit: 20 });
        cards = page.items.map(fromCard); nextCursor = page.nextCursor;
      } else {
        const page = await serverClient(slug).auctions.myBids({ cursor, limit: 20 });
        cards = page.items.map(fromMine); nextCursor = page.nextCursor;
      }
    } catch { failed = true; }
  }

  const tabs = auctionTabs(slug, tab, ownStore);
  const money = (minor: string | null | undefined, cur: string | null) => (minor ? moneyText(minor, cur, lang) : null) ?? t.t('money.unavailable');
  const when = (iso: string | null | undefined) => (iso ? formatDate(String(iso), lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const cd: CountdownLabels = { ended: t.t('auctions.ended'), d: t.t('auctions.cd.d'), h: t.t('auctions.cd.h'), m: t.t('auctions.cd.m'), s: t.t('auctions.cd.s') };
  const head = (
    <>
      <h1>{t.t('auctions.title')}</h1>
      <p className="kv-detail__muted">{t.t('store3c.list.lead')}</p>
      {ownStore && <p><Link href={myBidsHref(slug)} className="kv-btn--link" data-kv-nav="my-bids">{t.t('store3c.bids.title')}</Link></p>}
      <nav className="kv-tabs" aria-label={t.t('store3c.tab.label')} data-kv-tabs="auctions">
        <ul className="kv-tabs__list">
          {tabs.map((x) => (
            <li key={x.tab}>
              <Link href={x.href} className={x.current ? 'kv-tab kv-tab--current' : 'kv-tab'} aria-current={x.current ? 'page' : undefined} data-kv-tab={x.tab}>{t.t(x.labelKey)}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );

  if (failed) {
    return (
      <section className="kv-auctions" data-kv-store={slug} data-kv-tab={tab}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3c.list.error')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/auctions`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="auctions" />
      </section>
    );
  }

  return (
    <section className="kv-auctions" data-kv-store={slug} data-kv-tab={tab}>
      {head}
      {cards.length === 0 ? (
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t(`store3c.list.empty.${tab}`, { org })}</p>
          {tab !== 'live' && <Link href={auctionsHref(slug, 'live')} className="kv-btn" data-kv-cta="live">{t.t('store3c.bids.seeLive')}</Link>}
        </div>
      ) : (
        <ul className="kv-orders__list" aria-label={t.t('store3c.list.caption')}>
          {cards.map((a) => {
            const rule = emdRule(a.emd);
            const note = auctionNoteKey(a.status);
            const qty = a.quantity ? formatNumber(Number(a.quantity), lang) : '';
            const outcome = a.mine ? bidOutcome(a.mine) : null;
            return (
              <li key={a.auctionId} className="kv-orders__row" data-kv-auction={a.auctionId} data-kv-status={a.status}>
                <Link href={auctionHref(slug, a.auctionId)} className="kv-link kv-orders__title">{a.title || t.t('store3c.card.untitled')}</Link>
                <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('store3c.card.lot', { qty, unit: a.unitCode, org: a.org ?? org })}</p>
                <p>
                  <span className="kv-chip" data-kv-kind={a.kind}>{t.t(auctionKindKey(a.kind))}</span>{' '}
                  <span className="kv-chip" data-kv-chip={a.status}>{t.t(auctionStatusKey(a.status))}</span>
                  {outcome && <> <span className="kv-chip" data-kv-outcome={outcome}>{t.t(bidOutcomeKey(outcome))}</span></>}
                </p>
                {a.kind === 'sealed' && <p className="kv-field__hint" data-kv-sealed="">{t.t('store3c.card.sealedNote')}</p>}
                {a.reserveMet !== null && !a.sealedHidden && a.status !== 'scheduled' && (
                  <p data-kv-reserve={a.reserveMet ? 'met' : 'not-met'}>{t.t(a.reserveMet ? 'store3c.card.reserveMet' : 'store3c.card.reserveNotMet')}</p>
                )}
                {a.bidderCount !== null && <p data-kv-bidders={a.bidderCount}>{a.bidderCount > 0 ? t.t('store3c.card.bidders', { n: formatNumber(a.bidderCount, lang) }) : t.t('store3c.card.noBidders')}</p>}
                {a.status === 'scheduled' && a.startsAt ? <p data-kv-opens="">{t.t('store3c.card.opens', { date: when(a.startsAt) })}</p>
                  : a.isOpen ? <p data-kv-ends="">{t.t('store3c.card.ends', { date: when(a.endsAt) })} · <Countdown endsAt={a.endsAt} labels={cd} /></p>
                  : <p className="kv-detail__muted" data-kv-ended="">{t.t('store3c.card.endedAt', { date: when(a.endsAt) })}</p>}
                {a.isOpen && a.antiSnipe && <p className="kv-field__hint" data-kv-anti-snipe="">{t.t('store3c.card.autoExtend', { trigger: formatNumber(a.antiSnipe.triggerSec, lang), extend: formatNumber(a.antiSnipe.extendSec, lang) })}</p>}
                {a.sealedHidden ? <p data-kv-current="sealed">{t.t('store3c.card.sealedHidden')}</p> : (
                  <>
                    {a.currentBidMinor && <p data-kv-current="server">{t.t('store3c.card.current', { price: money(a.currentBidMinor, a.currencyCode), unit: a.unitCode })}</p>}
                    {a.isOpen && a.status !== 'scheduled' && a.minNextBidMinor && <p data-kv-min-next="server">{t.t('store3c.card.minNext', { price: money(a.minNextBidMinor, a.currencyCode), unit: a.unitCode })}</p>}
                  </>
                )}
                {a.isOpen && <p className="kv-field__hint" data-kv-emd={rule?.kind ?? 'none'}>{rule ? (rule.kind === 'flat' ? t.t('store3c.emd.rule.flat', { amount: money(rule.minor, a.currencyCode) }) : t.t('store3c.emd.rule.pct', { pct: rule.pct })) : t.t('store3c.emd.rule.none')}</p>}
                {note && <p className="kv-detail__muted" data-kv-note={a.status}>{t.t(note, { date: when(a.decisionDueAt) })}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor && <p><Link href={auctionsHref(slug, tab, nextCursor)} className="kv-btn--link" rel="next">{t.t('discover.showMore')} <DirArrow /></Link></p>}
      <RefusalList surface="auctions" />
    </section>
  );
}
