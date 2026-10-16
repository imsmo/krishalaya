// apps/web-storefront/src/features/store3c/refusals.ts · PC-56 STORE-3c · brief §E — what the auction, my-bids and group-lot pages do NOT claim,
// BY NAME. PURE. (The shape of features/store3b/refusals.ts.) Each refused canon claim is listed ONCE with where the canon makes it and the
// surfaces it is PRINTED on (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page —
// or the refused copy coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
export type Store3cSurface = 'auctions' | 'bids' | 'group';
export interface Store3cRefusal { id: string; canon: string; surfaces: readonly Store3cSurface[]; key: string; why: string }

export const STORE3C_REFUSALS: readonly Store3cRefusal[] = Object.freeze([
  { id: 'emd_pct_bid', canon: 'W295 sealed card "EMD 2% of your bid"', surfaces: ['auctions', 'bids'],
    key: 'store3c.refusal.emdOfBid', why: 'founder D1: the deposit is the flat amount, else a share of the LOT value at the bidder\'s first bid (lot.ts emdForLot) — the API\'s rule is printed' },
  { id: 'names_masked', canon: 'W295 lead "the ledger is public (names masked)"', surfaces: ['auctions'],
    key: 'store3c.refusal.namesMasked', why: 'founder 2a D1: no bidder identity at all — not a mask, nothing' },
  { id: 'kyc_qualification', canon: 'W295 state "KYC-verified buyers (bidder qualification). Yours is ✓"', surfaces: ['auctions'],
    key: 'store3c.refusal.kyc', why: 'no qualification check exists in the bid path and there is no buyer KYC' },
  { id: 'reverse_dutch', canon: 'W295 footnote "Kinds: english_open · sealed · reverse · dutch"', surfaces: ['auctions'],
    key: 'store3c.refusal.reverseDutch', why: 'the entity refuses reverse and dutch at creation (auction.entity.ts SUPPORTED)' },
  { id: 'decision_12h', canon: 'W295 awaiting_approval "Decision due within 12h"', surfaces: ['auctions'],
    key: 'store3c.refusal.twelveHours', why: 'each auction carries its own decision deadline (default 24 h, at most 72 h) — printed from the read' },
  { id: 'follow_relist', canon: 'W295 failed_reserve "The seller often relists lower; follow to hear"', surfaces: ['auctions'],
    key: 'store3c.refusal.follow', why: 'watching notifies the close only; no relist notifier exists' },
  { id: 'fingerprint', canon: 'W296 "Every bid stores its connection fingerprint. Same-connection bidding rings get caught and voided"', surfaces: ['bids'],
    key: 'store3c.refusal.fingerprint', why: 'a bid records its ip only (device_fingerprint is never written); no ring is detected or voided — "every bid records the connection it came from" is said instead' },
  { id: 'balance_tomorrow', canon: 'W296 won "Pay the balance by tomorrow 18:00"', surfaces: ['bids'],
    key: 'store3c.refusal.tomorrow', why: 'founder D2: the settlement\'s own due time (48 h after it) is printed from the read' },
  { id: 'register_interest', canon: 'W279 "Register interest — no payment yet" · "first-committed gets first right" · "Interested buyers so far 3"', surfaces: ['group'],
    key: 'store3c.refusal.registerInterest', why: 'founder D3: no buyer-interest table, queue or count — refused by name; W3089–W3091 are DECOR' },
  { id: 'indicative_price', canon: 'W279 "Indicative price (filled lot) … below single-lot prices" · "Full lot value (indicative)"', surfaces: ['group'],
    key: 'store3c.refusal.indicative', why: 'founder D3: no indicative price field; a lot value would be client money arithmetic' },
  { id: 'graded_centre', canon: 'W279 "every member\'s bags graded separately at the centre"', surfaces: ['group'],
    key: 'store3c.refusal.graded', why: 'no grading exists in group lots' },
  { id: 'verified_quintals', canon: 'W279 "each farmer paid for their own verified quintals, directly — the pool shares a buyer, never a wallet"', surfaces: ['group'],
    key: 'store3c.refusal.verifiedQuintals', why: 'shares are by PLEDGED quantity, through the coordinator\'s hold, at a second person\'s confirm — the true sentence is printed' },
  { id: 'pay_when_fills', canon: 'W279 "You pay only when the lot fills and you confirm. We message you at 100%"', surfaces: ['group'],
    key: 'store3c.refusal.payWhenFills', why: 'buyers are never notified by a lot; once listed it is bought through checkout like any listing' },
  { id: 'verified_buyer', canon: 'W279 state "Pledging is verified-buyer-only"', surfaces: ['group'],
    key: 'store3c.refusal.verifiedBuyer', why: 'pledging is a FARMER (member) act; there is no buyer KYC' },
  { id: 'helpline', canon: 'W279 error "pledging by phone also works: 1800…"', surfaces: ['group'],
    key: 'store3c.refusal.helpline', why: 'no helpline (refused since STORE-1a)' },
  { id: 'keyset_pages', canon: 'W295 / W296 "Showing 1–N of M / Prev"', surfaces: ['auctions', 'bids'],
    key: 'store3c.refusal.pages', why: 'keyset Next only (Law 11)' },
  { id: 'flagged_off_settings', canon: 'W295 / W296 / W279 "Flagged off — for this tenant/plan… see store settings"', surfaces: ['auctions', 'bids', 'group'],
    key: 'store3c.refusal.storeSettings', why: 'the honest OFF state is printed (the store\'s flag through the allow-list); a buyer has no store settings' },
]);

