// apps/web-storefront/src/features/store3a/refusals.ts · PC-56 STORE-3a · brief §E — what the order pages do NOT claim, BY NAME. PURE.
// (The shape of features/store2/refusals.ts `STORE2C_*`.) Each refused canon claim is listed ONCE with where the canon makes it and the surfaces
// it is PRINTED on (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page — or the
// refused copy coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
export type Store3aSurface = 'orders' | 'order' | 'cancel' | 'confirm';
export interface Store3aRefusal { id: string; canon: string; surfaces: readonly Store3aSurface[]; key: string; why: string }

export const STORE3A_REFUSALS: readonly Store3aRefusal[] = Object.freeze([
  { id: 'fee_ladder', canon: 'W291 the rules ladder "after packed: refund minus ₹200 packing recovery" · "after picked_up: minus the delivery charge ₹531" · "you can still refuse at the gate — the freight deduction applies"', surfaces: ['cancel'],
    key: 'store3a.refusal.feeLadder', why: 'founder D1 (Q5): no cancellation fee exists — free with a full refund to source through `ready`, closed after pickup; no fee leg anywhere' },
  { id: 'bank_days', canon: 'W291 "Refunds go to the source payment method in 3–5 bank days" · the confirm "arrives in 3–5 bank days"', surfaces: ['cancel', 'order'],
    key: 'store3a.refusal.bankDays', why: 'the provider\'s timing is not proven (Razorpay test-mode proof owed) — the page says what the payment read says, never a number of days' },
  { id: 'we_chase', canon: 'W291 "Refund delayed past 5 days — we chase with the reference rfnd_KV16904"', surfaces: ['cancel'],
    key: 'store3a.refusal.weChase', why: 'nothing chases a refund; the provider\'s reference is printed once the source confirms it, for the buyer to quote' },
  { id: 'helpline', canon: 'W289 / W291 "quote ORD-… on 1800-419-0123"', surfaces: ['orders', 'order', 'cancel'],
    key: 'store3a.refusal.helpline', why: 'the helpline is an unimplemented placeholder (STORE-1a C-2)' },
  { id: 'notified_reason', canon: 'W291 confirm "Meera Ben is notified with your reason"', surfaces: ['cancel'],
    key: 'store3a.refusal.notifiedReason', why: '`orders.order_cancelled` has no notification row or template (survey B27, a later wave); the reason is recorded on the order and the audit' },
  { id: 'partial_refund', canon: 'W288 "delivered 7.6 of 8 qtl · ₹1,008 refunded" · W289 "the 0.4 qtl gap refunds automatically at the line price" · W291 "0.4 qtl × ₹2,520 = ₹1,008"', surfaces: ['orders', 'order', 'cancel'],
    key: 'store3a.refusal.partialRefund', why: 'founder D2 (Q6): no partial-fulfilment refund exists (B12, a later money wave) — no arithmetic is printed' },
  { id: 'first_pick', canon: 'W289 cancelled by the farmer "Full auto-refund + first pick of equivalent lots nearby"', surfaces: ['order'],
    key: 'store3a.refusal.firstPick', why: 'no such queue or matching exists' },
  { id: 'cancel_rate', canon: 'W289 "The farmer\'s cancellation rate is visible on their profile"', surfaces: ['order'],
    key: 'store3a.refusal.cancelRate', why: 'the organisation page carries no cancellation rate; no person is named (HOTFIX-4 D3)' },
  { id: 'regrade', canon: 'W287 / W289 "dispatch re-grade at Junagadh centre … fresh grading slip photo" · "the re-grade slip is the reference"', surfaces: ['order', 'confirm'],
    key: 'store3a.refusal.regrade', why: 'no dispatch re-grade step exists (refused since 2a)' },
  { id: 'slots', canon: 'W287 / W288 / W289 "delivery Wed 15 Jul 09:00–13:00" · "arriving tomorrow"', surfaces: ['orders', 'order', 'confirm'],
    key: 'store3a.refusal.slots', why: 'no delivery slot or ETA exists (refused 2c, founder D7)' },
  { id: 'otp_gate', canon: 'W289 "OTP handover at your gate, Wed 15 Jul 09:00–13:00"', surfaces: ['order'],
    key: 'store3a.refusal.otpGate', why: 'no slot exists; a shipment may require an OTP — said on the shipment when it does' },
  { id: 'hsn', canon: 'W289 money aside "Produce (HSN 1202, 0% GST)" · "Delivery (SAC 9967)" · "GST 18% on delivery"', surfaces: ['order'],
    key: 'store3a.refusal.hsn', why: 'founder 2c D5: GST is included and extracted, never added; no HSN / SAC at placement' },
  { id: 'good_news', canon: 'W287 H1 "Two farmers just heard good news" · "one SMS + app message sent to you"', surfaces: ['confirm'],
    key: 'store3a.refusal.goodNews', why: 'no seller notification on placement and no buyer SMS for it; no person is named' },
  { id: 'escrow_freeze', canon: 'W289 disputed "Escrow freezes for the disputed value only — the clean remainder still pays the farmer on time"', surfaces: ['order'],
    key: 'store3a.refusal.escrowFreeze', why: 'not proven (disputes are STORE-5); a disputed order says "under review" only' },
  { id: 'flagged_off', canon: 'W288 / W289 / W291 "Flagged off — My Orders / Order / Cancellations disabled for this tenant/plan"', surfaces: ['orders', 'order', 'cancel'],
    key: 'store3a.refusal.flaggedOff', why: 'founder D3 (Q12): no kill-switch on a buyer\'s own order history' },
  // PC-56 STORE-4b · C4: `get_help` ("Get help on this order") is REMOVED — the order page now offers "Message the organisation about this
  // order" (founder D1: the buyer's ONE thread with the organisation), so the refusal would be false.
  { id: 'cross_store', canon: 'W288 one list across Anand FPO, Unjha Kisan FPC and Kisan Sathi FPC', surfaces: ['orders'],
    key: 'store3a.refusal.crossStore', why: 'one store per session (2b D3): this organisation\'s orders only (B30, a later wave)' },
  { id: 'saved_on_phone', canon: 'W288 error/offline "as of 20 minutes ago (saved on this phone)"', surfaces: ['orders'],
    key: 'store3a.refusal.savedOnPhone', why: 'nothing is saved on the phone; the error says so, with a Retry (STORE-6)' },
  { id: 'returns_form', canon: 'W289 the returns form · W291 "disputes, not returns-on-a-whim"', surfaces: ['order'],
    key: 'store3a.refusal.returns', why: 'founder D2 (Q6): disputes only — the returns form is hidden on the storefront' },
  { id: 'out_of_pocket', canon: 'W291 "never out of the farmer\'s pocket for platform or logistics failures"', surfaces: ['cancel'],
    key: 'store3a.refusal.outOfPocket', why: 'not proven by any rule in the code' },
  { id: 'oncall', canon: 'W3085 "repeated failures page the on-call"', surfaces: ['cancel'],
    key: 'store3a.refusal.oncall', why: 'nothing pages anyone; the failure is said by name, with a retry' },
]);

