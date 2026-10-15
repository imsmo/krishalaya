// apps/web-storefront/src/features/store3a/orders.ts · PC-56 STORE-3a · C1–C5 — THE ORDER PAGES' PURE HALF (no React, no Next, no I/O; type-only
// SDK imports; unit-tested in test/store3a-orders.spec.ts).
//
//   • the buyer's five tabs (founder D4) and their hrefs under the ORGANISATION's chrome (`/<slug>/orders`, founder D3);
//   • which acts an order shows — the Pay link (awaiting the buyer's payment, NEVER an auction order: its pay step still sends the total — 3c),
//     the "I received it" act (delivered AND paid into escrow only — lead's D6, FAIL-CLOSED like the API), the cancel door (the API's
//     `isCancellable`: through `ready`), the acceptance-deadline sentence (not for an auction order — the clock does not run for it);
//   • the cancel form's codec (a reason from the vocabulary; `other` needs a note ≤ 280) and every named outcome of the cancel and complete acts;
//   • the refund view of a cancelled order, from the payment read (`refund` — 0210 — and the newest attempt): nothing was paid / starting /
//     requested / refunded with its reference / partly refunded.
// NO MONEY ARITHMETIC: every amount printed is the API's (total, amount due, deposit applied, refund amount).
import { processingView } from '../store2c/checkout';

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE TABS (W288, founder D4)                                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const STORE_ORDER_GROUPS = ['all', 'active', 'attention', 'completed', 'cancelled'] as const;
export type StoreOrderGroup = (typeof STORE_ORDER_GROUPS)[number];
export interface GroupCount { count: number; capped: boolean }