/** The canon shapes STORE-3c builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE3C_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'routes', canon: 'W295 / W296 / W279 `(marketplace)/auctions…`, `(marketplace)/g/[id]` under the platform header', built: '`/<slug>/auctions`, `/<slug>/auctions/bids`, `/<slug>/g/[id]` under the organisation\'s chrome (one store per session); the platform\'s /auctions, /auctions/[id], /auctions/bids and /g/[id] are doors (lib/store-door.ts)' },
  { id: 'keyset_pages', canon: 'W295 tabs with counts "Live (3) · Upcoming (5) · Ended (12)" · pages', built: 'keyset Next only and NO numbers in the tabs (the public list serves no counts — never a guessed number)' },
  { id: 'pay_balance', canon: 'W296 "Pay balance" (FM: `filter`, a decor button) → W3115', built: 'a MONEY act on 2c\'s attempt chain: the link opens the order\'s pay step, which now charges the DUE (total − the deposit applied)' },
  { id: 'retry_reload', canon: 'W3077 / W3115 / W3089 "Confirm this action" before Retry', built: 'Retry is a reload (a read): no confirm, no audit entry — W3077–W3079 and W3115–W3117 are DECOR' },
  { id: 'chain_back_links', canon: 'W3078 / W3079 "Back" → W316', built: '"Back" goes to the auction list (the W316 target is a defect, named)' },
  { id: 'similar_lots', canon: 'W279 cancelled "See similar lots" → W275', built: 'THIS store\'s search with the 2a facet `saleType=group_lot`' },
  { id: 'interest_decor', canon: 'W279 "Register interest" → W3089–W3091', built: 'refused by name (founder D3); only the Retry reload remains — DECOR' },
]);

/** The 12 STORE-3c canon files and their verdicts. */
export const STORE3C_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W279-store-group-lot.html', flowmap: 'data-flowmap="chain-mutate:group" ("Register interest" / "Retry") → W3089', verdict: 'BUILT at /<slug>/g/[id] — the public read (a pledger COUNT, the organisation, progress from bps, the deadline clock, the true payout sentence); "Register interest" REFUSED by name' },
  { file: 'W295-store-auctions.html', flowmap: 'data-flowmap="chain-mutate:auctions" ("Retry") → W3077', verdict: 'BUILT at /<slug>/auctions — the public list (Live / Upcoming / Ended + With my bids for a session), the nine statuses, the server figures, no identity; flag-aware' },
  { file: 'W296-store-my-bids.html', flowmap: 'data-flowmap="chain-mutate:my" ("Retry") → W3115', verdict: 'BUILT at /<slug>/auctions/bids — per auction, the deposit as the LEDGER has it, the won row\'s deposit / balance rows and "Pay balance" (the pay step charging the due)' },
  { file: 'W3077-store-auctions-mutate-confirm.html', flowmap: 'W295 Retry', verdict: 'PARITY-DECOR — Retry is a reload of the list (DELTA retry_reload)' },
  { file: 'W3078-store-auctions-mutate-success.html', flowmap: 'W3077 Proceed', verdict: 'PARITY-DECOR — the re-rendered list; its "Back" → W316 is a defect (DELTA chain_back_links)' },
  { file: 'W3079-store-auctions-mutate-failure.html', flowmap: 'W3077 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry; "Back" → W316 is a defect (DELTA chain_back_links)' },
  { file: 'W3089-store-group-mutate-confirm.html', flowmap: 'W279 Register interest / Retry', verdict: 'PARITY-DECOR — "Register interest" refused by name (founder D3); Retry is a reload' },
  { file: 'W3090-store-group-mutate-success.html', flowmap: 'W3089 Proceed', verdict: 'PARITY-DECOR — the re-rendered lot (no act exists)' },
  { file: 'W3091-store-group-mutate-failure.html', flowmap: 'W3089 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry; "page the on-call" refused' },
  { file: 'W3115-store-my-mutate-confirm.html', flowmap: 'W296 Retry', verdict: 'PARITY-DECOR — Retry is a reload; "Pay balance" is NOT this chain (DELTA pay_balance: 2c\'s attempt chain)' },
  { file: 'W3116-store-my-mutate-success.html', flowmap: 'W3115 Proceed', verdict: 'PARITY-DECOR — the re-rendered my bids' },
  { file: 'W3117-store-my-mutate-failure.html', flowmap: 'W3115 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry' },
]);

export function store3cRefusalKeys(surface: Store3cSurface): string[] {
  return STORE3C_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
