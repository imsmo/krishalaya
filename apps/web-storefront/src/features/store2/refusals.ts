// apps/web-storefront/src/features/store2/refusals.ts · PC-56 HOTFIX-4 · brief §E — the canon claims on the money pages this hotfix does NOT
// make, BY NAME, and the defects it names but does not fix. PURE. (Pattern: features/home/refusals.ts.)
//
// A trust surface renders only verified truth (Contract §3 Law 12). Each refused claim is listed ONCE with where the canon makes it and how
// this build answers it: RENDERED as a keyed refusal sentence on the confirmation page (`key`), or RECORDED (owed to a named wave / founder
// question). The render test reads this map, so a refusal that silently disappears from /checkout/confirm — or the refused copy coming
// back into a catalogue — turns a test red.
export type RefusalAnswer = 'rendered' | 'recorded';
export interface Refusal { id: string; canon: string; answer: RefusalAnswer; key?: string; why: string }

export const STORE2_HOTFIX4_REFUSALS: readonly Refusal[] = Object.freeze([
  // PC-56 STORE-2c (founder D3): `auto_refund` is NO LONGER a refusal — a cancelled / declined / auto-cancelled PAID order is refunded to source
  // automatically (apps/api payments/events/handlers/order-cancelled-refund.handler.ts). Its refusal key is retired from every catalogue; the
  // true sentence (`store2c.refund.true`) is printed on the payment step and the confirmation instead.
  { id: 'cod_cap', canon: 'W284 "Cash on delivery … capped at ₹20,000 per order for rider safety"', answer: 'rendered', key: 'store2.refusal.codCap',
    why: 'founder D2: no per-order COD cap setting exists (the only cap is the per-rider cash-in-hand setting) — refused until a setting exists' },
  { id: 'one_payment_group', canon: 'W284 / W285 "One payment covers both orders; escrow splits it per order automatically"', answer: 'rendered', key: 'store2.refusal.onePayment',
    why: 'a checkout group has no payment path (survey F-6, founder Q5 — STORE-2c): each order is paid on its own and every order is named' },
  { id: 'price_includes_fee', canon: 'W277 "Price includes grading & platform fee"', answer: 'recorded',
    why: 'founder D4: false when a platform fee is ADDED at checkout — the fee prints as its own row instead; the sentence is in no catalogue' },
]);

/** Named here, NOT fixed by HOTFIX-4 (each owed to the wave / founder question in brackets). */
export const STORE2_HOTFIX4_OWED: readonly { id: string; what: string; owner: string }[] = Object.freeze([
  // PC-56 STORE-2c: F-2 (stock reserved at placement, D1), F-3 (automatic refund, D3) and F-10 (currency from the data, B4) are BUILT; F-6 is
  // decided (D2 — each order is paid on its own) and refused by name (`STORE2C_REFUSALS.one_payment`).
  { id: 'F-9', what: 'regulated inputs (licence / banned-state rules) are not enforced at cart or checkout', owner: 'founder Q12 · STORE-2b' },
]);

export function store2RefusalKey(id: string): string {
  const r = STORE2_HOTFIX4_REFUSALS.find((x) => x.id === id);
  if (!r || r.answer !== 'rendered' || !r.key) throw new Error(`store2 refusals: '${id}' is not a rendered refusal`);
  return r.key;
}
/** The keys the confirmation page prints (in this order). */
export const CONFIRM_REFUSAL_KEYS: readonly string[] = Object.freeze(STORE2_HOTFIX4_REFUSALS.filter((r) => r.answer === 'rendered').map((r) => r.key as string));

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* PC-56 STORE-2a · brief §E — what an anonymous buyer sees is true and private: W275 browse · W276 search · W277 listing · W280 seller   */
/* (→ the organisation's page) · W282 farm inputs, and their 12 Retry / Apply chain pages                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** The five STORE-2a surfaces. Each refusal names the surfaces it is PRINTED on (the render tests read this map). */
export type Store2aSurface = 'browse' | 'search' | 'listing' | 'sellers' | 'inputs';
export interface Store2aRefusal { id: string; canon: string; surfaces: readonly Store2aSurface[]; key: string; why: string }

