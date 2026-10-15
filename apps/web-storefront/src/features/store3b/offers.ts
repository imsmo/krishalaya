// apps/web-storefront/src/features/store3b/offers.ts · PC-56 STORE-3b · C1–C5 — THE OFFER PAGES' PURE HALF (no React, no Next, no I/O; type-only
// SDK imports; unit-tested in test/store3b-offers.spec.ts).
//
//   • the routes under the ORGANISATION's chrome (`/<slug>/offers`, `/<slug>/offers/<id>` — one store per session; the platform's /offers are
//     doors) and the status chips with their BOUNDED counts (the API's `offers/counts`, capped "(n+)" exactly as 3a's tabs);
//   • the six statuses the state machine has (E9) — and ONLY those: the five phantom statuses the old catalogue carried (active, pending,
//     declined, withdrawn, cancelled) are gone from the catalogues and from every set here;
//   • THE TURN MODEL (E1): an act is shown ONLY when the API says it is the caller's turn (`yourTurn`) AND lists the act (`allowedActs`) — the
//     entity's parity rule, never re-derived from a price; the round / thread sentences; whose price is on the table;
//   • the acts' codec: the counter price parsed with the LISTING's own exponent (the offer read's currency — never two decimals by default),
//     the decline reason from the six (founder D3), the minted key, every named outcome (W3122 success · W3123 failure);
//   • "Offer again" (a CHAIN-FORM to the listing's offer form — DELTA: the FM classes it a filter): the prefill codec;
// NO MONEY ARITHMETIC: every amount printed is the API's (`offerValueMinor`, the prices on the table, the list price).
import { currencyExponent } from '../discovery/money';
import { parseMajorToMinor, minorToMajor } from '../discovery/query';

const slugPath = (slug: string) => `/${encodeURIComponent(slug)}`;

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE STATUSES (E9) AND THE CHIPS (W293)                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** The API's list (apps/api offers/domain/listing-offer.state.ts OFFER_STATUSES — W293's footnote names exactly these six). */
export const OFFER_STATUS_LIST = ['open', 'countered', 'accepted', 'rejected', 'expired', 'converted'] as const;
export type StoreOfferStatus = (typeof OFFER_STATUS_LIST)[number];
/** The statuses the OLD catalogue invented — never a state of the machine. Kept as a list ONLY so the parity spec can prove they are gone. */
export const PHANTOM_OFFER_STATUSES = ['active', 'pending', 'declined', 'withdrawn', 'cancelled'] as const;
export const NEGOTIABLE: readonly StoreOfferStatus[] = ['open', 'countered'];
export const TERMINAL: readonly StoreOfferStatus[] = ['rejected', 'expired', 'converted'];

export function isOfferStatus(v: unknown): v is StoreOfferStatus {
  return typeof v === 'string' && (OFFER_STATUS_LIST as readonly string[]).includes(v);
}
/** The chip's catalogue key (all six in en / hi / gu); an unknown status → "status unknown", never the raw enum. */
export function offerStatusKey(status: unknown): string {
  return isOfferStatus(status) ? `offers.status.${status}` : 'store3b.status.unknown';
}
export function offerStatusTone(status: unknown): 'done' | 'waiting' | 'closed' {
  if (status === 'accepted' || status === 'converted') return 'done';
  if (status === 'rejected' || status === 'expired') return 'closed';
  return 'waiting';
}

