// apps/mobile/src/features/auctions/auction-status.ts · PURE auction logic (no React/native; SDK/ui types are
// `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2): the current price + min next
// bid + bid validation all use BigInt, never a float. The SERVER is the authority on whether a bid is legal
// (highest, increment, EMD, timing) — this is UX gating + display only.
import type { PillTone } from '@krishalaya/ui-native';
import type { Auction, BidHistoryItem } from '@krishalaya/sdk-js';

/** Auction status → chip tone. */
export function auctionStatusTone(status: string): PillTone {
  switch (status) {
    case 'live': case 'extended': return 'success';
    case 'scheduled': return 'info';
    case 'ended': case 'awaiting_approval': return 'warning';
    case 'settled': return 'accent';
    case 'cancelled': case 'failed_reserve': return 'danger';
    default: return 'neutral';
  }
}

/** Bidding is only open while live or extended. */
export function isBiddable(status: string): boolean {
  return status === 'live' || status === 'extended';
}

/** The current price = the highest visible bid (history is newest-first; the latest bid is the highest in an
 * english auction), else the auction's start price. Ignores masked (null) amounts. All bigint minor strings. */
export function currentPriceMinor(auction: Pick<Auction, 'startPriceMinor'>, bids: BidHistoryItem[]): string {
  let max: bigint | null = null;
  for (const b of bids) {
    if (b.amountMinor == null) continue;
    try { const v = BigInt(b.amountMinor); if (max === null || v > max) max = v; } catch { /* skip bad */ }
  }
  if (max === null) return auction.startPriceMinor;
  try { return max >= BigInt(auction.startPriceMinor) ? max.toString() : auction.startPriceMinor; } catch { return max.toString(); }
}

/** Minimum acceptable next bid = current + increment (bigint). */
export function minNextBidMinor(currentMinor: string, minIncrementMinor: string): string {
  try { return (BigInt(currentMinor) + BigInt(minIncrementMinor)).toString(); } catch { return currentMinor; }
}

export interface BidCheck { ok: boolean; reason?: 'invalid' | 'too_low' }

/** Validate a typed bid (whole rupees) against the required minimum (paise). Pure BigInt (Law 2). The server
 * re-validates (highest/increment/EMD/timing) and is the authority. */
export function validateBidRupees(rupees: string, minNextMinor: string): BidCheck {
  const clean = (rupees ?? '').trim();
  if (!/^\d{1,13}$/.test(clean)) return { ok: false, reason: 'invalid' };
  let amt: bigint;
  try { amt = BigInt(clean) * 100n; } catch { return { ok: false, reason: 'invalid' }; }
  if (amt <= 0n) return { ok: false, reason: 'invalid' };
  try { if (amt < BigInt(minNextMinor)) return { ok: false, reason: 'too_low' }; } catch { /* allow */ }
  return { ok: true };
}

/** P1-8: classify an auction's EMD (earnest-money deposit) requirement for display. A flat `emdMinor` (> 0) takes
 * precedence; else a percentage of the bid via `emdPctBps`; else none. Pure (BigInt for the flat amount, integer
 * basis points for the pct) — the SERVER computes the actual hold (emdForBid); this is display only. */
export type EmdRequirement =
  | { kind: 'flat'; minor: string }
  | { kind: 'pct'; pctBps: number }
  | { kind: 'none' };

export function emdRequirement(auction: Pick<Auction, 'emdMinor' | 'emdPctBps'>): EmdRequirement {
  let flat = 0n;
  try { flat = BigInt(auction.emdMinor ?? '0'); } catch { flat = 0n; }
  if (flat > 0n) return { kind: 'flat', minor: flat.toString() };
  const bps = auction.emdPctBps ?? 0;
  if (Number.isFinite(bps) && bps > 0) return { kind: 'pct', pctBps: bps };
  return { kind: 'none' };
}

/** Am I outbid? True when the most-recent (highest) visible bid is not mine but I have bid before. Drives the
 * "you've been outbid" banner (server push P-04 is the authoritative notify; this is the in-screen reflection). */
export function isOutbid(bids: BidHistoryItem[], myUserId: string): boolean {
  const top = bids.find((b) => b.amountMinor != null);
  if (!top) return false;
  const iHaveBid = bids.some((b) => b.bidderUserId === myUserId);
  return iHaveBid && top.bidderUserId !== myUserId;
}

/** Time remaining on the auction clock (screen 16 "Time Left 2h 14m"). Pure — `now` injectable for tests. Returns
 * the broken-down remainder so the screen composes a localised label; `ended` true once the deadline has passed. */