/** Every canon claim STORE-2a does not make, BY NAME, and where it is printed (as a refusal sentence — never as an offer). */
export const STORE2A_REFUSALS: readonly Store2aRefusal[] = Object.freeze([
  { id: 'mandi_reference', canon: 'W275 "mandi reference today: ₹6,240/qtl (Junagadh APMC)" · W277 "this listing is ₹90 below it"', surfaces: ['browse', 'listing'],
    key: 'store2a.refusal.mandi', why: 'founder 1b D3: no licensed, attributed mandi source; market_intel is OFF and authed' },
  { id: 'tell_me_when', canon: 'W275 empty "tap Tell me when — we\'ll message you the moment one is published"', surfaces: ['browse', 'search'],
    key: 'store2a.refusal.tellMeWhen', why: 'saved searches store notify_new_matches and NOTHING reads it (survey F-21, GAP B21)' },
  { id: 'tell_me_if_returns', canon: 'W277 paused "Tell me if it returns — the seller sees the demand"', surfaces: ['listing'],
    key: 'store2a.refusal.tellMeIfReturns', why: 'a saved listing has no notifier (F-21)' },
  { id: 'follow_seller', canon: 'W280 "Follow seller — hear when the next lot lists"', surfaces: ['sellers'],
    key: 'store2a.refusal.follow', why: 'a saved seller has no notifier (F-21)' },
  { id: 'offline_catalogue', canon: 'W275 offline "listings saved from your last visit … you can still add to cart — it syncs"', surfaces: ['browse'],
    key: 'store2a.refusal.offline', why: 'no offline catalogue or cart queue (STORE-6); a queued cart contradicts Law 6\'s spirit' },
  { id: 'region_restricted', canon: 'W275 / W276 "Some varieties / results are region-restricted … left off quietly"', surfaces: ['browse', 'search'],
    key: 'store2a.refusal.regionRestricted', why: 'no feed consults banned_state rules (regulated-rule.entity.ts "Phase-2 hook")' },
  { id: 'multilingual_search', canon: 'W276 "We searched in three languages at once … spelling doesn\'t have to be perfect … Spoken search works too"', surfaces: ['search'],
    key: 'store2a.refusal.multilingual', why: 'title ILIKE / prefix only; no transliteration or phonetic analyser (survey B31)' },
  { id: 'voice_search', canon: 'W276 "Voice search — heard you as …" + "Speak again"', surfaces: ['search'],
    key: 'store2a.refusal.voice', why: 'no voice input exists' },
  { id: 'closest_matches', canon: 'W276 "Closest matches … We never show an empty wall"', surfaces: ['search'],
    key: 'store2a.refusal.closest', why: 'no relaxation logic; an empty answer is said as empty' },
  { id: 'distance', canon: 'W275 "Nearest first" · "4 km" · W277 "Delivery to 382330 Wed 15 Jul – Thu 16 Jul · ₹80/qtl/100km"', surfaces: ['browse', 'search', 'listing'],
    key: 'store2a.refusal.distance', why: 'founder D3: no location is asked for; per_km pricing is deferred and no delivery ETA exists (F-22)' },
  { id: 'ai_grade', canon: 'W277 "AI photo-grade suggested A (confidence 0.9142) — confirmed by centre staff"', surfaces: ['listing'],
    key: 'store2a.refusal.aiGrade', why: 'founder D2: an unconfirmed AI suggestion is not shown, and no confidence number' },
  { id: 'price_includes_fee', canon: 'W277 "Price includes grading & platform fee"', surfaces: ['listing'],
    key: 'store2a.refusal.priceFee', why: 'HOTFIX-4 D4: false when a platform fee is added at checkout; no grading fee exists' },
  { id: 'bulk_pricing', canon: 'W277 / W280 "Bulk pricing is verified-buyer-only"', surfaces: ['listing', 'sellers'],
    key: 'store2a.refusal.bulk', why: 'no bulk tiers and no buyer KYC exist' },
  { id: 'dispatch_regrade', canon: 'W277 "Quality promise: grade verified again at dispatch"', surfaces: ['listing'],
    key: 'store2a.refusal.dispatchRegrade', why: 'no dispatch re-grade step exists (founder Q16 → STORE-SWEEP W309)' },
  { id: 'farmer_identity', canon: 'W277 / W280 "Ramesh Patel · Anand FPO member #0412 · 12 bigha · since Oct 2021" + avatar + vernacular name', surfaces: ['listing', 'sellers'],
    key: 'store2a.refusal.farmer', why: 'HOTFIX-4 D3: seller identity = the ORGANISATION, everywhere' },
  { id: 'seller_badges', canon: 'W280 "KYC verified" · "centre-graded seller" · "126 completed sales"', surfaces: ['sellers'],
    key: 'store2a.refusal.badges', why: 'no such organisation-level record exists; completed sales have no public bounded read' },
  { id: 'reviews_translated', canon: 'W280 "Reviews can be written in any language — buyers read them translated"', surfaces: ['sellers'],
    key: 'store2a.refusal.translated', why: 'no translation exists' },
  { id: 'inputs_fifo_expiry', canon: 'W282 "sold batch-tracked, oldest stock first (FIFO), expiry always … on the page" + batch lines', surfaces: ['inputs'],
    key: 'store2a.refusal.fifo', why: 'checkout writes batchId null; no batch / expiry public read (F-9 / C-2, B15)' },
  { id: 'inputs_mrp', canon: 'W282 "MRP-capped price"', surfaces: ['inputs'],
    key: 'store2a.refusal.mrp', why: 'no MRP field exists' },
  { id: 'inputs_age', canon: 'W282 "licence-gated and 18+"', surfaces: ['inputs'],
    key: 'store2a.refusal.age', why: 'no age check exists (founder Q12 → STORE-2b)' },
  { id: 'inputs_label_helpline', canon: 'W282 "an emergency helpline on the label"', surfaces: ['inputs'],
    key: 'store2a.refusal.labelHelpline', why: 'no helpline exists' },
  { id: 'inputs_switch', canon: 'W282 "This seller organisation hasn\'t switched on input sales"', surfaces: ['inputs'],
    key: 'store2a.refusal.inputsSwitch', why: 'no per-organisation inputs flag; the platform browse switch is the only switch' },
  { id: 'flag_tenant_plan', canon: 'W275–W282 "Flagged off — … switched off for this tenant/plan (feature flag) … See store settings"', surfaces: ['browse', 'search', 'listing', 'sellers', 'inputs'],
    key: 'store2a.refusal.flagTenantPlan', why: 'founder D4: storefront_browse is a PLATFORM switch — no tenant or plan, no store setting' },
  { id: 'oncall_paging', canon: 'W3082 / W3098 / W3105 / W3150 "repeated failures page the on-call"', surfaces: ['browse', 'listing', 'sellers', 'inputs'],
    key: 'store2a.refusal.oncall', why: 'nothing pages anyone on a failed page load; the failure is said, with a Retry' },
  { id: 'listing_helpline', canon: 'W277 error "the lot number JNG-GG20-0412 works on the phone line 1800-419-0123 too"', surfaces: ['listing'],
    key: 'store2a.refusal.helpline', why: 'the IVR / helpline is an unimplemented placeholder (STORE-1a C-2)' },
]);