/** The canon shapes STORE-3a builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE3A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'orders_route', canon: 'W288 / W289 / W291 `(marketplace)/orders…` under the platform header', built: '`/<slug>/orders`, `/<slug>/orders/[id]`, `/<slug>/orders/[id]/cancel` under the organisation\'s chrome (founder D3); the platform\'s /orders and /orders/[id] are doors (lib/store-door.ts)' },
  { id: 'keyset_pages', canon: 'W288 "Showing 1–5 of 23 · ‹ Prev / Next ›"', built: 'keyset Next only + the bounded tab counts (Law 11)' },
  // PC-56 STORE-5a · C1 (founder Q13): the owed DELTA is closed — W290 is built under the organisation; the platform route is a door.
  { id: 'review_route', canon: 'W290 review `(marketplace)/orders/[id]/review`', built: 'BUILT by STORE-5a at /<slug>/orders/[id]/review (+ /review/edit), the organisation\'s chrome; the order page links there when the store\'s `reviews` flag is ON; the platform /orders/[id]/review is a door' },
  { id: 'retry_reload', canon: 'W3058 "Confirm this action" before Retry on W288 / W289 (+ "Confirming writes an audit-trail entry")', built: 'Retry is a reload (a read): no confirm, no audit entry — W3058–W3060 are DECOR' },
  { id: 'chain_back_links', canon: 'W3059 / W3060 / W3084 "Back" → W316', built: 'Back returns to the order list (or the order) itself — W316 is the error canon (survey F-25)' },
  { id: 'cancel_confirm_page', canon: 'W291 the rules page + a confirm dialog (W3083)', built: 'one page: the rules as the code has them, then the confirm form on the same page (no client dialog — no JS needed)' },
]);

/** The 10 STORE-3a canon files and their verdicts. */
export const STORE3A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W287-store-order-confirmed.html', flowmap: 'route `checkout/done` (0 data-flowmap)', verdict: 'BUILT on /<slug>/checkout/confirm — "Track this order" per order, "View orders", the deadline sentence, "What happens next"' },
  { file: 'W288-store-orders.html', flowmap: 'data-flowmap="chain-mutate:order" ("Retry") → W3058', verdict: 'BUILT at /<slug>/orders — five tabs with bounded counts, keyset' },
  { file: 'W289-store-order-detail.html', flowmap: 'data-flowmap="chain-mutate:order" ("Retry") → W3058', verdict: 'BUILT at /<slug>/orders/[id]' },
  { file: 'W291-store-cancel-refund.html', flowmap: 'data-flowmap="chain-mutate:cancel" ("Retry") → W3083', verdict: 'BUILT at /<slug>/orders/[id]/cancel — the rules as the code has them; the ladder refused (founder D1)' },
  { file: 'W3058-store-order-mutate-confirm.html', flowmap: 'W288 / W289 Retry', verdict: 'PARITY-DECOR — Retry is a reload of the page (DELTA retry_reload)' },
  { file: 'W3059-store-order-mutate-success.html', flowmap: 'W3058 Proceed', verdict: 'PARITY-DECOR — the re-rendered page; "Back → W316" is a canon defect (DELTA chain_back_links)' },
  { file: 'W3060-store-order-mutate-failure.html', flowmap: 'W3058 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry; "Back → W316" defect' },
  { file: 'W3083-store-cancel-mutate-confirm.html', flowmap: 'W291 "Cancel this order" / Retry', verdict: 'BUILT — the confirm: the order, what comes back, the auction warning, the reason (+ note for other), a key minted at render, the pending lock' },
  { file: 'W3084-store-cancel-mutate-success.html', flowmap: 'W3083 Proceed', verdict: 'BUILT — the order page `?ok=cancelled` with the refund state from the payment read' },
  { file: 'W3085-store-cancel-mutate-failure.html', flowmap: 'W3083 Proceed (failure)', verdict: 'BUILT — the named failure (moved forward / not a party / reason / note / concurrency → Retry with the same key / anything else: nothing changed); on-call refused' },
]);

export function store3aRefusalKeys(surface: Store3aSurface): string[] {
  return STORE3A_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
