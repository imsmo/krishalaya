// apps/web-storefront/src/features/store3b/refusals.ts · PC-56 STORE-3b · brief §E — what the offer pages do NOT claim, BY NAME. PURE.
// (The shape of features/store3a/refusals.ts.) Each refused canon claim is listed ONCE with where the canon makes it and the surfaces it is
// PRINTED on (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page — or the
// refused copy coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
export type Store3bSurface = 'offers' | 'offer';
export interface Store3bRefusal { id: string; canon: string; surfaces: readonly Store3bSurface[]; key: string; why: string }

export const STORE3B_REFUSALS: readonly Store3bRefusal[] = Object.freeze([
  { id: 'mandi', canon: 'W294 aside "Mandi reference (Rajkot APMC) ₹2,485" · "Both sides see the same mandi number"', surfaces: ['offer'],
    key: 'store3b.refusal.mandi', why: 'no mandi figure is on the offer read (refused since 1b / 2a); nothing is shown to either side' },
  { id: 'ai_hint', canon: 'W294 "Counters within ₹30 of the mandi reference accept 4× more often… you decide"', surfaces: ['offer'],
    key: 'store3b.refusal.aiHint', why: 'no model and no data exist; it would rest on the refused mandi figure' },
  { id: 'farmer_name', canon: 'W293 / W294 "Ramesh Patel (Anand FPO)" · "the same Ramesh Patel your groundnut order is with — see his profile"', surfaces: ['offers', 'offer'],
    key: 'store3b.refusal.farmerName', why: 'organisation-only identity (HOTFIX-4 D3): the offer is with the organisation, never a named person' },
  { id: 'buying_history', canon: 'W293 empty state "farmers see your offer price and your buying history, nothing else"', surfaces: ['offers'],
    key: 'store3b.refusal.buyingHistory', why: 'founder D5 (Q7): no buyer summary is shown to the organisation on an offer; the buyer pages show the buyer\'s side only' },
  { id: 'notes', canon: 'W294 a note per round ("Lifting within 2 days, own transport.") · "rejected with reason — delivered to you verbatim"', surfaces: ['offer'],
    key: 'store3b.refusal.notes', why: 'founder D3: no free text travels with a round; a decline carries a reason from six, never words' },
  { id: 'message_seller', canon: '(code) "Message seller" on the thread', surfaces: ['offer'],
    key: 'store3b.refusal.messageSeller', why: 'founder D6 (Q8): removed — messaging the organisation is STORE-4 (B29); the old action is deleted' },
  { id: 'checkout_from_offer', canon: 'W294 "checkout, escrow and the quality promise all apply exactly as if you\'d bought at list price" · converted "checkout picks up from the address step"', surfaces: ['offer'],
    key: 'store3b.refusal.checkoutFromOffer', why: 'founder D2: the offer order has no address step and no delivery quote — the regime sentence is printed instead (owed: checkout-from-offer)' },
  { id: 'no_reserve', canon: 'W294 "Offers don\'t reserve stock; 18 qtl stays live for direct buyers"', surfaces: ['offer'],
    key: 'store3b.refusal.noReserve', why: 'now FALSE: accepting reserves the quantity (founder D2) — the true sentence is printed on the accept confirm' },
  { id: 'keyset_pages', canon: 'W293 "Showing 1–4 of 9 · ‹ Prev / Next ›"', surfaces: ['offers'],
    key: 'store3b.refusal.pages', why: 'keyset Next only + the bounded status counts (Law 11)' },
  { id: 'lapse_act', canon: 'W294 "Let it lapse" as a button', surfaces: ['offer'],
    key: 'store3b.refusal.lapseAct', why: 'founder D4: letting it lapse is doing nothing — said as a sentence with the deadline, never an act' },
  { id: 'cross_store', canon: 'W293 one list across several organisations', surfaces: ['offers'],
    key: 'store3b.refusal.crossStore', why: 'one store per session (2b D3): this organisation\'s offers only (B30, a later wave)' },
  { id: 'notified', canon: 'W294 "the farmer is notified of your counter"', surfaces: ['offer'],
    key: 'store3b.refusal.notified', why: 'only an accepted offer has a notification row (B27); a counter, decline or lapse sends no message' },
]);

/** The canon shapes STORE-3b builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE3B_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'offers_route', canon: 'W293 / W294 `(marketplace)/offers…` under the platform header', built: '`/<slug>/offers` and `/<slug>/offers/[id]` under the organisation\'s chrome (one store per session); the platform\'s /offers and /offers/[id] are doors (lib/store-door.ts)' },
  { id: 'keyset_pages', canon: 'W293 "Showing 1–4 of 9 / Prev / Next"', built: 'keyset Next only + the bounded status counts' },
  { id: 'offer_again', canon: 'W293 "Offer again" (FM: `filter`)', built: 'a CHAIN-FORM: a link to the listing\'s offer form with the old quantity and price pre-filled (`?qty=&price=`)' },
  { id: 'lapse_copy', canon: 'W294 "Let it lapse" (FM: `nav-detail`)', built: 'copy — "or do nothing — it lapses at <respondBy>" (founder D4); Decline is the act' },
  { id: 'retry_reload', canon: 'W3124 "Confirm this action" before Retry on W293', built: 'Retry is a reload (a read): no confirm, no audit entry — W3124–W3126 are DECOR' },
  { id: 'confirm_inline', canon: 'W3121 a confirm dialog', built: 'a server-rendered confirm step on the thread (`?act=accept|counter|decline`) — no client dialog, no JS needed; the key is minted when it renders' },
]);

/** The 8 STORE-3b canon files and their verdicts. */
export const STORE3B_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W293-store-offers.html', flowmap: 'data-flowmap="chain-mutate:offers" ("Retry") → W3124', verdict: 'BUILT at /<slug>/offers — status chips with bounded counts, the organisation, the server value, keyset; flag-aware' },
  { file: 'W294-store-offer-thread.html', flowmap: 'data-flowmap="chain-mutate:offer" ("Retry") → W3121', verdict: 'BUILT at /<slug>/offers/[id] — the rounds, the clock from the read, the acts only on the buyer\'s turn' },
  { file: 'W3121-store-offer-mutate-confirm.html', flowmap: 'W294 Accept / Counter / Decline', verdict: 'BUILT — REAL: the three confirms (accept: the order it creates, the regime, the fees, the reservation; counter: the price by the listing\'s exponent; decline: the six reasons), a key minted at render, the pending lock' },
  { file: 'W3122-store-offer-mutate-success.html', flowmap: 'W3121 Proceed', verdict: 'BUILT — the thread `?ok=`: accepted → "your order is being created" (Refresh) → the order link once converted; countered → the new round + respond-by; declined → the reason' },
  { file: 'W3123-store-offer-mutate-failure.html', flowmap: 'W3121 Proceed (failure)', verdict: 'BUILT — the named failure (not your turn / expired / not negotiable / stock short {available} / listing / organisation unavailable / max life / invalid price / reason / flag off / concurrency → Retry with the same key)' },
  { file: 'W3124-store-offers-mutate-confirm.html', flowmap: 'W293 Retry', verdict: 'PARITY-DECOR — Retry is a reload of the list (DELTA retry_reload)' },
  { file: 'W3125-store-offers-mutate-success.html', flowmap: 'W3124 Proceed', verdict: 'PARITY-DECOR — the re-rendered list' },
  { file: 'W3126-store-offers-mutate-failure.html', flowmap: 'W3124 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry' },
]);

export function store3bRefusalKeys(surface: Store3bSurface): string[] {
  return STORE3B_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