/** The canon shapes STORE-2a deliberately builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE2A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'category_route', canon: 'W275 route `(marketplace)/c/[...path]`', built: '`/[tenantSlug]?category=<id>` — the category path as a parameter (the whole subtree); `c` is not reserved' },
  { id: 'offset_pagination', canon: 'W275 / W276 / W282 "Showing 1–24 of 126 · ‹ Prev / Next ›"', built: 'keyset "Show more" (Law 11) + the capped count line ("126 listings" / "1,000+ listings")' },
  { id: 'per_farmer_page', canon: 'W280 `(marketplace)/s/[id]` — one farmer\'s page', built: '`/[tenantSlug]/sellers` — the ORGANISATION\'s page (HOTFIX-4 D3); `sellers` reserved in 0207' },
  { id: 'confirm_before_filter', canon: 'W3080 "Proceed — confirm" before applying filters (+ "Confirming writes an audit-trail entry")', built: 'a GET form: applying a filter is a read — no confirm step, no audit entry (the sentence would be false)' },
  { id: 'chain_back_links', canon: 'W3081 / W3082 "Back to the screen → W316"', built: 'Back / Retry return to the screen itself (W316 is the error canon — a canon defect, survey F-27)' },
  { id: 'listing_route', canon: 'W277 route `(marketplace)/l/[id]`', built: '`/[tenantSlug]/listings/[id]` (STORE-1b\'s per-tenant store route; buying stays in the organisation\'s store)' },
]);

/** The 12 chain pages and their verdicts (brief C6), with the FLOWMAP citations of the canon buttons that point at them. */
export const STORE2A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W3080-store-browse-mutate-confirm.html', flowmap: 'W275 data-flowmap="chain-mutate:browse" ×2 ("Apply filters", "Retry")', verdict: 'PARITY-DECOR — a GET form / a reload; the confirm + "audit entry" FALSE → DELTA confirm_before_filter' },
  { file: 'W3081-store-browse-mutate-success.html', flowmap: 'W3080 Proceed', verdict: 'PARITY-DECOR — the re-rendered results (filters in the URL) · "→ W316" DELTA chain_back_links' },
  { file: 'W3082-store-browse-mutate-failure.html', flowmap: 'W3080 Proceed (failure)', verdict: 'PARITY-DECOR — the error state with Retry = the same URL, filters kept · on-call refused (oncall_paging)' },
  { file: 'W3096-store-inputs-mutate-confirm.html', flowmap: 'W282 data-flowmap="chain-mutate:inputs" ("Retry")', verdict: 'PARITY-DECOR — Retry = reload of /[tenantSlug]/inputs; no confirm over a read' },
  { file: 'W3097-store-inputs-mutate-success.html', flowmap: 'W3096 Proceed', verdict: 'PARITY-DECOR — the re-rendered inputs page' },
  { file: 'W3098-store-inputs-mutate-failure.html', flowmap: 'W3096 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call refused' },
  { file: 'W3103-store-listing-mutate-confirm.html', flowmap: 'W277 data-flowmap="chain-mutate:listing" ×2 ("Ask the seller to relist", "Retry")', verdict: 'PARITY-DECOR — Retry = reload; "Ask the seller to relist" = a link to the organisation\'s page (the inquiry thread is STORE-2b/3)' },
  { file: 'W3104-store-listing-mutate-success.html', flowmap: 'W3103 Proceed', verdict: 'PARITY-DECOR — the re-rendered listing (or its tombstone)' },
  { file: 'W3105-store-listing-mutate-failure.html', flowmap: 'W3103 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call and the helpline refused' },
  { file: 'W3148-store-seller-mutate-confirm.html', flowmap: 'W280 data-flowmap="chain-mutate:seller" ("Retry")', verdict: 'PARITY-DECOR — Retry = reload of /[tenantSlug]/sellers' },
  { file: 'W3149-store-seller-mutate-success.html', flowmap: 'W3148 Proceed', verdict: 'PARITY-DECOR — the re-rendered organisation page' },
  { file: 'W3150-store-seller-mutate-failure.html', flowmap: 'W3148 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call refused' },
]);