export const OFFER_TABS = ['all', ...OFFER_STATUS_LIST] as const;
export type OfferTab = (typeof OFFER_TABS)[number];
export interface TabCount { count: number; capped: boolean }
/** `?status=` read back: anything unknown is `all` (a hand-typed URL is never an error page). */
export function readOfferTab(raw: unknown): OfferTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OFFER_TABS as readonly string[]).includes(String(v ?? '')) ? (v as OfferTab) : 'all';
}
export function offersHref(slug: string, tab: OfferTab = 'all', cursor?: string | null): string {
  const p = new URLSearchParams();
  if (tab !== 'all') p.set('status', tab);
  if (cursor) p.set('cursor', cursor);
  const q = p.toString();
  return `${slugPath(slug)}/offers${q ? `?${q}` : ''}`;
}
export function offerHref(slug: string, id: string, q: Record<string, string> = {}): string {
  const qs = new URLSearchParams(q).toString();
  return `${slugPath(slug)}/offers/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
}
export const orderHref = (slug: string, orderId: string) => `${slugPath(slug)}/orders/${encodeURIComponent(orderId)}`;
export interface OfferTabView { tab: OfferTab; href: string; labelKey: string; count: TabCount | null; current: boolean }
/** The chips: every status + all, the label key, the BOUNDED count (null when the counts could not be read — the chip is still a link). */
export function offerTabs(slug: string, current: OfferTab, counts: Partial<Record<OfferTab, TabCount>> | null): OfferTabView[] {
  return OFFER_TABS.map((s) => {
    const c = counts?.[s];
    const ok = !!c && Number.isInteger(c.count) && c.count >= 0;
    return { tab: s, href: offersHref(slug, s), labelKey: s === 'all' ? 'store3b.tab.all' : offerStatusKey(s), count: ok ? { count: c!.count, capped: c!.capped === true } : null, current: s === current };
  });
}
/** "(n)" or, past the API's cap, "(n+)" — 3a's catalogue forms (no number typed in a catalogue). */
export function tabCountForm(c: TabCount): { key: 'store3a.tab.count' | 'store3a.tab.countCapped'; n: number } {
  return { key: c.capped ? 'store3a.tab.countCapped' : 'store3a.tab.count', n: c.count };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE TURN MODEL (E1) — the API's word, never re-derived                                                                              */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const OFFER_ACTS = ['accept', 'counter', 'decline'] as const;
export type OfferActName = (typeof OFFER_ACTS)[number];
interface OfferFacts { status?: unknown; yourTurn?: unknown; allowedActs?: unknown; round?: unknown; conversion?: unknown; convertedOrderId?: unknown }

/** The acts this page may OFFER the buyer: only on the buyer's turn (the API's `yourTurn`) and only those the API allows. FAIL-CLOSED: an
 *  unknown shape, a terminal status or the organisation's turn → none. */
export function actsFor(o: OfferFacts): OfferActName[] {
  if (o.yourTurn !== true) return [];
  if (!(NEGOTIABLE as readonly unknown[]).includes(o.status)) return [];
  const allowed = Array.isArray(o.allowedActs) ? o.allowedActs : [];
  return OFFER_ACTS.filter((a) => allowed.includes(a));
}
export function readAct(raw: unknown): OfferActName | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OFFER_ACTS as readonly string[]).includes(String(v ?? '')) ? (v as OfferActName) : null;
}
/** Whose price is on the table (the entity's parity): an odd round — the buyer's offer awaits the organisation; even — the counter awaits you. */
export function onTable(round: unknown): 'yours' | 'theirs' {
  return typeof round === 'number' && round % 2 === 0 ? 'theirs' : 'yours';
}
export const isNegotiable = (status: unknown) => (NEGOTIABLE as readonly unknown[]).includes(status);
/** The accepted offer's order: being created by the relay, or the link once it exists. */
export function conversionView(o: OfferFacts): { kind: 'creating' } | { kind: 'converted'; orderId: string } | null {
  if (o.status === 'converted' && typeof o.convertedOrderId === 'string' && o.convertedOrderId) return { kind: 'converted', orderId: o.convertedOrderId };
  if (o.status === 'accepted' || o.conversion === 'creating') return { kind: 'creating' };
  return null;
}

/** The thread lines the machine can produce — who did what (you / the organisation / the clock) — never a name. */
export const ROUND_LINES = ['you.offer', 'you.counter', 'you.accept', 'you.decline', 'org.counter', 'org.accept', 'org.decline', 'system.expire'] as const;
/** One thread line's catalogue key; a combination the machine never writes → "a step of this negotiation" (`store3b.round.unknown`). */
export function roundKey(r: { party?: unknown; act?: unknown }): string {
  const who = r.party === 'buyer' ? 'you' : r.party === 'seller' ? 'org' : r.party === 'system' ? 'system' : null;
  const line = who ? `${who}.${String(r.act)}` : '';
  return (ROUND_LINES as readonly string[]).includes(line) ? `store3b.round.${line}` : 'store3b.round.unknown';
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE DECLINE REASONS (founder D3)                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const OFFER_DECLINE_REASON_LIST = ['price', 'lot_committed', 'quantity', 'timing', 'changed_mind', 'other'] as const;
export type StoreDeclineReason = (typeof OFFER_DECLINE_REASON_LIST)[number];
export const declineReasonKey = (code: string) => `store3b.reason.${code}`;
export function readDeclineReason(raw: unknown): StoreDeclineReason | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OFFER_DECLINE_REASON_LIST as readonly string[]).includes(String(v ?? '')) ? (v as StoreDeclineReason) : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE COUNTER PRICE — the LISTING's exponent (C-4: the legacy two-decimal default is gone from the offer pages)                       */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** A typed per-unit price → minor units in the offer's (the listing's) currency; null when the currency is unknown or the text is not a
 *  positive number with at most that many decimals (refused by name: "invalid price"). String math only. */
export function counterMinor(raw: unknown, currencyCode: string | null | undefined): string | null {
  const exp = currencyExponent(currencyCode);
  if (exp === null) return null;
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().replace(/,/g, '');
  const m = parseMajorToMinor(s, exp);
  return m && /[1-9]/.test(m) ? m : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* "OFFER AGAIN" — a chain-form to the listing's offer form, the old terms pre-filled (DELTA vs the FM's "filter")                      */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const PRICE = /^\d{1,12}(\.\d{1,4})?$/;
/** Only an expired or declined offer is offered again. */
export const offersAgain = (status: unknown) => status === 'expired' || status === 'rejected';
/** The listing's page with `?qty=&price=` (the price in the listing's major units — a format, not a computation) and the offer form's anchor. */
export function offerAgainHref(slug: string, listingId: string, quantity: string, priceMinor: string, currencyCode: string | null | undefined): string {
  const p = new URLSearchParams();
  const qty = String(quantity ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (QTY.test(qty)) p.set('qty', qty);
  const exp = currencyExponent(currencyCode);
  if (exp !== null) { const major = minorToMajor(priceMinor, exp); if (PRICE.test(major)) p.set('price', major); }
  const q = p.toString();
  return `${slugPath(slug)}/listings/${encodeURIComponent(listingId)}${q ? `?${q}` : ''}#offer`;
}
/** The listing page reads the prefill back: shape-checked strings, or nothing (the form's own defaults). */
export function readOfferPrefill(sp: Record<string, unknown>): { qty: string | null; price: string | null } {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const q = String(one(sp.qty) ?? ''); const pr = String(one(sp.price) ?? '');
  return { qty: QTY.test(q) ? q : null, price: PRICE.test(pr) ? pr : null };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE NAMED OUTCOMES (W3122 success · W3123 failure)                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const OFFER_FAILURES = ['not_your_turn', 'expired', 'not_negotiable', 'stock_short', 'listing_unavailable', 'seller_unavailable', 'max_life',
  'invalid_price', 'reason_required', 'reason_unknown', 'flag_off', 'concurrency', 'failed'] as const;
export type OfferFailure = (typeof OFFER_FAILURES)[number];
/** An API refusal → the act's named failure (never "try again" for a cause the server named). */
export function offerFailureOf(code: string | null | undefined, status?: number | null): OfferFailure {
  switch (code) {
    case 'OFFER_NOT_YOUR_TURN': return 'not_your_turn';
    case 'OFFER_EXPIRED': return 'expired';
    case 'OFFER_NOT_NEGOTIABLE': case 'OFFER_ILLEGAL_TRANSITION': return 'not_negotiable';
    case 'OFFER_STOCK_SHORT': return 'stock_short';
    case 'OFFER_LISTING_UNAVAILABLE': return 'listing_unavailable';
    case 'OFFER_SELLER_UNAVAILABLE': return 'seller_unavailable';
    case 'OFFER_MAX_LIFE': return 'max_life';
    case 'OFFER_INVALID': case 'VALIDATION_FAILED': return 'invalid_price';
    case 'OFFER_DECLINE_REASON_UNKNOWN': return 'reason_unknown';
    // a duplicate still in flight (the idempotency service's 409) or any other 409 → Retry with the SAME key
    case 'CONFLICT': return 'concurrency';
    // the `offers` flag OFF answers 404 for every offers route (the flag guard: invisible when disabled) — the action re-reads the store's flag
    // and says `flag_off` when it is OFF; a 404 with the flag ON is `failed` (never guessed)
    default: return status === 409 ? 'concurrency' : 'failed';
  }
}
export function readFailure(raw: unknown): OfferFailure | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || v === '') return null;
  return (OFFER_FAILURES as readonly string[]).includes(v) ? (v as OfferFailure) : 'failed';
}
/** The stock-short refusal names the organisation's remainder (`available`, the API's decimal text) — shape-checked, never computed. */
export function readAvailable(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && QTY.test(v) ? v : null;
}
export const OFFER_OK = ['accepted', 'countered', 'declined'] as const;
export type OfferOk = (typeof OFFER_OK)[number];
export function readOfferOk(raw: unknown): OfferOk | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OFFER_OK as readonly string[]).includes(String(v ?? '')) ? (v as OfferOk) : null;
}
/** The key of one minted act (the Idempotency-Key — minted when the confirm renders, reused on Retry; the API binds it to this offer). */
export function offerActKey(act: OfferActName, offerId: string, nonce: string): string {
  return `${act}:${offerId}:${nonce}`.slice(0, 120);
}
export const ACT_KEY = /^[A-Za-z0-9:_-]{8,120}$/;