export function timeLeft(endsAt: string, now: number = Date.now()): { ended: boolean; totalMs: number; days: number; hours: number; minutes: number } {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return { ended: true, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  const ms = end - now;
  if (ms <= 0) return { ended: true, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  const totalMin = Math.floor(ms / 60000);
  return { ended: false, totalMs: ms, days: Math.floor(totalMin / 1440), hours: Math.floor((totalMin % 1440) / 60), minutes: totalMin % 60 };
}

// --- Outbid (screen 193, bidder): my highest bid, how far short it is, and a suggested re-bid.
/** The caller's highest VISIBLE bid amount (minor) across the history; null if they haven't bid (or all masked). */
export function myHighestBidMinor(bids: BidHistoryItem[], myUserId: string): string | null {
  let max: bigint | null = null;
  for (const b of bids) {
    if (b.bidderUserId !== myUserId || b.amountMinor == null) continue;
    let n: bigint; try { n = BigInt(b.amountMinor); } catch { continue; }
    if (max == null || n > max) max = n;
  }
  return max == null ? null : max.toString();
}

/** How much the current price is above my bid (the "₹X short" line). Null if my bid is unknown. ≥0. Pure bigint. */
export function shortByMinor(currentMinor: string, myBidMinor: string | null): string | null {
  if (myBidMinor == null) return null;
  let cur: bigint; let mine: bigint;
  try { cur = BigInt(currentMinor); mine = BigInt(myBidMinor); } catch { return null; }
  const d = cur - mine;
  return (d > 0n ? d : 0n).toString();
}

/** A suggested re-bid = the minimum next bid + one more increment (a UX nudge for a better chance — NOT a server
 * prediction; the server still validates the actual bid). Falls back to minNext when there is no increment. Pure. */
export function recommendedBidMinor(minNextMinor: string, incrementMinor: string | null | undefined): string {
  let next: bigint; try { next = BigInt(minNextMinor); } catch { return minNextMinor; }
  let inc = 0n; try { if (incrementMinor) inc = BigInt(incrementMinor); } catch { inc = 0n; }
  return (next + (inc > 0n ? inc : 0n)).toString();
}

// --- Auction Complete (screen 66, seller): the accepted (winning) bid amount + the run duration.
/** The accepted bid's per-unit amount (minor). Prefers the auction's `winningBidId` row in the history; falls back
 * to the highest visible bid (= current price). Pure. */
export function winningBidAmountMinor(auction: Pick<Auction, 'winningBidId' | 'startPriceMinor'>, bids: BidHistoryItem[]): string {
  if (auction.winningBidId) {
    const w = bids.find((b) => b.id === auction.winningBidId && b.amountMinor != null);
    if (w && w.amountMinor) return w.amountMinor;
  }
  return currentPriceMinor(auction, bids);
}

/** The auction's run length broken into whole days + hours (screen 66 "6h" / "2d 4h"). Pure; rounds to the nearest
 * hour. Returns {days,hours}; the screen composes a localised label. */
export function auctionDurationParts(startsAt: string, endsAt: string): { days: number; hours: number } {
  const s = Date.parse(startsAt); const e = Date.parse(endsAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return { days: 0, hours: 0 };
  const totalHours = Math.round((e - s) / 3600000);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

// --- Your Auction live view (screen 65, seller): a HH:MM:SS countdown + the % the current price sits above the
// reserve. Pure → unit-tested; the screen ticks `now` and polls the data.
/** Zero-padded HH:MM:SS from a remaining-milliseconds value (clamped at 0). Hours are NOT capped (a multi-day
 * auction shows e.g. 50:00:00). Pure. */
export function formatClock(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)} : ${p(mm)} : ${p(ss)}`;
}

/** The whole-percent the current price is above (or below) the reserve (screen 65 "+9% Above Reserve"). Null when
 * there is no reserve to compare against. Uses Number (rupee ranges are safe) on bigint-minor inputs. Pure. */
export function pctAboveReserve(currentMinor: string, reserveMinor: string | null | undefined): number | null {
  if (reserveMinor == null) return null;
  let cur: bigint; let res: bigint;
  try { cur = BigInt(currentMinor); res = BigInt(reserveMinor); } catch { return null; }
  if (res <= 0n) return null;
  return Math.round((Number(cur - res) / Number(res)) * 100);
}

// --- Create Auction (screen 64): duration presets + a pure draft builder. The auction is created over an EXISTING
// listing (the contract requires a listingId); the seller sets a reserve (= opening price), a bid increment, and a
// duration. Money is bigint minor-unit strings (Law 2). The server authorises ownership + re-validates.
export const AUCTION_DURATIONS = [
  { hours: 2, key: 'quick' }, { hours: 6, key: 'standard' }, { hours: 24, key: 'wide' },
] as const;
export type AuctionDurationHours = (typeof AUCTION_DURATIONS)[number]['hours'];

/** endsAt for a duration in hours from `now` (ms). Pure → ISO string. */
export function auctionEndsAt(nowMs: number, hours: number): string {
  return new Date(nowMs + hours * 3600000).toISOString();
}

const RUPEES_RE = /^\d{1,9}$/; // whole rupees only (the design inputs are integers)
export interface CreateAuctionForm { listingId?: string; reserveRupees?: string; incrementRupees?: string; hours?: number }
export interface CreateAuctionInput { listingId: string; kind: 'english_open'; startPriceMinor: string; reservePriceMinor: string; minIncrementMinor?: string; startsAt: string; endsAt: string }
export interface CreateAuctionDraft { ok: boolean; input?: CreateAuctionInput; reason?: 'listing' | 'reserve' | 'increment' | 'duration' }
/** Validate + assemble a create-auction payload. Reserve is required (whole rupees > 0) and seeds BOTH the opening
 * price and the reserve. Increment is optional (whole rupees > 0). Duration must be one of the presets. `now`
 * injectable for tests. Pure — no I/O. */
export function buildCreateAuctionDraft(form: CreateAuctionForm, nowMs: number = Date.now()): CreateAuctionDraft {
  if (!form.listingId) return { ok: false, reason: 'listing' };
  const reserve = (form.reserveRupees ?? '').trim();
  if (!RUPEES_RE.test(reserve) || BigInt(reserve) <= 0n) return { ok: false, reason: 'reserve' };
  let incMinor: string | undefined;
  const inc = (form.incrementRupees ?? '').trim();
  if (inc) { if (!RUPEES_RE.test(inc) || BigInt(inc) <= 0n) return { ok: false, reason: 'increment' }; incMinor = (BigInt(inc) * 100n).toString(); }
  const hours = form.hours;
  if (!hours || !AUCTION_DURATIONS.some((d) => d.hours === hours)) return { ok: false, reason: 'duration' };
  const reserveMinor = (BigInt(reserve) * 100n).toString();
  return {
    ok: true,
    input: {
      listingId: form.listingId, kind: 'english_open', startPriceMinor: reserveMinor, reservePriceMinor: reserveMinor,
      minIncrementMinor: incMinor, startsAt: new Date(nowMs).toISOString(), endsAt: auctionEndsAt(nowMs, hours),
    },
  };
}

// --- My Bids (screen 18): bucket the caller's bids into Active / Won / Lost from the auction status + winning flag.
export type MyBidTab = 'active' | 'won' | 'lost';
const DECIDED = new Set(['ended', 'settled', 'awaiting_approval', 'cancelled', 'failed_reserve']);
/** Which tab a bid belongs to: an ongoing auction → active; a decided one → won (I'm winning/won) or lost. The
 * server's MyBid.isWinning is authoritative for the won/lost split. Pure. */
export function myBidBucket(bid: { auctionStatus: string; isWinning: boolean }): MyBidTab {
  if (!DECIDED.has(bid.auctionStatus)) return 'active';
  return bid.isWinning ? 'won' : 'lost';
}
export function matchesMyBidTab(bid: { auctionStatus: string; isWinning: boolean }, tab: MyBidTab): boolean {
  return myBidBucket(bid) === tab;
}
/** Tab counts for the segmented header. Pure. */
export function myBidCounts(bids: Array<{ auctionStatus: string; isWinning: boolean }>): Record<MyBidTab, number> {
  const c: Record<MyBidTab, number> = { active: 0, won: 0, lost: 0 };
  for (const b of bids) c[myBidBucket(b)] += 1;
  return c;
}

/** Quick-add steps (in WHOLE RUPEES) for the bid sheet (screen 17 "+100 +200 +300 +500"). UI sugar only; the bid is
 * still validated against the increment server-side. */
export const BID_QUICK_ADD_RUPEES = [100, 200, 300, 500] as const;

/** Total bid value = per-unit bid (minor) × quantity, as BIGINT (Law 2 — never a float). The lot quantity comes
 * from the listing; the server recomputes the authoritative total. Returns a minor-unit string ('0' on bad input). */
export function bidAmountMinor(perUnitMinor: string, qty: number): string {
  const n = Math.max(0, Math.trunc(qty));
  let unit: bigint;
  try { unit = BigInt(perUnitMinor); } catch { return '0'; }
  return (unit * BigInt(n)).toString();
}

/** The EMD that will be HELD from the wallet when this bid is placed (screen 17). Flat → the fixed amount; pct → a
 * basis-point share of the total bid value (floored); none → '0'. BigInt throughout. The SERVER performs the actual
 * hold — this is the on-screen preview only. */
export function emdHoldMinor(emd: EmdRequirement, totalBidMinor: string): string {
  if (emd.kind === 'flat') return emd.minor;
  if (emd.kind === 'pct') {
    let total: bigint;
    try { total = BigInt(totalBidMinor); } catch { return '0'; }
    return ((total * BigInt(emd.pctBps)) / 10000n).toString();
  }
  return '0';
}

/** Does the wallet's available balance cover the EMD hold? UX gate only — the server re-checks on place. */
export function walletCoversHold(availableMinor: string, holdMinor: string): boolean {
  try { return BigInt(availableMinor) >= BigInt(holdMinor); } catch { return false; }
}

/** Visible-history aggregates for the bid box (screen 16 "Total Bidders / Bids Placed") + the leading bidder for
 * the 👑. These count what the loaded history page exposes (the server is the authority on auction-wide totals);
 * `topBidderId` is the highest VISIBLE non-masked bid's bidder. Pure. */
export function bidStats(bids: BidHistoryItem[]): { bidders: number; bids: number; topBidderId: string | null } {
  const ids = new Set<string>();
  for (const b of bids) ids.add(b.bidderUserId);
  const top = bids.find((b) => b.amountMinor != null) ?? null;
  return { bidders: ids.size, bids: bids.length, topBidderId: top ? top.bidderUserId : null };
}