/** The refusal keys a surface prints, in this list's order. */
export function store2aRefusalKeys(surface: Store2aSurface): string[] {
  return STORE2A_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* PC-56 STORE-2b · brief §E — what's in the cart is real: W281 cart (now /[tenantSlug]/cart) · its quantity chain W3041–W3044 · its      */
/* Remove / Accept price / Resolve / Retry chain W3045–W3047 · the add-to-cart chain on the listing W3099–W3102 · the licence-upload     */
/* chain W3092–W3095 (refused, founder D1)                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** The STORE-2b surfaces. Each refusal names the surfaces it is PRINTED on (the render tests read this map). */
export type Store2bSurface = 'cart' | 'checkout' | 'listing' | 'inputs';
export interface Store2bRefusal { id: string; canon: string; surfaces: readonly Store2bSurface[]; key: string; why: string }

/** Every canon claim STORE-2b does not make, BY NAME, and where it is printed (a refusal sentence — never an offer). */
export const STORE2B_REFUSALS: readonly Store2bRefusal[] = Object.freeze([
  { id: 'more_carts', canon: 'W281 H1 "(carts are per seller organisation — you have 1 more: Kisan Sathi FPC, 1 item)"', surfaces: ['cart'],
    key: 'store2b.refusal.moreCarts', why: 'founder D3: ONE store per session (the JWT names one organisation); a cross-store cart is a later wave (B32)' },
  { id: 'farmer_name', canon: 'W281 line "Ramesh Patel · Junagadh centre · …" / "Meera Ben · Anand centre · …"', surfaces: ['cart'],
    key: 'store2b.refusal.farmerName', why: 'HOTFIX-4 D3: the seller is the ORGANISATION, everywhere — a cart line says the organisation and the district' },
  { id: 'delivery_estimate', canon: 'W281 summary "Delivery — 2 shipments … (estimate)" + "Delivery = ₹80/qtl/100km: groundnut 10 qtl × 330 km = ₹2,640 …"', surfaces: ['cart'],
    key: 'store2b.refusal.deliveryEstimate', why: 'survey F-22: per_km pricing is deferred (it throws); delivery comes only from checkout.preview for a chosen address' },
  { id: 'slabs_minimum', canon: 'W281 "Final delivery — billed in ₹50 slabs, minimum ₹450 per shipment"', surfaces: ['cart'],
    key: 'store2b.refusal.slabs', why: 'no ₹50 rounding and no per-shipment minimum exist outside an organisation\'s own configured charges' },
  { id: 'gst_on_delivery', canon: 'W281 "plus 18% GST on delivery" · "Prices include GST where applicable"', surfaces: ['cart', 'checkout'],
    key: 'store2b.refusal.gst', why: 'GST is EXTRACTED, never added (invoice-tax.ts "0140 DEFECT 3"); goods GST is unrecorded at placement (hsn null)' },
  { id: 'alternatives', canon: 'W281 "3 same-day harvests are nearby" + "See alternatives"', surfaces: ['cart'],
    key: 'store2b.refusal.alternatives', why: 'no nearby-alternatives read exists (and no location is asked for — STORE-2a D3)' },
  { id: 'offline_cart', canon: 'W281 Offline "Cart changes made offline are queued on your phone … pending sync"', surfaces: ['cart'],
    key: 'store2b.refusal.offlineQueue', why: 'no offline queue: a cart change either reaches the server or fails visibly (Contract Law 6)' },
  { id: 'saved_on_phone', canon: 'W281 error "Couldn\'t sync your cart — Changes stay saved on this phone — nothing is lost"', surfaces: ['cart'],
    key: 'store2b.refusal.savedOnPhone', why: 'nothing is saved on the phone; the cart lives on the server — the error says so, with a Retry' },
  { id: 'guest_cart', canon: 'W281 "A guest cart lives on this device only — sign in to keep it saved across devices"', surfaces: ['cart'],
    key: 'store2b.refusal.guestCart', why: 'no guest cart exists; a cart is a signed-in buyer\'s (sign in to see it)' },
  { id: 'licence_upload', canon: 'W282 "upload yours once in Account" · "Licence pending / expired" + "Upload renewal" (W3092–W3095)', surfaces: ['cart', 'inputs', 'listing'],
    key: 'store2b.refusal.licenceUpload', why: 'founder D1: no buyer licence document type or verification exists; a licence-required product is refused at the cart, by name' },
  { id: 'age_check', canon: 'W282 "licence-gated and 18+"', surfaces: ['cart'],
    key: 'store2b.refusal.age', why: 'founder D1: no age check (no date of birth is collected)' },
  { id: 'cart_oncall', canon: 'W3044 / W3047 / W3102 "repeated failures page the on-call"', surfaces: ['cart'],
    key: 'store2b.refusal.oncall', why: 'nothing pages anyone; the failure is said by name, with a retry' },
  { id: 'audit_zero_sum', canon: 'W3043 / W3045 / W3046 / W3101 "the audit trail has the entry … Money-adjacent actions reconcile zero-sum"', surfaces: ['cart', 'listing'],
    key: 'store2b.refusal.audit', why: 'a cart writes no audit row and moves no money — the price a buyer agreed is frozen on the ORDER at placement' },
  { id: 'cart_flag_tenant_plan', canon: 'W281 "Flagged off — … switched off for this tenant/plan (feature flag) … See store settings"', surfaces: ['cart', 'checkout'],
    key: 'store2b.refusal.flagTenantPlan', why: 'founder D2: storefront_cart is a PLATFORM switch — no tenant or plan, no store setting' },
  { id: 'three_steps', canon: 'W281 "Checkout is 3 steps: address → payment → escrow confirmation"', surfaces: ['cart'],
    key: 'store2b.refusal.threeSteps', why: 'checkout is one review page, then pay (only while online payments are on), then the confirmation — STORE-2c moves it' },
]);

/** The canon shapes STORE-2b builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE2B_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'cart_route', canon: 'W281 route `(marketplace)/cart` under the platform header', built: '`/[tenantSlug]/cart` under the organisation\'s header (founder D3); `/cart` redirects to the session\'s store' },
  { id: 'quantity_review', canon: 'W3042 "Review before submitting" for a quantity edit', built: 'no review page: the re-rendered cart IS the review; checkout is the money review' },
  { id: 'add_review', canon: 'W3100 "Review before submitting" for add-to-cart', built: 'no review page: the cart is the review' },
  { id: 'add_button_total', canon: 'W277 the "+" stepper beside a live line total', built: 'the button says "Add N <unit> to cart" — no client-computed line total (the cart prints the server\'s)' },
  { id: 'chain_back_links', canon: 'W3042–W3044 / W3046 / W3047 → W316; W3100–W3102 → W273', built: 'Back / Retry return to the cart or the listing itself (canon link defects, survey F-27)' },
  { id: 'three_route_checkout', canon: 'W283 → W284 → W285 three-route checkout', built: 'STORE-2c: ONE route under the organisation with three steps (`/<slug>/checkout?step=address|payment|review`) — STORE2C_DELTAS.one_route' },
  { id: 'qty_stepper', canon: 'W281 "−" (data-decor) / "+" chain-form buttons', built: 'a decimal quantity field + Update (no client JS; the server re-validates)' },
]);

/** The 16 canon files of the wave and their verdicts — the four licence pages REFUSED (founder D1), not decor. */
export const STORE2B_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W281-store-cart.html', flowmap: 'the screen', verdict: 'BUILT — /[tenantSlug]/cart (D3); refusals printed (STORE2B_REFUSALS surface cart)' },
  { file: 'W3041-store-cart-form-form-error.html', flowmap: 'W281 data-flowmap="chain-form:cart" ("+" ×2)', verdict: 'BUILT — the line re-rendered with its named refusal, the typed value kept (step=error)' },
  { file: 'W3042-store-cart-form-review.html', flowmap: 'W3041 / W281', verdict: 'DELTA quantity_review — the re-rendered cart is the review' },
  { file: 'W3043-store-cart-form-success.html', flowmap: 'W3042 Submit', verdict: 'BUILT — the recomputed line + a notice (done=updated); the audit / zero-sum sentence refused (audit_zero_sum)' },
  { file: 'W3044-store-cart-form-failure.html', flowmap: 'W3042 Submit (failure)', verdict: 'BUILT — named failure, value kept; on-call refused (cart_oncall; the listing prints 2a\'s oncall_paging)' },
  { file: 'W3045-store-cart-mutate-confirm.html', flowmap: 'W281 data-flowmap="chain-mutate:cart" ×5 (Remove ×2, Accept price, Resolve, Retry)', verdict: 'BUILT — Remove → confirm ("you can add it again"); Accept → confirm with BOTH numbers; Resolve = an anchor to the first problem line; Retry = reload (DECOR)' },
  { file: 'W3046-store-cart-mutate-success.html', flowmap: 'W3045 Proceed', verdict: 'BUILT — the re-rendered cart + done=removed / accepted (the line at the new price); audit sentence refused' },
  { file: 'W3047-store-cart-mutate-failure.html', flowmap: 'W3045 Proceed (failure)', verdict: 'BUILT — named: the price changed AGAIN (the newest two numbers) / the line became unavailable (its reason); on-call refused' },
  { file: 'W3092-store-inputs-form-form-error.html', flowmap: 'W282 data-flowmap="chain-form:inputs" ("Upload renewal")', verdict: 'REFUSED — founder D1 (2026-10-15): no buyer licence flow; refused by name on W282 and on a licence_required cart line, NO upload form' },
  { file: 'W3093-store-inputs-form-review.html', flowmap: 'W3092', verdict: 'REFUSED — founder D1 (no licence upload exists to review)' },
  { file: 'W3094-store-inputs-form-success.html', flowmap: 'W3093 Submit', verdict: 'REFUSED — founder D1 (no licence is ever verified)' },
  { file: 'W3095-store-inputs-form-failure.html', flowmap: 'W3093 Submit (failure)', verdict: 'REFUSED — founder D1' },
  { file: 'W3099-store-listing-form-form-error.html', flowmap: 'W277 data-flowmap="chain-form:listing" ("+")', verdict: 'BUILT — named refusals on the listing (below minimum, above available, not a number, licence, wrong store + sign-in link, suspended, sold out, buying paused, sign-in), the typed quantity kept' },
  { file: 'W3100-store-listing-form-review.html', flowmap: 'W3099', verdict: 'DELTA add_review — the cart is the review' },
  { file: 'W3101-store-listing-form-success.html', flowmap: 'W3100 Submit', verdict: 'BUILT — ?status=added + "View cart" → /<slug>/cart; audit sentence refused' },
  { file: 'W3102-store-listing-form-failure.html', flowmap: 'W3100 Submit (failure)', verdict: 'BUILT — named failure, the quantity kept; on-call refused' },
]);

