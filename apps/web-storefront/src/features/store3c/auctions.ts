// apps/web-storefront/src/features/store3c/auctions.ts · PC-56 STORE-3c · C1–C4 — THE AUCTION LIST, MY BIDS AND THE BALANCE PAY STEP: THE PURE
// HALF (no React, no Next, no I/O; type-only SDK imports; unit-tested in test/store3c-auctions.spec.ts).
//
//   • the routes under the ORGANISATION's chrome (`/<slug>/auctions`, `/<slug>/auctions/bids`, `/<slug>/auctions/<id>`) — the platform's are doors;
//   • the four tabs (Live · Upcoming · With my bids (a session only) · Ended) — the API's groups (`live` / `upcoming` / `ended`) plus the
//     caller's own (`mine` — the my-bids read); NO counts in the tabs (the public list serves none — never a guessed number);
//   • the NINE auction statuses (apps/api auction.state.ts AUCTION_STATUSES — the canon footnote lacked `defaulted`) each with a catalogue
//     key in en / hi / gu; an unknown status reads "status unknown", never the raw enum;
//   • a my-bids row's outcome (leading · outbid · sealed · awaiting · won · lost · no sale) from the SERVER's facts (`leading`, `won`, `isOpen`,
//     `sealedHidden`, the status) — never a comparison of amounts here;
//   • the deposit AS THE LEDGER HAS IT (`emd.state` → its catalogue key) and the won row's settlement view (the Pay balance link only while the
//     balance is open, online, and the API says something is due);
//   • the pay step's amount: the order's `amountDueMinor` (3a's field: total − the deposit applied), the total ONLY when the field is absent.
// NO MONEY ARITHMETIC: every amount printed is the API's; the only checks are "is this string present / not zero".
import type { MyBid, OrderDetail, PublicAuctionGroup } from '@krishalaya/sdk-js';
import { payHref } from '../store2c/checkout';