/** `?group=` read back: anything unknown is `all` (never an error page for a hand-typed URL). */
export function readGroup(raw: unknown): StoreOrderGroup {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (STORE_ORDER_GROUPS as readonly string[]).includes(String(v ?? '')) ? (v as StoreOrderGroup) : 'all';
}
const slugPath = (slug: string) => `/${encodeURIComponent(slug)}`;
export function ordersHref(slug: string, group: StoreOrderGroup = 'all', cursor?: string | null): string {
  const p = new URLSearchParams();
  if (group !== 'all') p.set('group', group);
  if (cursor) p.set('cursor', cursor);
  const q = p.toString();
  return `${slugPath(slug)}/orders${q ? `?${q}` : ''}`;
}
export const groupHref = (slug: string, group: StoreOrderGroup) => ordersHref(slug, group);
export const orderHref = (slug: string, id: string, q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(q).toString();
  return `${slugPath(slug)}/orders/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
};
export const cancelHref = (slug: string, id: string, q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(q).toString();
  return `${slugPath(slug)}/orders/${encodeURIComponent(id)}/cancel${qs ? `?${qs}` : ''}`;
};

export interface OrderTab { group: StoreOrderGroup; href: string; labelKey: string; count: GroupCount | null; current: boolean }
/** The tab model: every tab, its label key, its BOUNDED count (null when the counts could not be read — the tab is still a link). */
export function orderTabs(slug: string, current: StoreOrderGroup, counts: Partial<Record<StoreOrderGroup, GroupCount>> | null): OrderTab[] {
  return STORE_ORDER_GROUPS.map((g) => {
    const c = counts?.[g];
    const ok = !!c && Number.isInteger(c.count) && c.count >= 0;
    return { group: g, href: groupHref(slug, g), labelKey: `store3a.tab.${g}`, count: ok ? { count: c!.count, capped: c!.capped === true } : null, current: g === current };
  });
}
/** How a count is said: the number, or — past the API's cap — "<n>+" through the catalogue's own form (no number typed in a catalogue). */
export function countForm(c: GroupCount): { key: 'store3a.tab.count' | 'store3a.tab.countCapped'; n: number } {
  return { key: c.capped ? 'store3a.tab.countCapped' : 'store3a.tab.count', n: c.count };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* WHICH ACTS AN ORDER SHOWS                                                                                                            */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
interface OrderFacts { status?: unknown; paymentState?: unknown; source?: unknown; acceptanceDeadline?: unknown }

/** The Pay link (W289): ONLY an order awaiting the buyer's online payment — and never an AUCTION order, whose pay step would still send the
 *  total while the API wants total − deposit (refused by name until STORE-3c). */
export function showsPayLink(o: OrderFacts): boolean {
  return o.paymentState === 'pending' && o.source !== 'auction';
}
/** An auction order awaiting its balance: the Pay link is withheld and the refusal is printed instead. */
export function auctionBalanceRefused(o: OrderFacts): boolean {
  return o.paymentState === 'pending' && o.source === 'auction';
}
/** "I received it" (lead's D6, Law 9): ONLY a delivered order that was PAID INTO ESCROW. FAIL-CLOSED: any other state, an unknown payment state
 *  or a pay-on-delivery order (`none`) → false (the API refuses the act too: ORDER_COMPLETE_REQUIRES_ESCROW). */
export function showsReceivedAct(o: OrderFacts): boolean {
  return o.status === 'delivered' && o.paymentState === 'paid';
}
/** A delivered pay-on-delivery order: the organisation completes it — said honestly instead of offering an act that would be refused. */
export function codDeliveredLine(o: OrderFacts): boolean {
  return o.status === 'delivered' && o.paymentState === 'none';
}
/** The API's `isCancellable` (apps/api orders/domain/order.state.ts): free cancel with a full refund to source through `ready` (founder D1). */
export const CANCELLABLE_STATUSES = ['created', 'payment_pending', 'confirmed', 'packed', 'ready'] as const;
export function canCancel(status: unknown): boolean {
  return typeof status === 'string' && (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}
/** The acceptance-deadline sentence ("the organisation has until <time> to confirm"): true since HOTFIX-5 for an order not yet confirmed —
 *  never for an auction order (the 24 h clock excludes it; its balance window rules — founder D2). */
export function showsDeadline(o: OrderFacts): boolean {
  return (o.status === 'created' || o.status === 'payment_pending') && o.source !== 'auction' && typeof o.acceptanceDeadline === 'string' && o.acceptanceDeadline !== '';
}
/** The deposit / balance rows (W289, survey B3): ONLY when the API says a deposit was applied (> 0). A comparison of a server string to zero —
 *  nothing is computed. */
export function showsDepositRows(o: { depositAppliedMinor?: string | null }): boolean {
  const d = o.depositAppliedMinor;
  return typeof d === 'string' && /^\d+$/.test(d) && /[1-9]/.test(d);
}
/** The primary item line ("<title> · <qty> <unit>") + how many more lines the order has (null when none). */
export function moreItems(itemCount: unknown): number | null {
  return typeof itemCount === 'number' && itemCount > 1 ? itemCount - 1 : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE CANCEL FORM (W3083) — the reason from the vocabulary, the note for `other`                                                       */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const CANCEL_NOTE_MAX = 280;
export interface CancelReasonOption { id: string; code: string; name: string; textRequired: boolean }
/** The lookup rows → the radios (a value whose meta says textRequired needs the note). */
export function reasonOptions(values: ReadonlyArray<{ id: string; code: string; name: string; meta?: Record<string, unknown> | null }> | null | undefined): CancelReasonOption[] {
  return (values ?? []).filter((v) => typeof v.id === 'string' && UUID.test(v.id) && typeof v.code === 'string')
    .map((v) => ({ id: v.id, code: v.code, name: v.name, textRequired: v.meta?.textRequired === true }));
}
/** A reason's label: the storefront's own catalogue (`order.cancelReason.<code>`) when it has one, else the vocabulary's `name` as served. */
export const cancelReasonKey = (code: string) => `order.cancelReason.${code}`;

export type CancelFormError = 'reason_required' | 'reason_unknown' | 'note_required' | 'note_too_long';
export interface CancelForm { reasonId: string; note: string }
/** Read and check the submitted form against the offered reasons (the API re-checks every rule). */
export function checkCancelForm(get: (k: string) => unknown, options: readonly CancelReasonOption[]): { ok: true; value: { reasonId: string; note?: string } } | { ok: false; error: CancelFormError; kept: CancelForm } {
  const reasonId = String(get('reasonId') ?? '').trim();
  const rawNote = String(get('note') ?? '');
  const note = rawNote.trim();
  const kept = { reasonId: UUID.test(reasonId) ? reasonId : '', note: rawNote.slice(0, CANCEL_NOTE_MAX) };
  if (!reasonId) return { ok: false, error: 'reason_required', kept };
  const opt = options.find((o) => o.id === reasonId);
  if (!opt) return { ok: false, error: 'reason_unknown', kept };
  if (note.length > CANCEL_NOTE_MAX) return { ok: false, error: 'note_too_long', kept };
  if (opt.textRequired && !note) return { ok: false, error: 'note_required', kept };
  return { ok: true, value: opt.textRequired ? { reasonId, note } : { reasonId } };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE NAMED OUTCOMES (W3084 success · W3085 failure)                                                                                   */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const CANCEL_OUTCOMES = ['moved', 'forbidden', 'reason_required', 'reason_unknown', 'note_required', 'note_too_long', 'concurrency', 'failed'] as const;
export type CancelOutcome = (typeof CANCEL_OUTCOMES)[number];
/** An API refusal → the cancel page's named failure (never "try again" for a cause the server named). */
export function cancelOutcomeKey(code: string | null | undefined, status?: number | null): CancelOutcome {
  switch (code) {
    case 'ORDER_ILLEGAL_TRANSITION': return 'moved';
    case 'ORDER_FORBIDDEN': return 'forbidden';
    case 'CANCEL_REASON_REQUIRED': return 'reason_required';
    case 'CANCEL_REASON_UNKNOWN': return 'reason_unknown';
    case 'CANCEL_NOTE_REQUIRED': return 'note_required';
    case 'ORDER_CONCURRENCY_CONFLICT': return 'concurrency';
    default: return status === 403 ? 'forbidden' : 'failed';
  }
}
export function readCancelOutcome(raw: unknown): CancelOutcome | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || v === '') return null;
  return (CANCEL_OUTCOMES as readonly string[]).includes(v) ? (v as CancelOutcome) : 'failed';
}
export const COMPLETE_OUTCOMES = ['escrow', 'moved', 'failed'] as const;
export type CompleteOutcome = (typeof COMPLETE_OUTCOMES)[number];
export function completeOutcomeKey(code: string | null | undefined): CompleteOutcome {
  if (code === 'ORDER_COMPLETE_REQUIRES_ESCROW') return 'escrow';
  if (code === 'ORDER_ILLEGAL_TRANSITION') return 'moved';
  return 'failed';
}
export function readCompleteOutcome(raw: unknown): CompleteOutcome | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || v === '') return null;
  return (COMPLETE_OUTCOMES as readonly string[]).includes(v) ? (v as CompleteOutcome) : 'failed';
}
/** The acts' success notices the order page prints (`?ok=`). */
export const ORDER_OK = ['cancelled', 'received', 'dispute'] as const;
export function readOk(raw: unknown): (typeof ORDER_OK)[number] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (ORDER_OK as readonly string[]).includes(String(v ?? '')) ? (v as (typeof ORDER_OK)[number]) : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* WHAT COMES BACK / WHAT HAPPENED TO THE MONEY                                                                                        */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
interface AttemptsLike {
  latest?: { status?: string | null; amountMinor?: string | null; currencyCode?: string | null; expiresAt?: string | null } | null;
  refund?: { state?: string | null; amountMinor?: string | null; currencyCode?: string | null; initiatedAt?: string | null; completedAt?: string | null; gatewayRefundId?: string | null } | null;
}
export type RefundKind = 'nothing_paid' | 'starting' | 'refunding' | 'refunded' | 'partial';
export interface RefundLine { kind: RefundKind; amountMinor: string | null; currencyCode: string | null; reference: string | null; completedAt: string | null }
/** A CANCELLED order's money, from the payment read: the `refund` the API states (0210), else the newest attempt (2c's processingView).
 *  Captured but not yet refunded → `starting` (the automatic refund is booked by the relay); nothing captured → `nothing_paid`. */
export function refundView(a: AttemptsLike | null | undefined, now: Date = new Date()): RefundLine {
  const r = a?.refund;
  const none = (kind: RefundKind, amount: string | null = null, cur: string | null = null): RefundLine => ({ kind, amountMinor: amount, currencyCode: cur, reference: null, completedAt: null });
  if (r && r.state === 'refunded') return { kind: 'refunded', amountMinor: r.amountMinor ?? null, currencyCode: r.currencyCode ?? null, reference: r.gatewayRefundId ?? null, completedAt: r.completedAt ?? null };
  if (r && r.state === 'partial') return { kind: 'partial', amountMinor: r.amountMinor ?? null, currencyCode: r.currencyCode ?? null, reference: r.gatewayRefundId ?? null, completedAt: r.completedAt ?? null };
  if (r && r.state === 'initiated') return none('refunding', r.amountMinor ?? null, r.currencyCode ?? null);
  const v = processingView(a?.latest ?? null, now);
  if (v === 'refunded') return none('refunded', a?.latest?.amountMinor ?? null, a?.latest?.currencyCode ?? null);
  if (v === 'refunding') return none('refunding', a?.latest?.amountMinor ?? null, a?.latest?.currencyCode ?? null);
  if (v === 'success') return none('starting', a?.latest?.amountMinor ?? null, a?.latest?.currencyCode ?? null);
  return none('nothing_paid');
}
export const refundKey = (k: RefundKind) => `store3a.refund.${k}`;

/** The cancel confirm's "what comes back" (W3083): a PAID order → the captured amount back to its source (from the payment read; the API's
 *  figure) — or, when the read is unavailable, the sentence without a figure; anything else → "nothing was paid — nothing to refund". */
export function whatComesBack(order: { paymentState?: unknown }, a: AttemptsLike | null | undefined): { kind: 'back_to_source' | 'back_unknown_amount' | 'nothing_paid'; amountMinor: string | null; currencyCode: string | null } {
  if (order.paymentState !== 'paid') return { kind: 'nothing_paid', amountMinor: null, currencyCode: null };
  const l = a?.latest;
  if (l && l.status === 'success' && typeof l.amountMinor === 'string') return { kind: 'back_to_source', amountMinor: l.amountMinor, currencyCode: l.currencyCode ?? null };
  return { kind: 'back_unknown_amount', amountMinor: null, currencyCode: null };
}
/** The auction warning on the cancel confirm (HOTFIX-5 D4 / the founder's forfeit ruling): unpaid → the deposit is FORFEITED to the
 *  organisation; paid → the deposit and the payment are returned. null for every other order. */
export function auctionCancelWarning(order: { source?: unknown; paymentState?: unknown }): 'forfeit' | 'returned' | null {
  if (order.source !== 'auction') return null;
  return order.paymentState === 'paid' ? 'returned' : 'forfeit';
}
/** Who ended a cancelled order (from the buyer's events read — the hop that went to `cancelled`): you, the organisation, the system (the
 *  organisation did not confirm in time), or the platform's moderators. null when the read did not say. */
export function cancelledBy(events: ReadonlyArray<{ toStatus?: string | null; actorRole?: string | null }> | null | undefined): 'buyer' | 'seller' | 'system' | 'moderator' | null {
  const hop = (events ?? []).find((e) => e.toStatus === 'cancelled');
  const r = hop?.actorRole;
  return r === 'buyer' || r === 'seller' || r === 'system' || r === 'moderator' ? r : null;
}

/** The key of one minted act (the cancel / complete Idempotency-Key — minted when the page renders, so a retried submit is the same request). */
export function actKey(act: 'cancel' | 'complete', orderId: string, nonce: string): string {
  return `${act}:${orderId}:${nonce}`.slice(0, 120);
}

/** The dispute form's named failures (`?error=`) — the 2c-era keys `order.error.dispute*` are reused. */
export const DISPUTE_ERRORS = ['dispute', 'dispute_reason', 'dispute_description', 'dispute_dup'] as const;
export function readDisputeError(raw: unknown): (typeof DISPUTE_ERRORS)[number] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (DISPUTE_ERRORS as readonly string[]).includes(String(v ?? '')) ? (v as (typeof DISPUTE_ERRORS)[number]) : null;
}
/** Statuses at which a dispute may be raised (the state machine's `→ disputed` edges; the API re-checks eligibility). */
export const DISPUTABLE = ['confirmed', 'packed', 'ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'partially_fulfilled', 'completed'] as const;
export function canDispute(status: unknown): boolean { return typeof status === 'string' && (DISPUTABLE as readonly string[]).includes(status); }