/** The refusal keys a STORE-2b surface prints, in this list's order. */
export function store2bRefusalKeys(surface: Store2bSurface): string[] {
  return STORE2B_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* PC-56 STORE-2c · brief §E — THE MONEY WAVE: W283 address · W284 payment · W285 review · W286 payment processing · W278 auction, and     */
/* their chains W3048–W3054 (the "+ Add address" form chain, the checkout Retry) and W3061–W3063 (the payment "Send again")              */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** The STORE-2c surfaces. Each refusal names the surfaces it is PRINTED on (the render tests read this map). */
export type Store2cSurface = 'checkout-address' | 'checkout-payment' | 'checkout-review' | 'processing' | 'auction';
export interface Store2cRefusal { id: string; canon: string; surfaces: readonly Store2cSurface[]; key: string; why: string }

/** Every canon claim STORE-2c does not make, BY NAME, and where it is printed (a refusal sentence — never an offer). */
export const STORE2C_REFUSALS: readonly Store2cRefusal[] = Object.freeze([
  { id: 'one_payment', canon: 'W284 "Total · one payment — One payment covers both orders; escrow splits it per order automatically" · W285 "One UPI payment ₹85,638"', surfaces: ['checkout-payment', 'checkout-review'],
    key: 'store2c.refusal.onePayment', why: 'founder D2: one payment per order, kept — each seller\'s order is paid on its own' },
  { id: 'slots', canon: 'W283 "Delivery slots — 2 shipments, chosen separately" + the slot radios · W285 "Delivery · Wed 15 Jul 09:00–13:00"', surfaces: ['checkout-address', 'checkout-review'],
    key: 'store2c.refusal.slots', why: 'founder D7: no buyer delivery slot exists (pickup-slot is the seller side)' },
  { id: 'self_pickup', canon: 'W283 "No slots — or choose self-pickup from the centre at no delivery charge" · "Self-pickup … offered instead"', surfaces: ['checkout-address'],
    key: 'store2c.refusal.selfPickup', why: 'founder D7: no self-pickup method is modelled at checkout' },
  { id: 'vehicle_note', canon: 'W283 "The vehicle-size note travels with the address to the driver"', surfaces: ['checkout-address'],
    key: 'store2c.refusal.vehicleNote', why: 'no address column carries a vehicle note (0003 addresses) and nothing reaches a driver from checkout' },
  { id: 'three_pl', canon: 'W283 serviceability gap "Self-pickup and 3PL quotes are offered instead of a fake promise"', surfaces: ['checkout-address'],
    key: 'store2c.refusal.threePl', why: 'no third-party logistics quoting exists' },
  { id: 'gstin', canon: 'W283 "Businesses can add GSTIN here for invoice matching" · "GST invoicing is business-buyer-only"', surfaces: ['checkout-address'],
    key: 'store2c.refusal.gstin', why: 'founder D5: no buyer GSTIN at checkout' },
  { id: 'per_km', canon: 'W283 "10 qtl × 330 km @ ₹80/qtl/100km = ₹2,640"', surfaces: ['checkout-address', 'checkout-review'],
    key: 'store2c.refusal.perKm', why: 'founder D4: value slabs only — a per_km charge is refused where it is defined (CHARGE_METHOD_UNSUPPORTED)' },
  { id: 'slab_50', canon: 'W283 "→ ₹50 slab ₹2,650" · W285 "slab-rounded"', surfaces: ['checkout-address', 'checkout-review'],
    key: 'store2c.refusal.slab50', why: 'founder D4: no rounding to a fixed slab — the organisation\'s own value slabs only' },
  { id: 'min_450', canon: 'W283 "below minimum, charged min/shipment ₹450" · W285 "minimum charge"', surfaces: ['checkout-address', 'checkout-review'],
    key: 'store2c.refusal.min450', why: 'founder D4: no per-shipment minimum outside the organisation\'s configured charges' },
  { id: 'gst_delivery', canon: 'W283 "GST 18% on delivery ₹558" · W285 "HSN 9967 · 18% = ₹477"', surfaces: ['checkout-address', 'checkout-review'],
    key: 'store2c.refusal.gstDelivery', why: 'founder D5: GST is extracted (included), never added on top' },
  { id: 'produce_gst', canon: 'W283 "produce 0% GST (unbranded whole lots)" · W285 the GST column "0%"', surfaces: ['checkout-review'],
    key: 'store2c.refusal.produceGst', why: 'founder D5: the goods rate is not recorded at placement — no rate is printed' },
  { id: 'hsn', canon: 'W285 the per-line HSN column (1202, 1001, 9967)', surfaces: ['checkout-review'],
    key: 'store2c.refusal.hsn', why: 'founder D5: no HSN at placement (hsn null)' },
  { id: 'partial_take', canon: 'W285 "Stock shrank at place — 4 qtl remain against your 10. Choose: take 4, or drop the line"', surfaces: ['checkout-review'],
    key: 'store2c.refusal.partialTake', why: 'founder D1: reservation is all-or-nothing — placement refuses with the remainder; the buyer reduces or removes in the cart' },
  { id: 'slot_hold', canon: 'W285 "Session expired — past the 30-minute slot hold" + "Re-check & continue"', surfaces: ['checkout-review'],
    key: 'store2c.refusal.slotHold', why: 'founder D1/D7: no holds and no slots — nothing is held while you review' },
  { id: 'quality_6h', canon: 'W285 "24h to raise issues on grains" (and the 0005 comment\'s "6h perishable")', surfaces: ['checkout-review'],
    key: 'store2c.refusal.quality6h', why: 'founder D3: one quality window for every category (the API\'s figure) until a per-category setting exists' },
  { id: 'cod', canon: 'W284 "Cash on delivery — capped at ₹20,000 per order for rider safety"', surfaces: ['checkout-payment'],
    key: 'store2c.refusal.cod', why: 'HOTFIX-4 D2: no buyer COD choice and no per-order cap setting; with online payments off the organisation confirms and you pay on delivery' },
  { id: 'neft', canon: 'W284 "Netbanking … NEFT/RTGS reference matching for amounts above UPI limits"', surfaces: ['checkout-payment'],
    key: 'store2c.refusal.neft', why: 'no NEFT/RTGS reference matching exists' },
  { id: 'gst_cards', canon: 'W284 "Business cards get GST-matched invoices automatically"', surfaces: ['checkout-payment'],
    key: 'store2c.refusal.gstCards', why: 'founder D5: no buyer GSTIN, so nothing is GST-matched' },
  { id: 'pay_later', canon: 'W284 "Flagged off — pay-later … approval is a partner-bank decision"', surfaces: ['checkout-payment'],
    key: 'store2c.refusal.payLater', why: 'no buyer credit is integrated at checkout' },
  { id: 'gateway_degraded', canon: 'W284 "UPI is slow right now … your cart and slots are held for 30 minutes"', surfaces: ['checkout-payment', 'processing'],
    key: 'store2c.refusal.degraded', why: 'no payment-method health feed and no hold exist' },
  { id: 'inpage_methods', canon: 'W284 the in-page UPI / Netbanking / Card choice ("collect request to nilesh@ok•••")', surfaces: ['checkout-payment'],
    key: 'store2c.refusal.inpageMethods', why: 'DELTA: the gateway\'s secure sheet chooses the method — this page never asks for a UPI id or a card' },
  { id: 'helpline', canon: 'W284 / W286 "the phone line can also take this order: 1800-419-0123, quote CHK-88213"', surfaces: ['checkout-payment', 'processing'],
    key: 'store2c.refusal.helpline', why: 'the helpline is an unimplemented placeholder (STORE-1a C-2)' },
  { id: 'message_failures', canon: 'W286 "We message you the result"', surfaces: ['processing'],
    key: 'store2c.refusal.messageFailures', why: 'only a confirmed order is messaged (order.confirmed); a failed payment sends nothing — its template rows are owed (brief B3)' },
  { id: 'oncall', canon: 'W3051 / W3054 / W3063 "repeated failures page the on-call"', surfaces: ['checkout-address', 'processing'],
    key: 'store2c.refusal.oncall', why: 'nothing pages anyone; the failure is said by name, with a retry' },
  { id: 'flag_tenant_plan', canon: 'W278 / W283–W286 "Flagged off — … switched off for this tenant/plan … See store settings"', surfaces: ['checkout-payment', 'processing', 'auction'],
    key: 'store2c.refusal.flagTenantPlan', why: 'the switches are the platform\'s flags; there is no store setting for them' },
  { id: 'pay_by_1800', canon: 'W278 won "Order created; escrow opens; pay by tomorrow 18:00"', surfaces: ['auction'],
    key: 'store2c.refusal.payBy', why: 'the balance is due within the window the API states (the auction settlement\'s), never a fixed clock time' },
  { id: 'shill', canon: 'W278 "Same-connection shill bidding is detected and voids bids (platform risk desk watches every auction)"', surfaces: ['auction'],
    key: 'store2c.refusal.shill', why: 'no shill detection exists (`bid_manipulation` is only a dispute reason)' },
  { id: 'outbid_sms', canon: 'W278 "Outbid? We notify you instantly on app + SMS"', surfaces: ['auction'],
    key: 'store2c.refusal.outbidSms', why: 'the outbid event is mapped (push only) but no message template exists for it — nothing is sent, and never by SMS' },
  { id: 'seller_rating', canon: 'W278 "Seller Girnar Agro FPO · 4.6★ (89 sales)" · "consolidated lot from 6 members"', surfaces: ['auction'],
    key: 'store2c.refusal.sellerRating', why: 'founder 2a D1 / HOTFIX-4 D3: the organisation is named; no rating or sales count is published' },
  { id: 'auction_mandi', canon: 'W278 "Mandi reference Junagadh APMC today: ₹6,240/qtl"', surfaces: ['auction'],
    key: 'store2c.refusal.mandi', why: 'founder 1b D3: no licensed, attributed mandi source' },
  { id: 'best_price', canon: 'W278 won "the FPO\'s 6 member farmers just got their best price this season"', surfaces: ['auction'],
    key: 'store2c.refusal.bestPrice', why: 'no such comparison is computed (Contract Law 12 — no invented metric)' },
  { id: 'masked_bidders', canon: 'W278 "Buyer R••• K (Rajkot)" — masked names and cities in the bid history', surfaces: ['auction'],
    key: 'store2c.refusal.bidderNames', why: 'founder 2a D1: no buyer identity at all on a public surface — the time and the amount only' },
]);

/** The canon shapes STORE-2c builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE2C_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'one_route', canon: 'W283 / W284 / W285 — three routes `(marketplace)/checkout/{address,payment,review}`', built: 'ONE route under the organisation, `/<slug>/checkout?step=address|payment|review`; the choices are server-held (the `kv_checkout` cookie), never in the URL' },
  { id: 'address_review', canon: 'W3049 "Review before submitting" for a new address', built: 'no review page: the address step itself shows the saved card (selected) — an address is not a money act' },
  { id: 'resend_confirm', canon: 'W3061 "Confirm this action" before "Send again"', built: 'no confirm page: "Send again" re-requests payment (a new attempt); nothing is charged until the buyer approves in the gateway\'s sheet' },
  { id: 'sheet_methods', canon: 'W284 the in-page UPI / Netbanking / Card radios', built: 'one "Pay online" method; the gateway\'s secure sheet offers UPI, card and netbanking' },
  { id: 'chain_links', canon: 'W3049–W3051 / W3053 / W3054 / W3062 / W3063 → W316 · W286 success → W287', built: 'Back / Retry return to the step itself (W316 is the error canon — survey F-27); success → this organisation\'s confirmation (W287 is STORE-3)' },
  { id: 'review_before_pay', canon: 'W284 payment → W285 review → pay', built: 'address → payment (how) → review & place → pay each order (the order must exist before a gateway order can be made for it)' },
]);

/** The 15 STORE-2c canon files and their verdicts (brief §C), with the FLOWMAP citations (the HTML `data-flowmap` hrefs are the truth). */
export const STORE2C_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W278-store-listing-auction.html', flowmap: 'route `(marketplace)/l/[id]/auction` (0 data-flowmap)', verdict: 'BUILT at `/<slug>/auctions/[id]` on the public read (B7); the platform route redirects' },
  { file: 'W283-store-checkout-address.html', flowmap: 'data-flowmap="chain-form:checkout" ×2 ("+ Add address", "Add address") → W3048 · "chain-mutate:checkout" ("Retry") → W3052', verdict: 'BUILT — `?step=address`' },
  { file: 'W284-store-checkout-payment.html', flowmap: 'data-flowmap="chain-mutate:checkout" ("Retry") → W3052', verdict: 'BUILT — `?step=payment`' },
  { file: 'W285-store-checkout-review.html', flowmap: '0 data-flowmap; links W281 (cart) · W286 (pay)', verdict: 'BUILT — `?step=review`, per-seller blocks, each paid on its own after placement' },
  { file: 'W286-store-payment-processing.html', flowmap: 'data-flowmap="chain-mutate:payment" ("Send again") → W3061; success → W287', verdict: 'BUILT — `/<slug>/checkout/pay` (the real attempt states)' },
  { file: 'W3048-store-checkout-form-form-error.html', flowmap: 'W283 "+ Add address" (chain-form:checkout)', verdict: 'BUILT — the add-address form re-rendered with a refusal against each field, the values kept' },
  { file: 'W3049-store-checkout-form-review.html', flowmap: 'W3048 Submit', verdict: 'DELTA address_review' },
  { file: 'W3050-store-checkout-form-success.html', flowmap: 'W3049 Submit', verdict: 'BUILT — back to the address step with the new address SELECTED and the methods re-quoted for it' },
  { file: 'W3051-store-checkout-form-failure.html', flowmap: 'W3049 Submit (failure)', verdict: 'BUILT — the named failure, "nothing was saved", the values kept · on-call refused' },
  { file: 'W3052-store-checkout-mutate-confirm.html', flowmap: 'W283 / W284 "Retry" (chain-mutate:checkout)', verdict: 'PARITY-DECOR — Retry is a reload of the step (a read); no confirm over a read, no audit entry' },
  { file: 'W3053-store-checkout-mutate-success.html', flowmap: 'W3052 Proceed', verdict: 'PARITY-DECOR — the re-rendered step' },
  { file: 'W3054-store-checkout-mutate-failure.html', flowmap: 'W3052 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again, with Retry · on-call refused' },
  { file: 'W3061-store-payment-mutate-confirm.html', flowmap: 'W286 "Send again" (chain-mutate:payment)', verdict: 'DECOR — DELTA resend_confirm: the act is re-requesting payment, nothing is charged by asking' },
  { file: 'W3062-store-payment-mutate-success.html', flowmap: 'W3061 Proceed', verdict: 'BUILT — the NEW attempt\'s processing state (attempt N + 1, its own gateway order and expiry)' },
  { file: 'W3063-store-payment-mutate-failure.html', flowmap: 'W3061 Proceed (failure)', verdict: 'BUILT — the named failure: "a payment attempt is still open until <expiresAt>" / "this order is no longer awaiting payment"' },
]);

/** The refusal keys a STORE-2c surface prints, in this list's order. */
export function store2cRefusalKeys(surface: Store2cSurface): string[] {
  return STORE2C_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