const slugPath = (slug: string) => `/${encodeURIComponent(slug)}`;

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE STATUSES (E9)                                                                                                                    */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** The API's nine (apps/api modules/auctions/domain/auction.state.ts AUCTION_STATUSES). */
export const AUCTION_STATUS_LIST = ['scheduled', 'live', 'extended', 'ended', 'awaiting_approval', 'settled', 'cancelled', 'failed_reserve', 'defaulted'] as const;
export type StoreAuctionStatus = (typeof AUCTION_STATUS_LIST)[number];
export function isAuctionStatus(v: unknown): v is StoreAuctionStatus {
  return typeof v === 'string' && (AUCTION_STATUS_LIST as readonly string[]).includes(v);
}
export function auctionStatusKey(status: unknown): string {
  return isAuctionStatus(status) ? `store3c.status.${status}` : 'store3c.status.unknown';
}
/** The kinds the platform runs (reverse / dutch are refused at creation — refused by name on the page). */
export const AUCTION_KINDS = ['english_open', 'sealed'] as const;
export function auctionKindKey(kind: unknown): string {
  return kind === 'sealed' ? 'store3c.kind.sealed' : kind === 'english_open' ? 'store3c.kind.english_open' : 'store3c.kind.unknown';
}
/** The per-status note the canon's states print (failed reserve · awaiting the organisation · extended · defaulted · cancelled). */
export function auctionNoteKey(status: unknown): string | null {
  switch (status) {
    case 'failed_reserve': return 'store3c.note.failedReserve';
    case 'awaiting_approval': return 'store3c.note.awaiting';
    case 'extended': return 'store3c.note.extended';
    case 'defaulted': return 'store3c.note.defaulted';
    case 'cancelled': return 'store3c.note.cancelled';
    default: return null;
  }
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE TABS (W295) AND THE ROUTES                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const AUCTION_TABS = ['live', 'upcoming', 'mine', 'ended'] as const;
export type AuctionTab = (typeof AUCTION_TABS)[number];
/** `?tab=` read back: anything unknown is `live` (a hand-typed URL is never an error page). */
export function readAuctionTab(raw: unknown): AuctionTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (AUCTION_TABS as readonly string[]).includes(String(v ?? '')) ? (v as AuctionTab) : 'live';
}
/** The API group a tab reads (`mine` reads the my-bids read instead — null). */
export function tabGroup(tab: AuctionTab): PublicAuctionGroup | null {
  return tab === 'mine' ? null : tab;
}
export function auctionsHref(slug: string, tab: AuctionTab = 'live', cursor?: string | null): string {
  const p = new URLSearchParams();
  if (tab !== 'live') p.set('tab', tab);
  if (cursor) p.set('cursor', cursor);
  const q = p.toString();
  return `${slugPath(slug)}/auctions${q ? `?${q}` : ''}`;
}
export function myBidsHref(slug: string, cursor?: string | null): string {
  return `${slugPath(slug)}/auctions/bids${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
}
export function auctionHref(slug: string, id: string): string { return `${slugPath(slug)}/auctions/${encodeURIComponent(id)}`; }
export function orderHref(slug: string, id: string): string { return `${slugPath(slug)}/orders/${encodeURIComponent(id)}`; }
/** The tabs a viewer sees: "With my bids" only with a session (W295). */
export function auctionTabs(slug: string, current: AuctionTab, signedIn: boolean): Array<{ tab: AuctionTab; href: string; labelKey: string; current: boolean }> {
  return AUCTION_TABS.filter((t) => t !== 'mine' || signedIn).map((t) => ({ tab: t, href: auctionsHref(slug, t), labelKey: `store3c.tab.${t}`, current: t === current }));
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* A MY-BIDS ROW (W296)                                                                                                                 */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type BidOutcome = 'leading' | 'outbid' | 'sealed' | 'awaiting' | 'won' | 'lost' | 'no_sale';
/** From the SERVER's facts only (never an amount comparison): won → won; no sale (cancelled / reserve not met); awaiting the organisation;
 *  open: sealed (hidden) · leading · outbid; any other close → lost. */
export function bidOutcome(r: Pick<MyBid, 'won' | 'status' | 'auctionStatus' | 'isOpen' | 'sealedHidden' | 'leading'>): BidOutcome {
  const status = r.status ?? r.auctionStatus;
  if (r.won) return 'won';
  if (status === 'cancelled' || status === 'failed_reserve') return 'no_sale';
  if (status === 'awaiting_approval') return 'awaiting';
  if (r.isOpen) return r.sealedHidden ? 'sealed' : r.leading ? 'leading' : 'outbid';
  return 'lost';
}
export function bidOutcomeKey(o: BidOutcome): string { return `store3c.bids.outcome.${o}`; }

export const EMD_STATES = ['held', 'released', 'applied', 'forfeited', 'returned', 'none'] as const;
export type EmdStateCode = (typeof EMD_STATES)[number];
/** The ledger's deposit state → its sentence (unknown → "none", never a guess). */
export function emdStateKey(state: unknown): string {
  return (EMD_STATES as readonly string[]).includes(String(state)) ? `store3c.emd.${state}` : 'store3c.emd.none';
}

export const SETTLEMENT_OUTCOMES = ['open', 'paid', 'defaulted', 'returned', 'cancelled_paid'] as const;
export function settlementOutcomeKey(outcome: unknown): string | null {
  if (outcome === 'open') return null;
  return (SETTLEMENT_OUTCOMES as readonly string[]).includes(String(outcome)) ? `store3c.won.outcome.${outcome}` : 'store3c.won.outcome.unknown';
}
const present = (s: string | null | undefined) => typeof s === 'string' && /^\d+$/.test(s) && !/^0+$/.test(s);
/** The won row's acts: "Pay balance" ONLY while the settlement is open, collected ONLINE, and the API says an amount is due (the DELTA: a
 *  money act on 2c's attempt chain, not W3115). An OFFLINE won order is confirmed by the organisation (pay on delivery). */
export function wonView(slug: string, s: MyBid['settlement']): { pay: string | null; offline: boolean; outcomeKey: string | null; orderHref: string | null } {
  if (!s) return { pay: null, offline: false, outcomeKey: null, orderHref: null };
  const open = s.outcome === 'open';
  return {
    pay: open && s.collection === 'online' && present(s.amountDueMinor) ? payHref(slug, s.orderId) : null,
    offline: open && s.collection === 'offline',
    outcomeKey: settlementOutcomeKey(s.outcome),
    orderHref: orderHref(slug, s.orderId),
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE BALANCE PAY STEP (C4) — 2c's pay step charges what is DUE                                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** What the pay step charges (the intent) and tests the wallet against: the order's `amountDueMinor` (total − the deposit applied); the total
 *  ONLY when the field is absent (an older API — it never is now). A string, as served — never computed here. */
export function payableMinor(o: Pick<OrderDetail, 'totalMinor'> & Partial<Pick<OrderDetail, 'amountDueMinor'>>): string {
  return typeof o.amountDueMinor === 'string' && /^\d+$/.test(o.amountDueMinor) ? o.amountDueMinor : o.totalMinor;
}
/** The deposit rows ("Deposit applied −X · Balance due Y") show only when a deposit was applied (> 0). */
export function showsDepositRows(o: Partial<Pick<OrderDetail, 'depositAppliedMinor'>>): boolean {
  return present(o.depositAppliedMinor ?? null);
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE BID REFUSALS (W278 — founder D1: a sealed bid only raises)                                                                       */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const BID_REFUSAL_STATUS: Readonly<Record<string, string>> = Object.freeze({
  AUCTION_BID_TOO_LOW: 'too_low', BID_TOO_LOW: 'too_low', AUCTION_ENDED: 'ended', AUCTION_NOT_BIDDABLE: 'ended', ALREADY_HIGH_BIDDER: 'leading',
  AUCTION_ALREADY_HIGH_BIDDER: 'leading', WALLET_INSUFFICIENT_BALANCE: 'emd', AUCTION_ENTRY_PAUSED: 'paused', SELLER_CANNOT_BID: 'seller',
  BID_SEALED_MUST_RAISE: 'sealed_raise',
});
